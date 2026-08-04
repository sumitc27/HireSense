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
    """Load the Kokoro model (call from lifespan via asyncio.to_thread) or verify external API providers."""
    global _kokoro, _load_error
    settings = get_settings()
    if settings.tts_provider == "elevenlabs":
        if not settings.elevenlabs_api_key:
            _load_error = "ElevenLabs API Key is missing. Add ELEVENLABS_API_KEY to your .env"
            logger.error("[tts] %s", _load_error)
            return False
        logger.info("[tts] ElevenLabs provider initialized")
        return True
    elif settings.tts_provider == "cartesia":
        if not settings.cartesia_api_key:
            _load_error = "Cartesia API Key is missing. Add CARTESIA_API_KEY to your .env"
            logger.error("[tts] %s", _load_error)
            return False
        logger.info("[tts] Cartesia provider initialized")
        return True

    if _kokoro is not None:
        return True
    model, voices = settings.kokoro_model_file, settings.kokoro_voices_file
    if not model.is_file() or not voices.is_file():
        _load_error = (f"Kokoro model files missing — run "
                       f"`python scripts/download_models.py` (expected {model.name}, {voices.name})")
        logger.error("[tts] %s", _load_error)
        return False
    try:
        t0 = time.perf_counter()
        import onnxruntime
        import os
        from kokoro_onnx import Kokoro
        
        sess_options = onnxruntime.SessionOptions()
        # 4 threads is the sweet spot in our benchmarks (21% faster than default)
        sess_options.intra_op_num_threads = min(4, os.cpu_count() or 1)
        sess_options.inter_op_num_threads = 1
        sess_options.graph_optimization_level = onnxruntime.GraphOptimizationLevel.ORT_ENABLE_ALL
        
        session = onnxruntime.InferenceSession(
            str(model),
            sess_options=sess_options,
            providers=["CPUExecutionProvider"]
        )
        _kokoro = Kokoro.from_session(session, str(voices))
        logger.info("[tts] Kokoro loaded with optimized ONNX session (threads=%d) in %.1fs", 
                    sess_options.intra_op_num_threads, time.perf_counter() - t0)
        return True
    except Exception as e:
        _load_error = f"Kokoro failed to load: {e}"
        logger.exception("[tts] load failed")
        return False


def is_ready() -> bool:
    settings = get_settings()
    if settings.tts_provider == "elevenlabs":
        return bool(settings.elevenlabs_api_key)
    elif settings.tts_provider == "cartesia":
        return bool(settings.cartesia_api_key)
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
    """Synthesize one sentence. Supports local Kokoro ONNX, ElevenLabs API, and Cartesia API."""
    settings = get_settings()
    if settings.tts_provider == "elevenlabs":
        if not settings.elevenlabs_api_key:
            logger.error("[tts] ElevenLabs API key missing during synthesis")
            return None
        try:
            t0 = time.perf_counter()
            import requests
            url = f"https://api.elevenlabs.io/v1/text-to-speech/{settings.elevenlabs_voice_id}"
            headers = {
                "xi-api-key": settings.elevenlabs_api_key,
                "Content-Type": "application/json",
            }
            data = {
                "text": text,
                "model_id": settings.elevenlabs_model_id,
                "voice_settings": {
                    "stability": 0.5,
                    "similarity_boost": 0.75
                }
            }
            params = {
                "output_format": "mp3_44100_128"
            }
            resp = requests.post(url, headers=headers, json=data, params=params, timeout=10)
            if resp.status_code != 200:
                logger.error("[tts] ElevenLabs API error: %d, body: %s", resp.status_code, resp.text[:200])
                return None
            
            audio_bytes = resp.content
            logger.info("[tts] ElevenLabs: %d chars -> %d bytes MP3 in %.3fs",
                        len(text), len(audio_bytes), time.perf_counter() - t0)
            return audio_bytes
        except Exception:
            logger.exception("[tts] ElevenLabs synthesis failed for: %.60s", text)
            return None

    elif settings.tts_provider == "cartesia":
        if not settings.cartesia_api_key:
            logger.error("[tts] Cartesia API key missing during synthesis")
            return None
        try:
            t0 = time.perf_counter()
            import requests
            url = "https://api.cartesia.ai/tts/bytes"
            headers = {
                "Cartesia-Version": "2026-03-01",
                "X-API-Key": settings.cartesia_api_key,
                "Content-Type": "application/json"
            }
            payload = {
                "model_id": settings.cartesia_model_id,
                "transcript": text,
                "voice": {
                    "mode": "id",
                    "id": settings.cartesia_voice_id
                },
                "output_format": {
                    "container": "wav",
                    "encoding": "pcm_s16le",
                    "sample_rate": 44100
                },
                "generation_config": {
                    "speed": 1,
                    "volume": 1
                }
            }
            resp = requests.post(url, json=payload, headers=headers, timeout=10)
            if resp.status_code != 200:
                logger.error("[tts] Cartesia API error: %d, body: %s", resp.status_code, resp.text[:200])
                return None
            
            audio_bytes = resp.content
            logger.info("[tts] Cartesia: %d chars -> %d bytes WAV in %.3fs",
                        len(text), len(audio_bytes), time.perf_counter() - t0)
            return audio_bytes
        except Exception:
            logger.exception("[tts] Cartesia synthesis failed for: %.60s", text)
            return None

    # Default to Kokoro local ONNX
    if _kokoro is None:
        return None
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
