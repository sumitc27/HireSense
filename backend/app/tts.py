"""Text-to-speech via Kokoro-82M (local CPU, zero cost).

The ~325MB ONNX model is loaded ONCE (lifespan calls ``warm_up``) and reused
for every sentence. Synthesis is CPU-bound and blocking — callers run
``synth_sentence`` in ``asyncio.to_thread``.

The incremental sentence splitter is what makes sentence-by-sentence TTS
streaming work: LLM tokens are fed in as they arrive, and complete sentences
come out as soon as their terminator lands — the first sentence is speaking
while the rest of the coaching is still being generated.
"""
from __future__ import annotations

import io
import logging
import re
import struct
import time

import numpy as np

from .config import get_settings
from .tracing_compat import observe

logger = logging.getLogger("hiresense.tts")

_kokoro = None
_load_error: str | None = None

# A sentence ends at . ! ? (optionally followed by closing quotes/parens),
# then whitespace. Abbreviation false-positives are acceptable here — a split
# mid-"e.g." just produces a shorter audio chunk, not a wrong one.
_SENT_END_RE = re.compile(r"(?<=[.!?])[\"')\]]*\s+")
_MIN_SENTENCE_CHARS = 12   # merge fragments shorter than this into the next one


def warm_up() -> bool:
    """Load the Kokoro model (call from lifespan via asyncio.to_thread)."""
    global _kokoro, _load_error
    if _kokoro is not None:
        return True
    settings = get_settings()
    model, voices = settings.kokoro_model_file, settings.kokoro_voices_file
    if not model.is_file() or not voices.is_file():
        _load_error = (f"Kokoro model files missing — run "
                       f"`python scripts/download_models.py` (expected {model.name}, {voices.name})")
        logger.error("[tts] %s", _load_error)
        return False
    try:
        t0 = time.perf_counter()
        from kokoro_onnx import Kokoro
        _kokoro = Kokoro(str(model), str(voices))
        logger.info("[tts] Kokoro loaded in %.1fs", time.perf_counter() - t0)
        return True
    except Exception as e:
        _load_error = f"Kokoro failed to load: {e}"
        logger.exception("[tts] load failed")
        return False


def is_ready() -> bool:
    return _kokoro is not None


def load_error() -> str | None:
    return _load_error


def _float32_to_wav(samples: np.ndarray, sample_rate: int) -> bytes:
    """Convert Kokoro's float32 output to a self-contained 16-bit PCM WAV.

    Self-contained per-sentence WAVs keep the client trivial: each chunk is
    independently decodable (decodeAudioData) and barge-in is just "stop the
    queue" — no container/stream state to unwind.
    """
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    header = b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVE"
    header += b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, sample_rate,
                                    sample_rate * 2, 2, 16)
    header += b"data" + struct.pack("<I", len(pcm))
    return header + pcm


@observe(name="tts-synthesize")
def synth_sentence(text: str) -> bytes | None:
    """Synthesize one sentence to WAV bytes. Returns None on failure —
    the session degrades to captions-only rather than dying."""
    if _kokoro is None:
        return None
    settings = get_settings()
    try:
        t0 = time.perf_counter()
        samples, sample_rate = _kokoro.create(
            text, voice=settings.kokoro_voice, speed=settings.kokoro_speed
        )
        wav = _float32_to_wav(samples, sample_rate)
        logger.debug("[tts] %d chars -> %.1fs audio in %.1fs",
                     len(text), len(samples) / sample_rate, time.perf_counter() - t0)
        return wav
    except Exception:
        logger.exception("[tts] synthesis failed for: %.60s", text)
        return None


class SentenceSplitter:
    """Incremental sentence splitter for token streams.

    feed(token) yields complete sentences as they finish; flush() returns any
    trailing fragment. Fragments shorter than _MIN_SENTENCE_CHARS are merged
    forward so the TTS never speaks stub chunks like "1." on their own.
    """

    def __init__(self) -> None:
        self._buf = ""

    def feed(self, token: str) -> list[str]:
        self._buf += token
        out: list[str] = []
        while True:
            m = _SENT_END_RE.search(self._buf)
            if not m:
                break
            candidate = self._buf[: m.end()].strip()
            rest = self._buf[m.end():]
            if len(candidate) < _MIN_SENTENCE_CHARS:
                # Too short to speak alone — keep accumulating.
                break
            out.append(candidate)
            self._buf = rest
        return out

    def flush(self) -> str | None:
        tail = self._buf.strip()
        self._buf = ""
        return tail or None
