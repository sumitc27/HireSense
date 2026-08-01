"""Scripted WebSocket client — drives the real voice pipeline without a browser.

Sends a canned audio file as one utterance, prints every event as it arrives,
saves returned TTS WAV chunks next to this script, and reports stage timings.
Also the engine behind the latency eval (--loopback N runs the same turn N
times and prints aggregate stats).

    python scripts/ws_client.py [--audio path.wav] [--loopback N] [--url ws://...]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import websockets  # noqa: E402


async def run_turn(url: str, audio_bytes: bytes, save_chunks: bool = True) -> dict:
    """Start a 1-question session, answer it with one canned utterance, and
    collect events until the latency frame after tts_end. Returns stages dict.

    Since Phase 4, ``utterance`` frames are only processed inside a live
    session (see SessionController._ensure_listening) — so this primes one
    with start_session first. It waits for the "listening" state (the
    question has FINISHED speaking), not just the "question" event — the
    receive loop now reacts to frames the instant they arrive (see
    SessionController._start_turn), so sending the answer any earlier would
    genuinely barge in on the question and interrupt it after its first
    sentence, measuring an aborted turn instead of a clean one.
    """
    chunk_dir = Path(__file__).parent / "ws_client_chunks"
    stages: dict = {}
    async with websockets.connect(url, max_size=32 * 1024 * 1024) as ws:
        await ws.send(json.dumps({
            "type": "start_session", "role": "backend engineer",
            "seniority": "senior", "question_count": 1,
        }))
        while True:
            msg = await asyncio.wait_for(ws.recv(), timeout=60)
            if isinstance(msg, bytes):
                continue
            frame = json.loads(msg)
            if frame.get("type") == "state" and frame.get("state") == "listening":
                break

        await ws.send(json.dumps({"type": "utterance", "duration_ms": 0, "mime": "audio/wav"}))
        await ws.send(audio_bytes)
        t_send = time.perf_counter()

        pending_chunk_meta = None
        tts_ended = False
        playback_reported = False
        n_chunks = 0
        while True:
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=120)
            except asyncio.TimeoutError:
                print("  TIMEOUT waiting for events")
                break

            if isinstance(msg, bytes):
                n_chunks += 1
                if pending_chunk_meta and save_chunks:
                    chunk_dir.mkdir(exist_ok=True)
                    seq = pending_chunk_meta.get("seq", n_chunks)
                    (chunk_dir / f"chunk_{seq:02d}.wav").write_bytes(msg)
                # First audio chunk == the moment a browser would start playback.
                if not playback_reported:
                    playback_reported = True
                    await ws.send(json.dumps({
                        "type": "playback_started",
                        "turn_id": (pending_chunk_meta or {}).get("turn_id", ""),
                        "seq": 0,
                    }))
                pending_chunk_meta = None
                continue

            frame = json.loads(msg)
            ftype = frame.get("type")
            if ftype == "tts_chunk":
                pending_chunk_meta = frame
                print(f"  <- tts_chunk seq={frame['seq']}: {frame['text'][:60]!r}")
            elif ftype == "stt_result":
                print(f"  <- stt_result ({frame['stt_ms']}ms, {frame['language']}): {frame['text'][:80]!r}")
            elif ftype == "coaching_delta":
                pass  # token spam — skip printing
            elif ftype == "latency":
                stages = frame.get("stages", {})
                print(f"  <- latency: {stages}")
                # The first latency frame (right after tts_end) never has
                # e2e_ms — that only lands in a SECOND frame, sent once our
                # playback_started (above) makes it through the server's
                # receive loop. Wait for it so we capture the real headline
                # metric instead of closing the socket one frame too early.
                if "e2e_ms" in stages:
                    break
            elif ftype == "tts_end":
                tts_ended = True
                print(f"  <- tts_end interrupted={frame.get('interrupted')}")
                if not playback_reported:
                    # TTS-degraded run (no audio chunks): nothing more to wait for.
                    break
            elif ftype == "error":
                print(f"  <- ERROR {frame.get('code')}: {frame.get('message')}")
                if not frame.get("recoverable", False):
                    break
                if frame.get("code", "").startswith("stt_"):
                    break  # this turn is dead; stop waiting
            else:
                print(f"  <- {ftype}: {json.dumps({k: v for k, v in frame.items() if k != 'type'})[:100]}")

        print(f"  ({n_chunks} audio chunks, wall {time.perf_counter() - t_send:.1f}s)")
    return stages


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", default=str(Path(__file__).parent / "smoke_tts_out.wav"))
    ap.add_argument("--url", default="ws://localhost:8002/ws/session")
    ap.add_argument("--loopback", type=int, default=1, metavar="N",
                    help="repeat the turn N times and print p50/p95 stage stats")
    args = ap.parse_args()

    audio_path = Path(args.audio)
    if not audio_path.is_file():
        print(f"No audio at {audio_path} — run scripts/smoke_tts.py first, or pass --audio.")
        return 1
    audio_bytes = audio_path.read_bytes()
    print(f"Sending {audio_path.name} ({len(audio_bytes) / 1024:.0f}KB) x{args.loopback} to {args.url}")

    all_stages: list[dict] = []
    for i in range(args.loopback):
        print(f"turn {i + 1}/{args.loopback}:")
        stages = await run_turn(args.url, audio_bytes, save_chunks=(i == 0))
        if stages:
            all_stages.append(stages)

    if len(all_stages) > 1:
        keys = sorted({k for s in all_stages for k in s})
        print("\nstage           p50ms   p95ms   n")
        for k in keys:
            vals = sorted(s[k] for s in all_stages if k in s)
            p50 = vals[len(vals) // 2]
            p95 = vals[min(len(vals) - 1, int(len(vals) * 0.95))]
            print(f"{k:<16}{p50:>6}  {p95:>6}  {len(vals):>3}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
