"""HireSense configuration (env-driven, free-tier defaults)."""
from __future__ import annotations

from functools import lru_cache
# Trigger uvicorn auto-reload for Clerk config changes
from pathlib import Path

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

# config.py lives at hiresense/backend/app/config.py:
#   parents[1] = hiresense/backend   parents[2] = hiresense
_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_PROJECT_ROOT = Path(__file__).resolve().parents[2]

# pydantic-settings' env_file only populates this Settings class's own
# declared fields — it does not inject values into os.environ. Provider
# SDKs (Groq client, litellm) read GROQ_API_KEY/GEMINI_API_KEY straight
# from os.environ, so load the same .env files into the real process
# environment too. Project-root .env wins; backend/.env fills any gaps.
load_dotenv(_PROJECT_ROOT / ".env", override=True)
load_dotenv(_BACKEND_ROOT / ".env", override=True)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(_PROJECT_ROOT / ".env", _BACKEND_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- LLM (3-model chain via the vendored shared router) ---
    primary_model: str = "groq/openai/gpt-oss-120b"
    fallback_model: str = "gemini/gemini-3.5-flash"
    fallback_model_2: str = "gemini/gemini-3.1-flash-lite"

    # --- Speech-to-text (Groq, free tier ~2K req/day) ---
    stt_model: str = "whisper-large-v3-turbo"

    # --- Text-to-speech (Kokoro-82M, ElevenLabs, or Cartesia) ---
    tts_provider: str = "kokoro"  # "kokoro", "elevenlabs", or "cartesia"

    cartesia_api_key: str = ""
    cartesia_voice_id: str = "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4"  # George/professional voice
    cartesia_model_id: str = "sonic-3.5"  # Low latency model (e.g. sonic-3.5 or sonic-latest)

    kokoro_model_path: str = "models/kokoro-v1.0.onnx"
    kokoro_voices_path: str = "models/voices-v1.0.bin"
    kokoro_voice: str = "af_heart"
    kokoro_speed: float = 1.0

    # --- Session behavior ---
    default_question_count: int = 2     # 3-5 main questions per session
    max_question_count: int = 6
    daily_session_limit: int = 5
    silence_timeout_seconds: int = 30   # open-mic: re-prompt after this long listening
    max_utterance_seconds: int = 90

    # --- API ---
    hiresense_api_port: int = 8002
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # --- Persistence (sessions + turns + latency samples) ---
    hiresense_db: str = "hiresense.db"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def backend_root(self) -> Path:
        return _BACKEND_ROOT

    @property
    def db_path(self) -> Path:
        p = Path(self.hiresense_db)
        return p if p.is_absolute() else _BACKEND_ROOT / p

    @property
    def kokoro_model_file(self) -> Path:
        p = Path(self.kokoro_model_path)
        return p if p.is_absolute() else _BACKEND_ROOT / p

    @property
    def kokoro_voices_file(self) -> Path:
        p = Path(self.kokoro_voices_path)
        return p if p.is_absolute() else _BACKEND_ROOT / p


@lru_cache
def get_settings() -> Settings:
    return Settings()
