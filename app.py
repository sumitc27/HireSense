import os
import subprocess
import sys

# 1. Download Kokoro models if they don't exist
if not os.path.exists("backend/models/kokoro-v1.0.onnx"):
    print("Downloading Kokoro models...")
    subprocess.run([sys.executable, "backend/scripts/download_models.py"], check=True)

# 2. Add backend to Python path so imports work
sys.path.insert(0, os.path.abspath("backend"))

# 3. Start the FastAPI server on port 7860
import uvicorn
from backend.app.api.main import app

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7860)
