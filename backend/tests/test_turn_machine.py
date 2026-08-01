"""Pure unit tests for the turn state machine — no keys, no models, no I/O."""
import pytest

from app.turn_machine import (
    STAGE_PLAYBACK,
    STAGE_STT,
    STAGE_TTS_FIRST,
    STAGE_UTTERANCE,
    LatencyClock,
    TurnMachine,
    TurnState,
)


def _walk_one_turn(tm: TurnMachine) -> None:
    """Drive one question/answer/coaching cycle: ASKING -> ... -> COACHING."""
    tm.to(TurnState.ASKING)
    tm.to(TurnState.LISTENING)
    tm.to(TurnState.TRANSCRIBING)
    tm.to(TurnState.SCORING)
    tm.to(TurnState.COACHING)


def test_full_session_reaches_report_after_all_questions():
    tm = TurnMachine(question_count=2)
    tm.to(TurnState.GENERATING_QUESTIONS)
    _walk_one_turn(tm)
    plan1 = tm.plan_after_coaching(follow_up_needed=False)
    assert plan1.kind == "next_question"
    assert plan1.question_index == 1

    _walk_one_turn(tm)
    plan2 = tm.plan_after_coaching(follow_up_needed=False)
    assert plan2.kind == "report"

    tm.to(TurnState.REPORT)
    tm.to(TurnState.DONE)


def test_follow_up_is_capped_at_one_per_question():
    tm = TurnMachine(question_count=1)
    tm.to(TurnState.GENERATING_QUESTIONS)
    _walk_one_turn(tm)

    plan1 = tm.plan_after_coaching(follow_up_needed=True)
    assert plan1.kind == "follow_up"
    assert plan1.question_index == 0
    assert tm.in_follow_up is True

    # Answering the follow-up itself: even if the model asks for ANOTHER
    # follow-up, the cap forces progression (here: report, since count=1).
    _walk_one_turn(tm)
    plan2 = tm.plan_after_coaching(follow_up_needed=True)
    assert plan2.kind == "report"
    assert tm.in_follow_up is False


def test_illegal_transition_raises():
    tm = TurnMachine(question_count=1)
    with pytest.raises(ValueError):
        tm.to(TurnState.ASKING)  # IDLE -> ASKING skips GENERATING_QUESTIONS


def test_barge_in_paths_are_allowed_back_to_listening():
    tm = TurnMachine(question_count=1)
    tm.to(TurnState.GENERATING_QUESTIONS)
    tm.to(TurnState.ASKING)
    tm.to(TurnState.LISTENING)  # barge-in while the question is being asked
    tm.to(TurnState.TRANSCRIBING)
    tm.to(TurnState.SCORING)
    tm.to(TurnState.COACHING)
    tm.to(TurnState.LISTENING)  # barge-in while the coach is still talking


def test_typed_answer_can_skip_transcribing():
    tm = TurnMachine(question_count=1)
    tm.to(TurnState.GENERATING_QUESTIONS)
    tm.to(TurnState.ASKING)
    tm.to(TurnState.LISTENING)
    tm.to(TurnState.SCORING)  # no STT for a typed answer
    assert tm.state is TurnState.SCORING


def test_latency_clock_computes_stage_offsets_and_e2e():
    clock = LatencyClock()
    clock.mark(STAGE_UTTERANCE)
    clock.mark(STAGE_STT)
    clock.mark(STAGE_TTS_FIRST)
    clock.mark_client(STAGE_PLAYBACK)

    stages = clock.stages_ms()
    assert STAGE_UTTERANCE not in stages  # t0 itself isn't reported
    assert stages[STAGE_STT] >= 0
    assert stages[STAGE_TTS_FIRST] >= stages[STAGE_STT]
    assert "e2e_ms" in stages
    assert stages["e2e_ms"] >= stages[STAGE_TTS_FIRST]


def test_latency_clock_mark_is_idempotent_first_wins():
    clock = LatencyClock()
    clock.mark(STAGE_UTTERANCE)
    clock.mark(STAGE_STT)
    first = clock.stages_ms()[STAGE_STT]
    clock.mark(STAGE_STT)  # second call should not move the mark
    assert clock.stages_ms()[STAGE_STT] == first


def test_next_turn_id_is_monotonic():
    tm = TurnMachine(question_count=3)
    ids = [tm.next_turn_id() for _ in range(3)]
    assert ids == ["t1", "t2", "t3"]
