"""Keyless tests for the incremental sentence splitter (no Kokoro model needed —
this only exercises the pure text-splitting logic in tts.py)."""
from app.tts import SentenceSplitter


def _feed_all(splitter: SentenceSplitter, tokens: list[str]) -> list[str]:
    out: list[str] = []
    for tok in tokens:
        out.extend(splitter.feed(tok))
    if (tail := splitter.flush()) is not None:
        out.append(tail)
    return out


def test_splits_on_sentence_boundaries_as_tokens_arrive():
    splitter = SentenceSplitter()
    tokens = ["Hello there", ", how are you", "? I am doing well", ". Thanks for asking", "."]
    sentences = _feed_all(splitter, tokens)
    assert sentences == ["Hello there, how are you?", "I am doing well.", "Thanks for asking."]


def test_short_fragments_merge_forward_into_next_sentence():
    splitter = SentenceSplitter()
    # "Ok." alone is under _MIN_SENTENCE_CHARS (12) and should not be spoken alone.
    sentences = _feed_all(splitter, ["Ok. ", "That works for me, thanks a lot."])
    assert sentences == ["Ok. That works for me, thanks a lot."]


def test_flush_returns_trailing_fragment_without_terminator():
    splitter = SentenceSplitter()
    splitter.feed("This never finishes")
    tail = splitter.flush()
    assert tail == "This never finishes"


def test_flush_on_empty_buffer_returns_none():
    splitter = SentenceSplitter()
    assert splitter.flush() is None


def test_feed_returns_empty_list_mid_sentence():
    splitter = SentenceSplitter()
    assert splitter.feed("No terminator yet") == []


def test_quotes_and_parens_after_terminator_are_included():
    splitter = SentenceSplitter()
    sentences = _feed_all(splitter, ['She said "go home." ', "Then left."])
    assert sentences[0] == 'She said "go home."'
