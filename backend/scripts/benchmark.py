import asyncio
import time
import wave
import struct
import io
import threading
import sys
import os
from pathlib import Path

# Add backend root to sys.path
sys.path.append(str(Path(__file__).resolve().parents[1]))

from app import sessions_store, stt, brain, tts
from app.config import get_settings
from app.rubric import RubricScore

settings = get_settings()

def create_dummy_wav():
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(16000)
        for _ in range(16000):
            wav_file.writeframes(struct.pack('h', 0))
    return buf.getvalue()

async def benchmark_pipeline():
    print("--- 1. WebSocket Round-Trip Pipeline Latency ---")
    audio_bytes = create_dummy_wav()
    
    # 1. STT
    t0 = time.time()
    result = await asyncio.to_thread(stt.transcribe, audio_bytes)
    t_stt = time.time() - t0
    stt_text = result.text if result.ok and result.text else "This is a placeholder answer to test the LLM."
    print(f"STT (Whisper) Latency: {t_stt*1000:.2f} ms")
    
    # 2. LLM Grading & Coaching
    t1 = time.time()
    role = "Software Engineer"
    seniority = "Mid-level"
    question = "Can you explain how React's virtual DOM works?"
    
    rubric = await asyncio.to_thread(
        brain.score_answer, role, seniority, question, stt_text, settings=settings
    )
    t_score = time.time() - t1
    print(f"LLM Grading Latency: {t_score*1000:.2f} ms")
    
    t2 = time.time()
    tokens = brain.coach_stream(role, seniority, question, rubric, is_last_turn=False, settings=settings)
    
    # Drain stream and get TTS latencies
    splitter = tts.SentenceSplitter()
    first_token_time = None
    first_tts_time = None
    
    sentences = []
    
    for tok in tokens:
        if not first_token_time:
            first_token_time = time.time()
        for sentence in splitter.feed(tok):
            sentences.append(sentence)
            if not first_tts_time:
                t3 = time.time()
                wav = tts.synth_sentence(sentence)
                first_tts_time = time.time()
                print(f"TTS First Sentence Synthesis Latency: {(first_tts_time - t3)*1000:.2f} ms")
    if (tail := splitter.flush()) is not None:
        sentences.append(tail)
        if not first_tts_time:
            t3 = time.time()
            wav = tts.synth_sentence(tail)
            first_tts_time = time.time()
            print(f"TTS First Sentence Synthesis Latency: {(first_tts_time - t3)*1000:.2f} ms")
            
    t_first_token = first_token_time - t2
    print(f"LLM Time to First Token (TTFT): {t_first_token*1000:.2f} ms")
    
    total_end_to_end = (time.time() - t0)
    print(f"Total Turn Time (processing): {total_end_to_end:.2f} s")
    
    # End-to-end to first audio: STT + TTFT (score + first coach token) + TTS first sentence
    t_first_audio = t_stt + t_score + t_first_token + (first_tts_time - t3) if first_tts_time else 0
    print(f"End-to-end Turn Latency (User stops speaking -> Coach starts speaking): {t_first_audio*1000:.2f} ms")
    
    return {
        "stt_ms": t_stt * 1000,
        "grading_ms": t_score * 1000,
        "ttft_ms": t_first_token * 1000,
        "e2e_first_audio_ms": t_first_audio * 1000
    }

def benchmark_db_concurrency():
    print("\n--- 2. Database Concurrency & Rate Limiting ---")
    N_THREADS = 20
    REQUESTS_PER_THREAD = 10
    
    sessions_store.init_db()
    
    latencies = []
    
    def worker(thread_id):
        user_id = f"test-user-{thread_id}"
        for i in range(REQUESTS_PER_THREAD):
            t0 = time.time()
            # 1. Rate limiter check (read)
            count = sessions_store.count_user_sessions_today(user_id)
            # 2. Create session (write)
            session_id = f"bench-{thread_id}-{i}"
            sessions_store.create_session(session_id, "Eng", "Mid", 2, user_id)
            latencies.append(time.time() - t0)
            
    threads = []
    t_start = time.time()
    for i in range(N_THREADS):
        t = threading.Thread(target=worker, args=(i,))
        threads.append(t)
        t.start()
        
    for t in threads:
        t.join()
        
    total_time = time.time() - t_start
    total_reqs = N_THREADS * REQUESTS_PER_THREAD
    avg_latency = (sum(latencies) / len(latencies)) * 1000
    throughput = total_reqs / total_time
    
    print(f"Simulated {total_reqs} concurrent sessions (Read + Write) across {N_THREADS} threads.")
    print(f"Average DB Read/Write Latency (WAL Mode): {avg_latency:.2f} ms")
    print(f"DB Throughput: {throughput:.2f} ops/sec")

async def main():
    tts.warm_up()
    await benchmark_pipeline()
    benchmark_db_concurrency()

if __name__ == "__main__":
    asyncio.run(main())
