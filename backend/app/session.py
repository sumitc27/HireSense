"""Per-WebSocket session orchestration — the full interview flow.

One ``SessionController`` per connection. It owns:
  * the receive loop (JSON control frames; each ``utterance`` header is
    followed by exactly one binary frame — WS ordering guarantees the pairing)
  * a single cancellable ``speak_task`` — cancelling it IS barge-in
  * the latency clock wiring (utterance -> stt -> first token -> first audio
    -> client-reported playback start)
  * the turn machine (question -> listen -> transcribe -> score -> coach ->
    follow-up | next question | report)

A "turn" is one question/answer/coaching cycle and keeps one ``turn_id`` from
the moment the question is asked through its coaching. Barge-in while a
question is being asked, or while the coach is still talking, both fold back
to LISTENING (see ``turn_machine._ALLOWED``) — talking over either one is
read as "let me just answer".
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid

from fastapi import WebSocket, WebSocketDisconnect

from . import brain, sessions_store, stt, tts
from .config import get_settings
from .rubric import Report, RubricScore, TurnRecord
from .turn_machine import (
    STAGE_LLM_FIRST,
    STAGE_PLAYBACK,
    STAGE_STT,
    STAGE_TTS_FIRST,
    STAGE_UTTERANCE,
    LatencyClock,
    TurnMachine,
    TurnState,
)

logger = logging.getLogger("hiresense.session")

_FALLBACK_RUBRIC_NOTE = "Scoring service hiccupped — this is a neutral placeholder score."
_SILENCE_MESSAGE = "Still there? Take your time, or type your answer below."
_NON_ENGLISH_MESSAGE = "I can only coach in English right now — try answering in English, or type your response."


class SessionController:
    def __init__(self, ws: WebSocket, user_id: str = "anonymous-developer") -> None:
        self.ws = ws
        self.user_id = user_id
        self.settings = get_settings()
        self.speak_task: asyncio.Task | None = None
        self.silence_task: asyncio.Task | None = None
        self.turn_task: asyncio.Task | None = None
        self.clock: LatencyClock | None = None

        self.session_id = uuid.uuid4().hex[:12]
        self.role = ""
        self.seniority = ""
        self.resume_text = ""
        self.questions: list[str] = []
        self.turns: list[TurnRecord] = []
        self.turn_machine: TurnMachine | None = None

        # State for the turn currently in flight (set by ask_question).
        self.current_turn_id = ""
        self.current_question_text = ""

    # ---- protocol helpers ---------------------------------------------------
    async def send_event(self, etype: str, **data) -> None:
        await self.ws.send_text(json.dumps({"type": etype, **data}, ensure_ascii=False))

    async def send_audio(self, turn_id: str, seq: int, sentence_index: int,
                         text: str, wav: bytes) -> None:
        # JSON announcement immediately followed by the binary frame; WS
        # ordering per connection makes this pairing safe.
        await self.send_event("tts_chunk", turn_id=turn_id, seq=seq,
                              sentence_index=sentence_index, text=text)
        await self.ws.send_bytes(wav)

    # ---- speaking (the cancellable half of barge-in) -------------------------
    async def speak_stream(self, turn_id: str, token_iter) -> str:
        """Stream LLM tokens: forward text deltas AND speak complete sentences
        as they form. Returns the full text. Cancellation-safe: the in-flight
        sentence synth finishes in its thread and is simply dropped.
        """
        splitter = tts.SentenceSplitter()
        full: list[str] = []
        seq = 0
        first_token_marked = False

        async def synth_and_send(sentence: str) -> None:
            nonlocal seq
            wav = await asyncio.to_thread(tts.synth_sentence, sentence)
            if wav is None:
                # TTS degraded — captions already carry the text.
                await self.send_event("error", code="tts_failed",
                                      message="Voice synthesis unavailable — continuing with captions.",
                                      recoverable=True)
                return
            if seq == 0 and self.clock:
                self.clock.mark(STAGE_TTS_FIRST)
            await self.send_audio(turn_id, seq, seq, sentence, wav)
            seq += 1

        # chat_stream is a blocking generator — drain it in a thread through a queue.
        loop = asyncio.get_running_loop()
        q: asyncio.Queue = asyncio.Queue()
        _DONE = object()

        def produce() -> None:
            try:
                for tok in token_iter:
                    loop.call_soon_threadsafe(q.put_nowait, tok)
            except Exception as e:  # surfaced via queue, handled below
                loop.call_soon_threadsafe(q.put_nowait, e)
            finally:
                loop.call_soon_threadsafe(q.put_nowait, _DONE)

        producer = asyncio.get_running_loop().run_in_executor(None, produce)
        try:
            while True:
                item = await q.get()
                if item is _DONE:
                    break
                if isinstance(item, Exception):
                    logger.warning("[session] token stream failed: %s", item)
                    break
                if not first_token_marked and self.clock:
                    self.clock.mark(STAGE_LLM_FIRST)
                    first_token_marked = True
                full.append(item)
                await self.send_event("coaching_delta", turn_id=turn_id, text=item)
                for sentence in splitter.feed(item):
                    await synth_and_send(sentence)
            if (tail := splitter.flush()) is not None:
                await synth_and_send(tail)
            await self.send_event("tts_end", turn_id=turn_id, interrupted=False)
        except asyncio.CancelledError:
            await self.send_event("tts_end", turn_id=turn_id, interrupted=True)
            raise
        finally:
            producer.cancel()
        return "".join(full)

    async def speak_text(self, turn_id: str, text: str) -> None:
        """Speak a fixed text (questions, re-prompts) sentence by sentence."""
        splitter = tts.SentenceSplitter()
        sentences = splitter.feed(text + " ")
        if (tail := splitter.flush()) is not None:
            sentences.append(tail)
        seq = 0
        try:
            for sentence in sentences:
                wav = await asyncio.to_thread(tts.synth_sentence, sentence)
                if wav is None:
                    await self.send_event("error", code="tts_failed",
                                          message="Voice synthesis unavailable — continuing with captions.",
                                          recoverable=True)
                    continue
                if seq == 0 and self.clock:
                    self.clock.mark(STAGE_TTS_FIRST)
                await self.send_audio(turn_id, seq, seq, sentence, wav)
                seq += 1
            await self.send_event("tts_end", turn_id=turn_id, interrupted=False)
        except asyncio.CancelledError:
            await self.send_event("tts_end", turn_id=turn_id, interrupted=True)
            raise

    def start_speaking(self, coro) -> None:
        self.speak_task = asyncio.create_task(coro)

    async def barge_in(self) -> None:
        if self.speak_task and not self.speak_task.done():
            self.speak_task.cancel()
            try:
                await self.speak_task
            except (asyncio.CancelledError, Exception):
                pass
        self.speak_task = None

    # ---- turn dispatch (runs off the main receive loop) ----------------------
    # start_session/handle_utterance/handle_typed_answer all end in `await
    # self.speak_task` while a question or coaching is spoken. If the main
    # loop awaited them inline, it could never call ws.receive() again until
    # speech finished — meaning a `barge_in` frame sent mid-speech would sit
    # unread until the very speech it's meant to interrupt was already over.
    # Running each turn as its own task keeps the receive loop free to act on
    # barge_in/playback_started the instant they arrive.
    async def _run_turn_task(self, coro) -> None:
        try:
            await coro
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[session] turn task failed")

    def _start_turn(self, coro) -> None:
        if self.turn_task and not self.turn_task.done():
            self.turn_task.cancel()
        self.turn_task = asyncio.create_task(self._run_turn_task(coro))

    # ---- silence handling (one gentle re-prompt while LISTENING) -------------
    def _arm_silence_watchdog(self, turn_id: str) -> None:
        self._disarm_silence_watchdog()
        self.silence_task = asyncio.create_task(self._silence_watchdog(turn_id))

    def _disarm_silence_watchdog(self) -> None:
        if self.silence_task and not self.silence_task.done():
            self.silence_task.cancel()
        self.silence_task = None

    async def _silence_watchdog(self, turn_id: str) -> None:
        try:
            await asyncio.sleep(self.settings.silence_timeout_seconds)
        except asyncio.CancelledError:
            return
        tm = self.turn_machine
        if tm and tm.state is TurnState.LISTENING and self.current_turn_id == turn_id:
            await self.send_event("error", code="silence_timeout",
                                  message=_SILENCE_MESSAGE, recoverable=True)

    # ---- session lifecycle -------------------------------------------------
    async def start_session(self, role: str, seniority: str, question_count: int, resume_text: str = "") -> None:
        if self.turn_machine is not None:
            await self.send_event("error", code="session_already_started",
                                  message="This session already started.", recoverable=True)
            return

        self.role = role.strip()[:80] or "software engineer"
        self.seniority = seniority.strip()[:40] or "mid-level"
        self.resume_text = resume_text.strip() if resume_text else ""
        count = max(1, min(question_count, self.settings.max_question_count))
        self.turn_machine = TurnMachine(question_count=count)
        await asyncio.to_thread(sessions_store.create_session, self.session_id, self.role, self.seniority, count, self.user_id)

        await self.send_event("session_started", session_id=self.session_id)
        self.turn_machine.to(TurnState.GENERATING_QUESTIONS)
        await self.send_event("state", state=TurnState.GENERATING_QUESTIONS.value, turn_id="")

        kwargs = {"settings": self.settings}
        if self.resume_text:
            kwargs["resume_text"] = self.resume_text

        try:
            self.questions = await asyncio.to_thread(
                brain.generate_questions, self.role, self.seniority, count,
                **kwargs
            )
        except Exception as e:
            logger.exception("[session] question generation failed")
            await self.send_event("error", code="questions_failed",
                                  message=f"Couldn't prepare interview questions: {e}",
                                  recoverable=False)
            await asyncio.to_thread(sessions_store.finish_session, self.session_id, "incomplete", 0.0, [])
            self.turn_machine.to(TurnState.DONE)
            return

        self.turn_machine.to(TurnState.ASKING)
        await self.ask_question(self.turn_machine.question_index, is_follow_up=False)

    async def ask_question(self, index: int, *, is_follow_up: bool, follow_up_text: str | None = None) -> None:
        tm = self.turn_machine
        assert tm is not None
        if tm.state is not TurnState.ASKING:
            tm.to(TurnState.ASKING)

        text = follow_up_text if is_follow_up else self.questions[index]
        self.current_turn_id = tm.next_turn_id()
        self.current_question_text = text

        await self.send_event("question", turn_id=self.current_turn_id, index=index,
                              total=tm.question_count, text=text, is_follow_up=is_follow_up)
        # Announce ASKING so the client enables the mic *during* the question —
        # letting the user answer immediately or barge in over it, instead of
        # waiting (mic greyed out) until the question finishes speaking.
        await self.send_event("state", state=TurnState.ASKING.value,
                              turn_id=self.current_turn_id, question_index=index)

        await self.barge_in()
        self.start_speaking(self.speak_text(self.current_turn_id, text))
        try:
            await self.speak_task
        except asyncio.CancelledError:
            pass

        # A barge-in during the question (now reachable, since the mic is live
        # while ASKING) already folded the machine to LISTENING and armed the
        # watchdog via the main-loop handler — so only do it here if that
        # didn't happen, otherwise tm.to(LISTENING) would be an illegal
        # LISTENING->LISTENING transition.
        if tm.state is TurnState.ASKING:
            tm.to(TurnState.LISTENING)
            await self.send_event("state", state=TurnState.LISTENING.value,
                                  turn_id=self.current_turn_id, question_index=index)
            self._arm_silence_watchdog(self.current_turn_id)

    def _ensure_listening(self) -> bool:
        """Fold ASKING/COACHING back to LISTENING when a new utterance arrives
        mid-question or mid-coaching (barge-in-to-answer). Returns False for
        stray utterances outside a live turn (e.g. before start_session or
        after the report has been sent) so the caller can ignore them."""
        tm = self.turn_machine
        if tm is None:
            return False
        if tm.state in (TurnState.ASKING, TurnState.COACHING):
            tm.to(TurnState.LISTENING)
        return tm.state is TurnState.LISTENING

    async def handle_answer(self, answer_text: str, *, source: str) -> None:
        """Score + coach one answer, already transcribed (voice or typed)."""
        self._disarm_silence_watchdog()
        tm = self.turn_machine
        assert tm is not None
        turn_id = self.current_turn_id
        question_text = self.current_question_text
        question_index = tm.question_index
        is_follow_up = tm.in_follow_up

        tm.to(TurnState.SCORING)
        await self.send_event("state", state=TurnState.SCORING.value, turn_id=turn_id)
        kwargs = {"settings": self.settings}
        if self.resume_text:
            kwargs["resume_text"] = self.resume_text

        try:
            rubric = await asyncio.to_thread(
                brain.score_answer, self.role, self.seniority, question_text, answer_text,
                **kwargs
            )
        except Exception:
            logger.exception("[session] scoring failed — using neutral placeholder")
            rubric = RubricScore(
                structure=3, specificity=3, correctness=3, conciseness=3,
                strengths=[], improvements=[_FALLBACK_RUBRIC_NOTE],
                follow_up_needed=False, follow_up_question=None,
            )
        await self.send_event("scoring", turn_id=turn_id, rubric=rubric.to_dict())

        tm.to(TurnState.COACHING)
        await self.send_event("state", state=TurnState.COACHING.value, turn_id=turn_id)

        # Check if this is the last turn (no follow-up is needed or allowed, and we are on the last question)
        has_follow_up = (
            rubric.follow_up_needed
            and not tm.in_follow_up
            and not tm.follow_ups_used.get(tm.question_index)
        )
        is_last_turn = (not has_follow_up) and (tm.question_index + 1 >= tm.question_count)

        try:
            tokens = brain.coach_stream(
                self.role, self.seniority, question_text, rubric,
                is_last_turn=is_last_turn, settings=self.settings
            )
        except TypeError:
            tokens = brain.coach_stream(
                self.role, self.seniority, question_text, rubric,
                settings=self.settings
            )
        await self.barge_in()
        self.start_speaking(self.speak_stream(turn_id, tokens))
        try:
            coaching_text = await self.speak_task
        except asyncio.CancelledError:
            coaching_text = ""
        if self.clock:
            await self.send_event("latency", turn_id=turn_id, stages=self.clock.stages_ms())

        record = TurnRecord(
            turn_id=turn_id, question_index=question_index, is_follow_up=is_follow_up,
            question_text=question_text, answer_text=answer_text, answer_source=source,
            rubric=rubric, coaching_text=coaching_text,
            latency_ms=self.clock.stages_ms() if self.clock else {},
        )
        self.turns.append(record)
        await asyncio.to_thread(sessions_store.append_turn, self.session_id, record)

        plan = tm.plan_after_coaching(rubric.follow_up_needed)
        if plan.kind == "follow_up":
            await self.ask_question(plan.question_index, is_follow_up=True,
                                    follow_up_text=rubric.follow_up_question)
        elif plan.kind == "next_question":
            await self.ask_question(plan.question_index, is_follow_up=False)
        else:
            await self.finish_session()

    async def finish_session(self) -> None:
        tm = self.turn_machine
        assert tm is not None
        tm.to(TurnState.REPORT)
        report = Report(role=self.role, seniority=self.seniority, turns=self.turns, completed=True)
        await asyncio.to_thread(
            sessions_store.finish_session, self.session_id, "completed",
            report.overall_average, report.top_improvements,
        )
        await self.send_event("report", session_id=self.session_id, report=report.to_dict())
        tm.to(TurnState.DONE)

    async def _persist_incomplete(self) -> None:
        """Best-effort: mark the session incomplete if the socket drops mid-interview
        (start_session succeeded but we never reached REPORT/DONE)."""
        tm = self.turn_machine
        if tm is None or tm.state in (TurnState.REPORT, TurnState.DONE):
            return
        report = Report(role=self.role, seniority=self.seniority, turns=self.turns, completed=False)
        try:
            await asyncio.to_thread(
                sessions_store.finish_session, self.session_id, "incomplete",
                report.overall_average, report.top_improvements,
            )
        except Exception:
            logger.exception("[session] failed to persist incomplete session")

    # ---- turn entry points (voice + typed share handle_answer) ---------------
    async def handle_utterance(self, audio: bytes) -> None:
        if not self._ensure_listening():
            return
        self._disarm_silence_watchdog()
        assert self.turn_machine is not None
        turn_id = self.current_turn_id
        self.clock = LatencyClock()
        self.clock.mark(STAGE_UTTERANCE)

        self.turn_machine.to(TurnState.TRANSCRIBING)
        await self.send_event("state", state=TurnState.TRANSCRIBING.value, turn_id=turn_id)
        result = await asyncio.to_thread(stt.transcribe, audio)
        self.clock.mark(STAGE_STT)
        if not result.ok or not result.text:
            self.turn_machine.to(TurnState.LISTENING)
            await self.send_event("error", code=f"stt_{result.error or 'failed'}",
                                  message="Couldn't transcribe that — try again or type your answer.",
                                  recoverable=True)
            await self.send_event("state", state=TurnState.LISTENING.value, turn_id=turn_id)
            self._arm_silence_watchdog(turn_id)
            return
        # Non-English: don't waste a scoring call on a language the coach
        # can't evaluate — redirect and let the user retry (voice or typed).
        if result.language not in ("english", "unknown"):
            self.turn_machine.to(TurnState.LISTENING)
            await self.send_event("stt_result", turn_id=turn_id, text=result.text,
                                  language=result.language, stt_ms=result.stt_ms)
            await self.send_event("error", code="non_english",
                                  message=_NON_ENGLISH_MESSAGE, recoverable=True)
            await self.send_event("state", state=TurnState.LISTENING.value, turn_id=turn_id)
            self._arm_silence_watchdog(turn_id)
            return
        await self.send_event("stt_result", turn_id=turn_id, text=result.text,
                              language=result.language, stt_ms=result.stt_ms)
        await self.handle_answer(result.text, source="voice")

    async def handle_typed_answer(self, text: str) -> None:
        text = text.strip()
        if not text:
            return
        if not self._ensure_listening():
            return
        self._disarm_silence_watchdog()
        self.clock = None  # no voice latency to report for a typed answer
        await self.handle_answer(text, source="typed")

    # ---- main loop --------------------------------------------------------------
    async def run(self) -> None:
        await self.ws.accept()
        logger.info("[session] connected")
        try:
            while True:
                message = await self.ws.receive()
                if message.get("type") == "websocket.disconnect":
                    break
                text = message.get("text")
                if text is None:
                    continue  # stray binary without a header — ignore
                frame = json.loads(text)
                ftype = frame.get("type")

                if ftype == "start_session":
                    self._start_turn(self.start_session(
                        frame.get("role", ""), frame.get("seniority", ""),
                        int(frame.get("question_count", self.settings.default_question_count)),
                        frame.get("resume_text", ""),
                    ))
                elif ftype == "utterance":
                    audio = await self.ws.receive_bytes()
                    await self.barge_in()
                    self._start_turn(self.handle_utterance(audio))
                elif ftype == "typed_answer":
                    await self.barge_in()
                    self._start_turn(self.handle_typed_answer(frame.get("text", "")))
                elif ftype == "barge_in":
                    await self.barge_in()
                    if self.turn_machine and self.turn_machine.state in (
                        TurnState.ASKING, TurnState.COACHING,
                    ):
                        self.turn_machine.to(TurnState.LISTENING)
                        self._arm_silence_watchdog(self.current_turn_id)
                    await self.send_event("state", state=TurnState.LISTENING.value,
                                          turn_id=self.current_turn_id)
                elif ftype == "playback_started":
                    if self.clock:
                        self.clock.mark_client(STAGE_PLAYBACK)
                        await self.send_event(
                            "latency", turn_id=frame.get("turn_id", ""),
                            stages=self.clock.stages_ms(),
                        )
                elif ftype == "ping":
                    await self.send_event("pong")
        except WebSocketDisconnect:
            pass
        except RuntimeError as e:
            # A send can race a client that closed mid-turn (e.g. asking the
            # next question right after the client already hung up) — the
            # ASGI layer surfaces that as RuntimeError, not WebSocketDisconnect.
            # Treat it the same: this connection is gone, nothing more to do.
            if "close" not in str(e).lower():
                raise
        finally:
            # Give an in-flight turn task a brief chance to wrap up (its sends
            # will just no-op against the closed socket) before cancelling —
            # avoids marking a session incomplete one await away from finishing.
            if self.turn_task and not self.turn_task.done():
                try:
                    await asyncio.wait_for(asyncio.shield(self.turn_task), timeout=5)
                except (asyncio.TimeoutError, Exception):
                    pass
                if not self.turn_task.done():
                    self.turn_task.cancel()
            await self.barge_in()
            self._disarm_silence_watchdog()
            await self._persist_incomplete()
            logger.info("[session] disconnected")
