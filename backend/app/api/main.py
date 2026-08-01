"""HireSense FastAPI app: live voice session over WebSocket, session history over REST."""
from __future__ import annotations

import asyncio
import logging
import logging.config
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .. import sessions_store, tts
from ..config import get_settings
from ..session import SessionController

settings = get_settings()

# ---- logging setup ----------------------------------------------------------
logging.config.dictConfig({
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": {
            "format": "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            "datefmt": "%H:%M:%S",
        }
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "default",
        }
    },
    "loggers": {
        "hiresense": {"level": "INFO", "handlers": ["console"], "propagate": False},
        "uvicorn.access": {"level": "WARNING"},   # suppress per-request noise
    },
    "root": {"level": "WARNING"},
})
logger = logging.getLogger("hiresense.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load the Kokoro TTS model once (~1.5s) so the first turn doesn't pay it.
    # A load failure degrades to captions-only sessions rather than blocking
    # startup — /health exposes tts_ready so the UI can show a warning state.
    ok = await asyncio.to_thread(tts.warm_up)
    if not ok:
        logger.error("[api] TTS unavailable: %s", tts.load_error())
    yield


app = FastAPI(title="HireSense API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "tts_ready": tts.is_ready(),
        "tts_error": tts.load_error(),
        "stt_model": settings.stt_model,
    }


@app.websocket("/ws/session")
async def ws_session(ws: WebSocket) -> None:
    await SessionController(ws).run()


class SessionSummary(BaseModel):
    id: str
    role: str
    seniority: str
    question_count: int
    status: str
    created_at: str
    overall_average: float | None
    top_improvements: list[str]


class SessionDetail(SessionSummary):
    turns: list[dict]


@app.get("/sessions", response_model=list[SessionSummary])
async def list_sessions(limit: int = 50) -> list[dict]:
    return await asyncio.to_thread(sessions_store.list_sessions, limit)


@app.get("/sessions/{session_id}", response_model=SessionDetail)
async def get_session(session_id: str) -> dict:
    data = await asyncio.to_thread(sessions_store.get_session, session_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return data


@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str) -> dict:
    await asyncio.to_thread(sessions_store.delete_session, session_id)
    return {"ok": True}


@app.get("/")
def root() -> dict:
    return {"name": "HireSense", "docs": "/docs", "health": "/health"}
