"""Session history: persists each interview session + its turns so a report
survives a backend restart and can be reopened from the sessions menu.

Same WAL + busy_timeout + retry-on-lock pattern as TaskPilot's ``runs_store``
(this backend has only one writer, but WAL still lets the eval scripts read
concurrently without blocking a live session's writes).
"""
from __future__ import annotations

import functools
import json
import sqlite3
import time
from datetime import datetime, timezone

from .config import get_settings
from .rubric import TurnRecord


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(get_settings().db_path, timeout=2)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=2000")
    return conn


def _retry_on_lock(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        delay = 0.1
        for attempt in range(4):
            try:
                return fn(*args, **kwargs)
            except sqlite3.OperationalError as e:
                if "locked" not in str(e).lower() or attempt == 3:
                    raise
                time.sleep(delay)
                delay = min(delay * 2, 1.0)

    return wrapper


def init_db() -> None:
    with _conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                role TEXT NOT NULL,
                seniority TEXT NOT NULL,
                question_count INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'running',
                created_at TEXT NOT NULL,
                overall_average REAL,
                top_improvements TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS turns (
                session_id TEXT NOT NULL,
                turn_id TEXT NOT NULL,
                seq INTEGER NOT NULL,
                question_index INTEGER NOT NULL,
                is_follow_up INTEGER NOT NULL,
                question_text TEXT NOT NULL,
                answer_text TEXT NOT NULL,
                answer_source TEXT NOT NULL,
                rubric_json TEXT,
                coaching_text TEXT NOT NULL,
                latency_json TEXT NOT NULL,
                PRIMARY KEY (session_id, turn_id)
            )
            """
        )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@_retry_on_lock
def create_session(session_id: str, role: str, seniority: str, question_count: int) -> None:
    init_db()
    with _conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO sessions (id, role, seniority, question_count, status, created_at) "
            "VALUES (?, ?, ?, ?, 'running', ?)",
            (session_id, role, seniority, question_count, _now()),
        )


@_retry_on_lock
def append_turn(session_id: str, turn: TurnRecord) -> None:
    init_db()
    with _conn() as conn:
        row = conn.execute(
            "SELECT COALESCE(MAX(seq), -1) + 1 FROM turns WHERE session_id = ?", (session_id,)
        ).fetchone()
        seq = row[0]
        conn.execute(
            """
            INSERT OR REPLACE INTO turns
                (session_id, turn_id, seq, question_index, is_follow_up, question_text,
                 answer_text, answer_source, rubric_json, coaching_text, latency_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session_id, turn.turn_id, seq, turn.question_index, int(turn.is_follow_up),
                turn.question_text, turn.answer_text, turn.answer_source,
                json.dumps(turn.rubric.to_dict(), ensure_ascii=False) if turn.rubric else None,
                turn.coaching_text, json.dumps(turn.latency_ms, ensure_ascii=False),
            ),
        )


@_retry_on_lock
def finish_session(session_id: str, status: str, overall_average: float, top_improvements: list[str]) -> None:
    init_db()
    with _conn() as conn:
        conn.execute(
            "UPDATE sessions SET status = ?, overall_average = ?, top_improvements = ? WHERE id = ?",
            (status, overall_average, json.dumps(top_improvements, ensure_ascii=False), session_id),
        )


def list_sessions(limit: int = 50) -> list[dict]:
    init_db()
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["top_improvements"] = json.loads(d["top_improvements"]) if d["top_improvements"] else []
        out.append(d)
    return out


def _turn_row_to_dict(r: sqlite3.Row) -> dict:
    return {
        "turn_id": r["turn_id"],
        "question_index": r["question_index"],
        "is_follow_up": bool(r["is_follow_up"]),
        "question_text": r["question_text"],
        "answer_text": r["answer_text"],
        "answer_source": r["answer_source"],
        "rubric": json.loads(r["rubric_json"]) if r["rubric_json"] else None,
        "coaching_text": r["coaching_text"],
        "latency_ms": json.loads(r["latency_json"]),
    }


def get_session(session_id: str) -> dict | None:
    init_db()
    with _conn() as conn:
        session_row = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if session_row is None:
            return None
        turn_rows = conn.execute(
            "SELECT * FROM turns WHERE session_id = ? ORDER BY seq", (session_id,)
        ).fetchall()
    d = dict(session_row)
    d["top_improvements"] = json.loads(d["top_improvements"]) if d["top_improvements"] else []
    d["turns"] = [_turn_row_to_dict(r) for r in turn_rows]
    return d


@_retry_on_lock
def delete_session(session_id: str) -> None:
    init_db()
    with _conn() as conn:
        conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        conn.execute("DELETE FROM turns WHERE session_id = ?", (session_id,))
