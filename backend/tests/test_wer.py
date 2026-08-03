"""Keyless test of the hand-rolled word-error-rate function used by
eval/run_wer_eval.py — pure string math, no Kokoro/Whisper involved."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "eval"))
from run_wer_eval import wer  # noqa: E402


def test_identical_strings_have_zero_wer():
    assert wer("the quick brown fox", "the quick brown fox") == 0.0


def test_one_insertion():
    assert wer("the quick brown fox", "the quick brown fox jumps") == 0.25


def test_one_deletion():
    assert wer("the quick brown fox", "the quick fox") == 0.25


def test_one_substitution():
    assert wer("the quick brown fox", "the slow brown fox") == 0.25


def test_case_and_punctuation_are_normalized_away():
    assert wer("Hello, world!", "hello world") == 0.0


def test_empty_reference_returns_zero_not_divide_by_zero():
    assert wer("", "some hypothesis") == 0.0


def test_completely_wrong_hypothesis_has_high_wer():
    assert wer("the quick brown fox", "completely different words entirely") > 0.5
