import sqlite3
import json

conn = sqlite3.connect('hiresense.db')
conn.row_factory = sqlite3.Row
rows = conn.execute("SELECT * FROM turns").fetchall()

if not rows:
    print("No turns in DB")
else:
    stt_ms_list = []
    e2e_ms_list = []
    
    for r in rows:
        lat = json.loads(r["latency_json"])
        if lat and "stt" in lat:
            stt_ms_list.append(lat["stt"])
        # E2E is time from STT start to first TTS playback
        if lat and "stt" in lat and "tts_first" in lat:
            # wait, stages_ms() calculates duration from first marker?
            # actually latency_json is a dict of stage names to ms.
            # let's just print the raw latencies of a turn to understand the structure
            pass
            
    for r in rows[:5]:
        print(f"Turn {r['turn_id']}: {r['latency_json']}")
