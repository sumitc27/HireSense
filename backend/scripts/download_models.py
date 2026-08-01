"""Download the Kokoro-82M ONNX model files (~310MB total, one-time).

The weights are Apache-2.0, hosted on the kokoro-onnx project's GitHub releases.
They are gitignored — every fresh clone runs this once:

    python scripts/download_models.py
"""
from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from app.config import get_settings  # noqa: E402

_RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
_FILES = {
    "kokoro-v1.0.onnx": "kokoro_model_file",
    "voices-v1.0.bin": "kokoro_voices_file",
}


def _download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")

    def hook(blocks: int, block_size: int, total: int) -> None:
        done = blocks * block_size
        pct = min(100, done * 100 // total) if total > 0 else 0
        print(f"\r  {dest.name}: {done / 1e6:.0f}MB / {total / 1e6:.0f}MB ({pct}%)", end="")

    urllib.request.urlretrieve(url, tmp, reporthook=hook)
    print()
    tmp.replace(dest)


def main() -> int:
    settings = get_settings()
    for filename, attr in _FILES.items():
        dest: Path = getattr(settings, attr)
        if dest.is_file() and dest.stat().st_size > 1_000_000:
            print(f"  {dest.name}: already present ({dest.stat().st_size / 1e6:.0f}MB), skipping")
            continue
        print(f"Downloading {filename} ...")
        _download(f"{_RELEASE}/{filename}", dest)
    print("Done. Model files in", settings.kokoro_model_file.parent)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
