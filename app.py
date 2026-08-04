import os
import subprocess
import sys
import threading
import time
import shutil
import sqlite3

# 1. Download Kokoro models if they don't exist
if not os.path.exists("backend/models/kokoro-v1.0.onnx"):
    print("Downloading Kokoro models...")
    subprocess.run([sys.executable, "backend/scripts/download_models.py"], check=True)

# 2. Database Backup/Restore System for Hugging Face Storage Buckets
LOCAL_DB = "backend/hiresense.db"
BUCKET_DIR = "/data" # The path you configure in Hugging Face Space settings
BUCKET_DB = f"{BUCKET_DIR}/hiresense_backup.db"

if os.path.exists(BUCKET_DIR):
    # On startup: Restore from bucket if backup exists
    if os.path.exists(BUCKET_DB):
        print(f"Restoring database from {BUCKET_DB} to {LOCAL_DB}...")
        shutil.copy2(BUCKET_DB, LOCAL_DB)
    else:
        print("No backup found in bucket. Starting fresh.")

    # Background thread to backup the DB every 30 seconds
    def backup_loop():
        while True:
            time.sleep(30) # 30 seconds
            if os.path.exists(LOCAL_DB):
                try:
                    # Force a WAL checkpoint so the .db file has all recent data
                    conn = sqlite3.connect(LOCAL_DB)
                    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                    conn.close()
                    
                    # Copy safely to the S3 bucket
                    shutil.copy2(LOCAL_DB, f"{BUCKET_DB}.tmp")
                    os.replace(f"{BUCKET_DB}.tmp", BUCKET_DB)
                    print(f"[{time.strftime('%X')}] Successfully backed up database to Storage Bucket.")
                except Exception as e:
                    print(f"[{time.strftime('%X')}] Backup failed: {e}")

    thread = threading.Thread(target=backup_loop, daemon=True)
    thread.start()
    print("Database auto-backup to Storage Bucket enabled (every 5 mins).")
else:
    print(f"Storage Bucket not found at {BUCKET_DIR}. Skipping persistent backups.")

# 3. Add backend to Python path so imports work
sys.path.insert(0, os.path.abspath("backend"))

# 4. Start the FastAPI server on port 7860
import uvicorn
from backend.app.api.main import app

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7860)
