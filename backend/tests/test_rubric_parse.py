"""Keyless tests for lenient JSON parsing (brain.py) and the rubric models.

gpt-oss and other free models occasionally wrap JSON in code fences, prose,
or emit fullwidth CJK brackets instead of ASCII — these fixtures cover the
malformed shapes actually observed, not hypothetical ones.
"""
import json

from app.brain import _clean_json_text, _parse_lenient
from app.rubric import QuestionBank, Report, RubricScore, TurnRecord

_VALID_RUBRIC = {
    "structure": 4, "specificity": 3, "correctness": 5, "conciseness": 2,
    "strengths": ["clear narrative"], "improvements": ["too long"],
    "follow_up_needed": False, "follow_up_question": None,
}


def test_parse_lenient_accepts_plain_json():
    result = _parse_lenient(json.dumps(_VALID_RUBRIC), RubricScore)
    assert isinstance(result, RubricScore)
    assert result.overall == 3.5


def test_parse_lenient_strips_markdown_fences():
    text = f"```json\n{json.dumps(_VALID_RUBRIC)}\n```"
    result = _parse_lenient(text, RubricScore)
    assert isinstance(result, RubricScore)


def test_parse_lenient_extracts_json_from_prose_wrapper():
    text = f"Sure, here's the score:\n{json.dumps(_VALID_RUBRIC)}\nLet me know if you need more."
    result = _parse_lenient(text, RubricScore)
    assert isinstance(result, RubricScore)


def test_parse_lenient_converts_fullwidth_brackets():
    # Some free models emit 【】 instead of straight [] around arrays.
    payload = _VALID_RUBRIC.copy()
    text = json.dumps(payload).replace('["clear narrative"]', '【"clear narrative"】')
    result = _parse_lenient(text, RubricScore)
    assert isinstance(result, RubricScore)
    assert result.strengths == ["clear narrative"]


def test_parse_lenient_returns_none_on_garbage():
    assert _parse_lenient("not json at all, sorry!", RubricScore) is None


def test_parse_lenient_rejects_out_of_range_scores():
    bad = _VALID_RUBRIC.copy()
    bad["structure"] = 9  # out of the 1-5 range — should fail validation
    assert _parse_lenient(json.dumps(bad), RubricScore) is None


def test_clean_json_text_extracts_outer_brace_span():
    cleaned = _clean_json_text('prefix noise {"a": 1} trailing noise')
    assert json.loads(cleaned) == {"a": 1}


def test_question_bank_parses():
    bank = _parse_lenient(json.dumps({"questions": ["Q1?", "Q2?"]}), QuestionBank)
    assert isinstance(bank, QuestionBank)
    assert bank.questions == ["Q1?", "Q2?"]


def test_rubric_overall_is_average_of_four_dimensions():
    r = RubricScore(structure=5, specificity=5, correctness=5, conciseness=5)
    assert r.overall == 5.0
    r2 = RubricScore(structure=1, specificity=2, correctness=3, conciseness=4)
    assert r2.overall == 2.5


def test_report_overall_average_ignores_unscored_turns():
    turns = [
        TurnRecord(turn_id="t1", question_index=0, is_follow_up=False,
                   question_text="Q1", answer_text="A1", answer_source="voice",
                   rubric=RubricScore(structure=4, specificity=4, correctness=4, conciseness=4)),
        TurnRecord(turn_id="t2", question_index=1, is_follow_up=False,
                   question_text="Q2", answer_text="A2", answer_source="typed",
                   rubric=None),  # e.g. scoring failed and no fallback was recorded
    ]
    report = Report(role="backend engineer", seniority="senior", turns=turns)
    assert report.overall_average == 4.0


def test_report_top_improvements_dedupes_and_caps_at_three():
    def turn(imps):
        return TurnRecord(
            turn_id="t", question_index=0, is_follow_up=False,
            question_text="Q", answer_text="A", answer_source="voice",
            rubric=RubricScore(structure=3, specificity=3, correctness=3, conciseness=3,
                              improvements=imps),
        )

    report = Report(role="r", seniority="s", turns=[
        turn(["be more specific", "add metrics"]),
        turn(["be more specific", "explain trade-offs", "mention testing"]),
    ])
    assert report.top_improvements == ["be more specific", "add metrics", "explain trade-offs"]
