"""The interview session's pure state machine + latency clock.

Deliberately I/O-free (no sockets, no LLM, no audio) so the entire turn logic
is unit-testable without keys, models, or a browser:

    idle -> generating_questions -> asking -> listening -> transcribing
         -> scoring -> coaching -> (asking: follow-up or next question) | report -> done

``SessionController`` (session.py) owns the side effects and drives this.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum


class TurnState(str, Enum):
    IDLE = "idle"
    GENERATING_QUESTIONS = "generating_questions"
    ASKING = "asking"
    LISTENING = "listening"
    TRANSCRIBING = "transcribing"
    SCORING = "scoring"
    COACHING = "coaching"
    REPORT = "report"
    DONE = "done"


_ALLOWED: dict[TurnState, set[TurnState]] = {
    TurnState.IDLE: {TurnState.GENERATING_QUESTIONS},
    TurnState.GENERATING_QUESTIONS: {TurnState.ASKING, TurnState.DONE},
    TurnState.ASKING: {TurnState.LISTENING, TurnState.DONE},
    # barge-in while coaching goes straight back to LISTENING
    TurnState.LISTENING: {TurnState.TRANSCRIBING, TurnState.SCORING, TurnState.REPORT, TurnState.DONE},
    TurnState.TRANSCRIBING: {TurnState.SCORING, TurnState.LISTENING, TurnState.DONE},
    TurnState.SCORING: {TurnState.COACHING, TurnState.LISTENING, TurnState.DONE},
    TurnState.COACHING: {TurnState.ASKING, TurnState.LISTENING, TurnState.REPORT, TurnState.DONE},
    TurnState.REPORT: {TurnState.DONE},
    TurnState.DONE: set(),
}

# Latency stages, in pipeline order. All values are ms offsets from t0
# (the moment the utterance's audio arrived), captured with perf_counter.
STAGE_UTTERANCE = "utterance_received"
STAGE_STT = "stt_done"
STAGE_LLM_FIRST = "llm_first_token"
STAGE_TTS_FIRST = "tts_first_chunk"
STAGE_PLAYBACK = "playback_started"   # reported by the client


class LatencyClock:
    """Per-turn stage timings. mark() is idempotent per stage (first wins)."""

    def __init__(self) -> None:
        self._marks: dict[str, float] = {}

    def mark(self, stage: str) -> None:
        self._marks.setdefault(stage, time.perf_counter())

    def mark_client(self, stage: str) -> None:
        """For client-reported events (playback_started): stamp arrival time.
        Includes one WS hop of skew — acceptable at localhost/demo scale."""
        self.mark(stage)

    def stages_ms(self) -> dict[str, int]:
        """Offsets from t0 (utterance_received) in ms, plus derived e2e."""
        t0 = self._marks.get(STAGE_UTTERANCE)
        if t0 is None:
            return {}
        out = {
            name: int((t - t0) * 1000)
            for name, t in self._marks.items()
            if name != STAGE_UTTERANCE
        }
        if STAGE_PLAYBACK in self._marks:
            out["e2e_ms"] = int((self._marks[STAGE_PLAYBACK] - t0) * 1000)
        return out


@dataclass
class TurnPlan:
    """What the machine decides should happen next after coaching a turn."""
    kind: str                      # "follow_up" | "next_question" | "report"
    question_index: int = 0        # for next_question


@dataclass
class TurnMachine:
    """Tracks state + question progression. Raises on illegal transitions —
    an illegal transition is a programming bug, not a runtime condition."""

    question_count: int
    state: TurnState = TurnState.IDLE
    question_index: int = 0            # 0-based index into the main question bank
    turn_seq: int = 0                  # monotonically increasing turn id source
    in_follow_up: bool = False
    follow_ups_used: dict[int, bool] = field(default_factory=dict)

    def to(self, new_state: TurnState) -> None:
        if new_state not in _ALLOWED[self.state]:
            raise ValueError(f"illegal transition {self.state.value} -> {new_state.value}")
        self.state = new_state

    def next_turn_id(self) -> str:
        self.turn_seq += 1
        return f"t{self.turn_seq}"

    def plan_after_coaching(self, follow_up_needed: bool) -> TurnPlan:
        """Decide what follows the coaching of the current answer.

        Follow-ups are capped at one per main question (so sessions always
        terminate), and a follow-up's own answer never spawns another.
        """
        if (
            follow_up_needed
            and not self.in_follow_up
            and not self.follow_ups_used.get(self.question_index)
        ):
            self.follow_ups_used[self.question_index] = True
            self.in_follow_up = True
            return TurnPlan(kind="follow_up", question_index=self.question_index)

        self.in_follow_up = False
        nxt = self.question_index + 1
        if nxt >= self.question_count:
            return TurnPlan(kind="report")
        self.question_index = nxt
        return TurnPlan(kind="next_question", question_index=nxt)
