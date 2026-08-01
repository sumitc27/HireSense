"""Groq Whisper STT smoke test.

Transcribes the WAV produced by smoke_tts.py (run that first), closing the
loop: local TTS -> Groq STT. Needs GROQ_API_KEY (env var or .env).

    python scripts/smoke_stt.py [path/to/audio.(wav|webm|mp3)]
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from app.config import get_settings  # noqa: E402


def main() -> int:
    audio = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "smoke_tts_out.wav"
    if not audio.is_file():
        print(f"No audio file at {audio} — run scripts/smoke_tts.py first.")
        return 1

    from groq import Groq
    settings = get_settings()
    client = Groq()

    print(f"Transcribing {audio.name} with {settings.stt_model} ...")
    t0 = time.perf_counter()
    with open(audio, "rb") as f:
        result = client.audio.transcriptions.create(
            file=(audio.name, f),
            model=settings.stt_model,
            response_format="verbose_json",
        )
    ms = (time.perf_counter() - t0) * 1000
    print(f"  done in {ms:.0f}ms")
    print(f"  language: {getattr(result, 'language', '?')}")
    print(f"  text: {result.text}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
