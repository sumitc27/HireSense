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
