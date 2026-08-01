"""Speech-to-text via Groq Whisper (free tier, ~2K requests/day).

Whisper is a batch API, not a streaming one — HireSense sends one complete
utterance blob (webm/opus from MediaRecorder, or WAV in tests/eval) per call.
The client enforces a minimum utterance length so short blips never burn a
request (Groq bills a 10-second minimum per transcription).
"""
from __future__ import annotations

import io
import logging
import time
from dataclasses import dataclass

from groq import Groq

from .config import get_settings
from .tracing_compat import observe

logger = logging.getLogger("hiresense.stt")

_client: Groq | None = None


def _get_client() -> Groq:
    global _client
    if _client is None:
        _client = Groq()  # reads GROQ_API_KEY
    return _client


@dataclass
class SttResult:
    text: str
    language: str          # ISO-ish name Whisper reports, e.g. "english"
    stt_ms: int
    ok: bool = True
    error: str | None = None    # "rate_limited" | "failed" when ok=False


@observe(name="stt-transcribe")
def transcribe(audio_bytes: bytes, filename: str = "utterance.webm") -> SttResult:
    """Transcribe one utterance. Retries a 429 once; never raises —
    the session loop decides how to degrade (typed-input fallback)."""
    settings = get_settings()
    t0 = time.perf_counter()
    last_error = "failed"
    for attempt in range(2):
        try:
            result = _get_client().audio.transcriptions.create(
                file=(filename, io.BytesIO(audio_bytes)),
                model=settings.stt_model,
                response_format="verbose_json",
            )
            ms = int((time.perf_counter() - t0) * 1000)
            text = (result.text or "").strip()
            language = (getattr(result, "language", None) or "unknown").lower()
            logger.info("[stt] %d bytes -> %d chars (%s) in %dms",
                        len(audio_bytes), len(text), language, ms)
            return SttResult(text=text, language=language, stt_ms=ms)
        except Exception as e:
            msg = str(e).lower()
            rate_limited = "429" in msg or "rate limit" in msg or "rate_limit" in msg
            last_error = "rate_limited" if rate_limited else "failed"
            logger.warning("[stt] attempt %d failed (%s): %s", attempt + 1, last_error, str(e)[:200])
            if attempt == 0:
                time.sleep(2)  # one short backoff, then give up to the caller
    return SttResult(
        text="", language="unknown",
        stt_ms=int((time.perf_counter() - t0) * 1000),
        ok=False, error=last_error,
    )
