"""Kokoro TTS smoke test — THE Phase-1 go/no-go gate.

Verifies that kokoro-onnx (and its phonemizer/espeak dependency chain) actually
works on this machine before anything else gets built. Writes smoke_tts_out.wav
and prints the real-time factor (synthesis seconds per second of audio).

    python scripts/smoke_tts.py
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from app.config import get_settings  # noqa: E402

TEXT = (
    "Hello! I'm your interview coach. Tell me about a time you had to debug "
    "a production incident under pressure."
)


def main() -> int:
    settings = get_settings()
    model, voices = settings.kokoro_model_file, settings.kokoro_voices_file
    if not model.is_file() or not voices.is_file():
        print(f"Model files missing — run: python scripts/download_models.py\n"
              f"  expected: {model}\n  expected: {voices}")
        return 1

    print("Importing kokoro_onnx (pulls onnxruntime + phonemizer/espeak)...")
    t0 = time.perf_counter()
    from kokoro_onnx import Kokoro  # noqa: E402  (import inside main: measure it)
    print(f"  import ok in {time.perf_counter() - t0:.1f}s")

    print("Loading model...")
    t0 = time.perf_counter()
    kokoro = Kokoro(str(model), str(voices))
    print(f"  loaded in {time.perf_counter() - t0:.1f}s")

    print(f"Synthesizing ({settings.kokoro_voice}): {TEXT[:60]}...")
    t0 = time.perf_counter()
    samples, sample_rate = kokoro.create(
        TEXT, voice=settings.kokoro_voice, speed=settings.kokoro_speed
    )
    synth_s = time.perf_counter() - t0
    audio_s = len(samples) / sample_rate
    print(f"  {audio_s:.1f}s of audio in {synth_s:.1f}s "
          f"(real-time factor {synth_s / audio_s:.2f}x — <1.0 means faster than real time)")

    out = Path(__file__).parent / "smoke_tts_out.wav"
    import soundfile as sf
    sf.write(out, samples, sample_rate)
    print(f"Wrote {out} — play it to confirm it sounds right.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
