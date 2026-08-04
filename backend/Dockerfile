# HireSense backend — self-contained image (deploys to Render / HF Spaces, free tier).
#
# Build from THIS backend directory (everything it needs is vendored here):
#   docker build -t hiresense-api .
#
# Kokoro's model files (~310MB) are gitignored — the build step below
# downloads them from the kokoro-onnx project's GitHub releases so the image
# is runnable standalone. Requires GROQ_API_KEY / GEMINI_API_KEY at runtime
# (see .env.example); LANGFUSE_* are optional.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY shared ./shared
COPY scripts ./scripts

RUN python scripts/download_models.py

EXPOSE 8002
CMD ["uvicorn", "app.api.main:app", "--host", "0.0.0.0", "--port", "8002"]

