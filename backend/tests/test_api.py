"""FastAPI endpoint tests — health + session history CRUD. No API keys and no
Kokoro model files needed: ``tts.warm_up`` is stubbed so lifespan startup
never touches the real (multi-hundred-MB) model."""
from fastapi.testclient import TestClient

from app import sessions_store
from app.api import main as api_main


class _FakeSettings:
    def __init__(self, db_path):
        self.db_path = db_path


def test_health_endpoint(monkeypatch):
    monkeypatch.setattr(api_main.tts, "warm_up", lambda: True)
    with TestClient(api_main.app) as client:
        resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert "stt_model" in body


def test_sessions_crud_round_trip(tmp_path, monkeypatch):
    monkeypatch.setattr(api_main.tts, "warm_up", lambda: True)
    monkeypatch.setattr(sessions_store, "get_settings", lambda: _FakeSettings(tmp_path / "test.db"))

    sessions_store.create_session("s1", "backend engineer", "senior", 2)

    with TestClient(api_main.app) as client:
        resp = client.get("/sessions")
        assert resp.status_code == 200
        assert [s["id"] for s in resp.json()] == ["s1"]
        assert resp.json()[0]["status"] == "running"

        resp = client.get("/sessions/s1")
        assert resp.status_code == 200
        detail = resp.json()
        assert detail["role"] == "backend engineer"
        assert detail["turns"] == []

        resp = client.get("/sessions/does-not-exist")
        assert resp.status_code == 404

        resp = client.delete("/sessions/s1")
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}

        resp = client.get("/sessions/s1")
        assert resp.status_code == 404


def test_daily_session_limit(tmp_path, monkeypatch):
    import pytest
    from fastapi.websockets import WebSocketDisconnect
    import sys

    monkeypatch.setattr(api_main.tts, "warm_up", lambda: True)
    monkeypatch.setattr(sessions_store, "get_settings", lambda: _FakeSettings(tmp_path / "test.db"))

    class MockSettings:
        db_path = tmp_path / "test.db"
        daily_session_limit = 2
        stt_model = "whisper"
        kokoro_model_file = tmp_path
        kokoro_voices_file = tmp_path
        default_question_count = 4
        max_question_count = 6

    monkeypatch.setattr(api_main, "settings", MockSettings())
    monkeypatch.setattr(api_main.auth, "get_clerk_domain", lambda: "fake-domain.clerk.accounts.dev")
    monkeypatch.setattr(api_main.auth, "verify_clerk_token", lambda token: {"sub": "test-user"})

    # Temporarily remove pytest from sys.modules to trigger auth branch in websocket
    original_modules = sys.modules.copy()
    if "pytest" in sys.modules:
        del sys.modules["pytest"]

    try:
        # Create 2 sessions for "test-user"
        sessions_store.create_session("s1", "engineer", "mid", 2, user_id="test-user")
        sessions_store.create_session("s2", "engineer", "mid", 2, user_id="test-user")

        with TestClient(api_main.app) as client:
            with pytest.raises(WebSocketDisconnect) as exc_info:
                with client.websocket_connect("/ws/session?token=valid-token") as ws:
                    pass
            assert exc_info.value.code == 4003
    finally:
        sys.modules.update(original_modules)

