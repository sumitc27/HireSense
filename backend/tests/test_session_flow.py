"""End-to-end SessionController flow — fully stubbed (no keys, no Kokoro, no
network), driven through a fake WebSocket. This is the highest-value test in
the suite: it exercises the real orchestration in session.py (question ->
listen -> score -> coach -> follow-up/next/report, plus persistence) exactly
the way a live browser session would, just with brain/stt/tts swapped for
deterministic stand-ins.

SessionController runs each turn as a background task (so the receive loop
stays free to act on barge_in/playback_started immediately — see session.py's
_start_turn) rather than awaiting it inline. So this harness uses a real
asyncio.Queue-backed fake socket and polls for the event we care about,
instead of a fixed frame list + "empty queue = disconnect": that shape raced
ahead of the background task before session.py went concurrent.
"""
import asyncio
import json

import pytest

from app import brain, session as session_module, sessions_store, stt, tts
from app.rubric import RubricScore


class _FakeSettings:
    def __init__(self, db_path):
        self.db_path = db_path


class FakeWebSocket:
    """Queue-backed stand-in for Starlette's WebSocket, ASGI-message-shaped
    like the real thing so session.py's receive()/receive_bytes() calls work
    unmodified. Frames are pulled lazily, same as a real socket, so a
    background turn task gets genuine scheduling turns before disconnect."""

    def __init__(self) -> None:
        self._queue: asyncio.Queue = asyncio.Queue()
        self.sent_text: list[dict] = []
        self.sent_bytes: list[bytes] = []
        self.accepted = False

    def push_text(self, **kwargs) -> None:
        self._queue.put_nowait({"type": "websocket.receive", "text": json.dumps(kwargs)})

    def push_bytes(self, data: bytes) -> None:
        self._queue.put_nowait({"type": "websocket.receive", "bytes": data})

    def push_disconnect(self) -> None:
        self._queue.put_nowait({"type": "websocket.disconnect"})

    async def accept(self) -> None:
        self.accepted = True

    async def receive(self) -> dict:
        return await self._queue.get()

    async def receive_bytes(self) -> bytes:
        item = await self._queue.get()
        return item["bytes"]

    async def send_text(self, text: str) -> None:
        self.sent_text.append(json.loads(text))

    async def send_bytes(self, data: bytes) -> None:
        self.sent_bytes.append(data)


def _utterance(ws: FakeWebSocket, audio: bytes = b"fake-audio-bytes") -> None:
    ws.push_text(type="utterance", duration_ms=500, mime="audio/webm")
    ws.push_bytes(audio)


def _event_types(ws: FakeWebSocket) -> list[str]:
    return [f["type"] for f in ws.sent_text]


def _session_id(ws: FakeWebSocket) -> str:
    return next(f for f in ws.sent_text if f["type"] == "session_started")["session_id"]


async def _wait_until(predicate, timeout: float = 5.0) -> None:
    """Poll a fast-settling condition — everything here is stubbed (no real
    network), so a slow predicate means a genuine bug, not a slow provider."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while not predicate():
        if loop.time() > deadline:
            raise AssertionError(f"condition never became true within {timeout}s")
        await asyncio.sleep(0.01)


@pytest.fixture
def stub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(sessions_store, "get_settings", lambda: _FakeSettings(tmp_path / "test.db"))


@pytest.fixture
def stub_tts(monkeypatch):
    monkeypatch.setattr(tts, "synth_sentence", lambda text: b"FAKEWAV")


@pytest.mark.usefixtures("stub_db", "stub_tts")
async def test_single_question_no_follow_up_reaches_report(monkeypatch):
    monkeypatch.setattr(brain, "generate_questions",
                        lambda role, seniority, count, *, settings: ["Tell me about a project."])
    monkeypatch.setattr(brain, "score_answer",
                        lambda role, seniority, q, a, *, settings: RubricScore(
                            structure=4, specificity=4, correctness=4, conciseness=4,
                            strengths=["clear"], improvements=["add metrics"],
                            follow_up_needed=False, follow_up_question=None,
                        ))
    monkeypatch.setattr(brain, "coach_stream",
                        lambda role, seniority, q, rubric, *, settings: iter(["Nice work. ", "Moving on."]))

    ws = FakeWebSocket()
    task = asyncio.create_task(session_module.SessionController(ws).run())
    ws.push_text(type="start_session", role="backend engineer", seniority="senior", question_count=1)
    await _wait_until(lambda: any(f["type"] == "question" for f in ws.sent_text))
    ws.push_text(type="typed_answer", text="I built a caching layer that cut latency by half.")
    await _wait_until(lambda: any(f["type"] == "report" for f in ws.sent_text))
    ws.push_disconnect()
    await task

    types = _event_types(ws)
    assert types[0] == "session_started"
    assert types.index("scoring") < types.index("report")
    assert types[-1] == "report"

    report = next(f for f in ws.sent_text if f["type"] == "report")["report"]
    assert report["completed"] is True
    assert report["overall_average"] == 4.0
    assert len(report["turns"]) == 1
    assert report["turns"][0]["answer_source"] == "typed"

    persisted = sessions_store.get_session(_session_id(ws))
    assert persisted["status"] == "completed"
    assert persisted["overall_average"] == 4.0


@pytest.mark.usefixtures("stub_db", "stub_tts")
async def test_follow_up_then_report_on_two_question_session(monkeypatch):
    monkeypatch.setattr(brain, "generate_questions",
                        lambda role, seniority, count, *, settings: ["Q1?", "Q2?"])

    call_count = {"n": 0}

    def fake_score(role, seniority, q, a, *, settings):
        call_count["n"] += 1
        # Only the very first answer triggers a follow-up; everything after is clean.
        needs_follow_up = call_count["n"] == 1
        return RubricScore(
            structure=3, specificity=3, correctness=3, conciseness=3,
            follow_up_needed=needs_follow_up,
            follow_up_question="Can you be more specific?" if needs_follow_up else None,
        )

    monkeypatch.setattr(brain, "score_answer", fake_score)
    monkeypatch.setattr(brain, "coach_stream",
                        lambda role, seniority, q, rubric, *, settings: iter(["Ok, next."]))

    ws = FakeWebSocket()
    task = asyncio.create_task(session_module.SessionController(ws).run())
    ws.push_text(type="start_session", role="pm", seniority="mid-level", question_count=2)
    await _wait_until(lambda: _event_types(ws).count("question") == 1)
    ws.push_text(type="typed_answer", text="answer 1")
    await _wait_until(lambda: _event_types(ws).count("question") == 2)  # the follow-up
    ws.push_text(type="typed_answer", text="answer to the follow-up")
    await _wait_until(lambda: _event_types(ws).count("question") == 3)  # Q2
    ws.push_text(type="typed_answer", text="answer 2")
    await _wait_until(lambda: any(f["type"] == "report" for f in ws.sent_text))
    ws.push_disconnect()
    await task

    questions = [f for f in ws.sent_text if f["type"] == "question"]
    assert len(questions) == 3  # Q1, its follow-up, Q2
    assert [q["is_follow_up"] for q in questions] == [False, True, False]

    report = next(f for f in ws.sent_text if f["type"] == "report")["report"]
    assert len(report["turns"]) == 3
    assert call_count["n"] == 3  # capped: no second follow-up requested


@pytest.mark.usefixtures("stub_db", "stub_tts")
async def test_stt_failure_is_recoverable_and_never_reaches_report(monkeypatch):
    monkeypatch.setattr(brain, "generate_questions",
                        lambda role, seniority, count, *, settings: ["Q1?"])
    monkeypatch.setattr(stt, "transcribe",
                        lambda audio, filename="utterance.webm": stt.SttResult(
                            text="", language="unknown", stt_ms=10, ok=False, error="rate_limited"))

    ws = FakeWebSocket()
    task = asyncio.create_task(session_module.SessionController(ws).run())
    ws.push_text(type="start_session", role="qa", seniority="junior", question_count=1)
    await _wait_until(lambda: any(f["type"] == "question" for f in ws.sent_text))
    _utterance(ws)
    await _wait_until(lambda: any(f["type"] == "error" for f in ws.sent_text))
    ws.push_disconnect()
    await task

    errors = [f for f in ws.sent_text if f["type"] == "error"]
    assert any(e["code"] == "stt_rate_limited" and e["recoverable"] for e in errors)
    assert not any(f["type"] == "report" for f in ws.sent_text)
    # The turn is still open, waiting for a retry — not silently dropped.
    assert _event_types(ws)[-1] == "state"


@pytest.mark.usefixtures("stub_db", "stub_tts")
async def test_non_english_answer_skips_scoring_and_redirects(monkeypatch):
    monkeypatch.setattr(brain, "generate_questions",
                        lambda role, seniority, count, *, settings: ["Q1?"])

    def fail_if_called(*a, **kw):
        raise AssertionError("scoring should not be reached for non-English input")

    monkeypatch.setattr(brain, "score_answer", fail_if_called)
    monkeypatch.setattr(stt, "transcribe",
                        lambda audio, filename="utterance.webm": stt.SttResult(
                            text="hola, como estas", language="spanish", stt_ms=10))

    ws = FakeWebSocket()
    task = asyncio.create_task(session_module.SessionController(ws).run())
    ws.push_text(type="start_session", role="qa", seniority="junior", question_count=1)
    await _wait_until(lambda: any(f["type"] == "question" for f in ws.sent_text))
    _utterance(ws)
    await _wait_until(lambda: any(f["type"] == "error" for f in ws.sent_text))
    ws.push_disconnect()
    await task  # would have raised via fail_if_called if scoring were ever reached

    errors = [f for f in ws.sent_text if f["type"] == "error"]
    assert any(e["code"] == "non_english" for e in errors)


@pytest.mark.usefixtures("stub_db", "stub_tts")
async def test_disconnect_mid_interview_persists_as_incomplete(monkeypatch):
    monkeypatch.setattr(brain, "generate_questions",
                        lambda role, seniority, count, *, settings: ["Q1?", "Q2?"])
    monkeypatch.setattr(brain, "score_answer",
                        lambda role, seniority, q, a, *, settings: RubricScore(
                            structure=4, specificity=4, correctness=4, conciseness=4,
                        ))
    monkeypatch.setattr(brain, "coach_stream",
                        lambda role, seniority, q, rubric, *, settings: iter(["Ok."]))

    ws = FakeWebSocket()
    task = asyncio.create_task(session_module.SessionController(ws).run())
    ws.push_text(type="start_session", role="eng", seniority="senior", question_count=2)
    await _wait_until(lambda: _event_types(ws).count("question") == 1)
    ws.push_text(type="typed_answer", text="only answer before disconnect")
    # Wait for Q2 to actually be asked (i.e. the first turn is fully done)
    # before disconnecting, so this is a clean "gone while listening" case
    # rather than a race with the first answer's own processing.
    await _wait_until(lambda: _event_types(ws).count("question") == 2)
    ws.push_disconnect()
    await task

    assert not any(f["type"] == "report" for f in ws.sent_text)
    persisted = sessions_store.get_session(_session_id(ws))
    assert persisted["status"] == "incomplete"
    assert len(persisted["turns"]) == 1


@pytest.mark.usefixtures("stub_db", "stub_tts")
async def test_question_generation_failure_persists_incomplete_not_stuck_running(monkeypatch):
    def fail(*a, **kw):
        raise RuntimeError("all providers exhausted")

    monkeypatch.setattr(brain, "generate_questions", fail)

    ws = FakeWebSocket()
    task = asyncio.create_task(session_module.SessionController(ws).run())
    ws.push_text(type="start_session", role="eng", seniority="senior", question_count=1)
    await _wait_until(lambda: any(f["type"] == "error" for f in ws.sent_text))
    ws.push_disconnect()
    await task

    errors = [f for f in ws.sent_text if f["type"] == "error"]
    assert any(e["code"] == "questions_failed" and not e["recoverable"] for e in errors)
    persisted = sessions_store.get_session(_session_id(ws))
    assert persisted["status"] == "incomplete"  # not left dangling as "running" forever


@pytest.mark.usefixtures("stub_db", "stub_tts")
async def test_barge_in_is_processed_while_speech_is_still_in_flight(monkeypatch):
    """The regression this guards: turn processing used to run inline in the
    receive loop, so a barge_in sent mid-speech sat unread until the speech
    it was meant to interrupt had already finished on its own. Coaching here
    yields slowly (via a real asyncio.sleep in the drained-in-a-thread
    generator) so the turn is still speaking when barge_in arrives; if the
    fix regresses, tts_end's `interrupted` flag comes back False instead of
    True, or barge_in's ack never arrives before a generous timeout.
    """
    monkeypatch.setattr(brain, "generate_questions",
                        lambda role, seniority, count, *, settings: ["Q1?"])
    monkeypatch.setattr(brain, "score_answer",
                        lambda role, seniority, q, a, *, settings: RubricScore(
                            structure=4, specificity=4, correctness=4, conciseness=4,
                        ))

    def slow_coach_stream(role, seniority, q, rubric, *, settings):
        import time
        for chunk in ["This is a long coaching answer. ", "It keeps going for a while. ", "Still talking. "]:
            time.sleep(0.1)  # runs in a worker thread (see session.py's speak_stream) — safe to block
            yield chunk

    monkeypatch.setattr(brain, "coach_stream", slow_coach_stream)

    ws = FakeWebSocket()
    task = asyncio.create_task(session_module.SessionController(ws).run())
    ws.push_text(type="start_session", role="eng", seniority="senior", question_count=1)
    await _wait_until(lambda: any(f["type"] == "question" for f in ws.sent_text))
    ws.push_text(type="typed_answer", text="answer")
    await _wait_until(lambda: any(f["type"] == "coaching_delta" for f in ws.sent_text))

    # Coaching is now streaming (slowly) — send barge_in and confirm the
    # receive loop reacts to it before coaching would have finished on its own.
    ws.push_text(type="barge_in")
    await _wait_until(lambda: any(f["type"] == "tts_end" for f in ws.sent_text), timeout=1.0)
    ws.push_disconnect()
    await task

    tts_ends = [f for f in ws.sent_text if f["type"] == "tts_end"]
    assert any(f["interrupted"] for f in tts_ends), (
        "barge_in never interrupted the in-flight coaching — "
        "the receive loop is blocking on turn processing again"
    )


@pytest.mark.usefixtures("stub_db", "stub_tts")
async def test_asking_state_is_emitted_before_listening(monkeypatch):
    """The client enables the mic during 'asking' so you can answer/barge in
    while the question is still being spoken. If ask_question stops emitting
    the asking state, the mic stays greyed out for the whole question."""
    monkeypatch.setattr(brain, "generate_questions",
                        lambda role, seniority, count, *, settings: ["Tell me about a project."])
    monkeypatch.setattr(brain, "score_answer",
                        lambda role, seniority, q, a, *, settings: RubricScore(
                            structure=4, specificity=4, correctness=4, conciseness=4,
                        ))
    monkeypatch.setattr(brain, "coach_stream",
                        lambda role, seniority, q, rubric, *, settings: iter(["Ok."]))

    ws = FakeWebSocket()
    task = asyncio.create_task(session_module.SessionController(ws).run())
    ws.push_text(type="start_session", role="eng", seniority="senior", question_count=1)
    await _wait_until(lambda: any(
        f["type"] == "state" and f.get("state") == "listening" for f in ws.sent_text))
    ws.push_disconnect()
    await task

    states = [f["state"] for f in ws.sent_text if f["type"] == "state"]
    assert "asking" in states, "no 'asking' state — mic stays disabled during the question"
    # asking must come before the first listening (i.e. during the question, not after).
    assert states.index("asking") < states.index("listening")


@pytest.mark.usefixtures("stub_db")
async def test_barge_in_during_question_folds_to_listening_without_error(monkeypatch):
    """Barge-in during the question (now reachable, since the mic is live while
    ASKING) must not hit the double LISTENING->LISTENING transition that
    ask_question's tail would otherwise cause. Guards the idempotent-tail fix:
    a barge_in mid-question, then a typed answer, must score cleanly to report."""
    monkeypatch.setattr(brain, "generate_questions",
                        lambda role, seniority, count, *, settings: ["A long question that is still being spoken."])
    monkeypatch.setattr(brain, "score_answer",
                        lambda role, seniority, q, a, *, settings: RubricScore(
                            structure=4, specificity=4, correctness=4, conciseness=4,
                        ))
    monkeypatch.setattr(brain, "coach_stream",
                        lambda role, seniority, q, rubric, *, settings: iter(["Ok."]))

    # Slow question synthesis so the barge_in lands while the question is still
    # being spoken (ASKING), not after it has finished (LISTENING).
    def slow_synth(text):
        import time
        time.sleep(0.15)
        return b"FAKEWAV"

    monkeypatch.setattr(tts, "synth_sentence", slow_synth)

    ws = FakeWebSocket()
    task = asyncio.create_task(session_module.SessionController(ws).run())
    ws.push_text(type="start_session", role="eng", seniority="senior", question_count=1)
    # Wait until the question's audio is actually flowing (ASKING), then barge in.
    await _wait_until(lambda: any(f["type"] == "tts_chunk" for f in ws.sent_text))
    ws.push_text(type="barge_in")
    await _wait_until(lambda: any(
        f["type"] == "state" and f.get("state") == "listening" for f in ws.sent_text))
    ws.push_text(type="typed_answer", text="Here is my actual answer after barging in.")
    await _wait_until(lambda: any(f["type"] == "report" for f in ws.sent_text))
    ws.push_disconnect()
    await task

    # The turn task never died on an illegal transition: we reached a report
    # with the answer scored and persisted.
    report = next(f for f in ws.sent_text if f["type"] == "report")["report"]
    assert len(report["turns"]) == 1
    assert report["turns"][0]["answer_source"] == "typed"
    assert sessions_store.get_session(_session_id(ws))["status"] == "completed"
