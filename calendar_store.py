"""Plugin-owned Calendar event and source store."""

from __future__ import annotations

import hashlib
import os
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path
from typing import Any

_LOCK = threading.RLock()
_SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS calendar_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('ics')),
  url TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#7c3aed',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  last_refreshed TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0 CHECK(all_day IN (0,1)),
  location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  rrule TEXT NOT NULL DEFAULT '',
  source_id TEXT,
  external_uid TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(source_id) REFERENCES calendar_sources(id) ON DELETE CASCADE,
  UNIQUE(source_id, external_uid)
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(starts_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_source ON calendar_events(source_id);
"""


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _text(value: Any, name: str, limit: int, *, required: bool = False) -> str:
    if isinstance(value, (dict, list, tuple, bool)) or value is None:
        value = "" if value is None else value
    if not isinstance(value, str):
        raise ValueError(f"{name} must be text")
    value = value.strip()
    if required and not value:
        raise ValueError(f"{name} is required")
    if len(value) > limit:
        raise ValueError(f"{name} exceeds {limit} characters")
    return value


def _when(value: Any, name: str) -> str:
    value = _text(value, name, 64, required=True)
    try:
        date.fromisoformat(value) if "T" not in value else datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{name} must be an ISO date or datetime") from exc
    return value


def _validate_window(starts_at: str, ends_at: str, all_day: bool) -> None:
    if all_day:
        start, end = date.fromisoformat(starts_at), date.fromisoformat(ends_at)
    else:
        start = datetime.fromisoformat(starts_at.replace("Z", "+00:00"))
        end = datetime.fromisoformat(ends_at.replace("Z", "+00:00"))
        if (start.tzinfo is None) != (end.tzinfo is None):
            raise ValueError("start and end must use compatible timezone forms")
    if end <= start:
        raise ValueError("end must be after start")


def _instance_root() -> Path:
    explicit = os.environ.get("PROTOAGENT_HOME", "").strip()
    if explicit:
        return Path(explicit).expanduser()
    box = Path(os.environ.get("PROTOAGENT_BOX_ROOT", str(Path.home() / ".protoagent"))).expanduser()
    return box / (os.environ.get("PROTOAGENT_INSTANCE", "default").strip() or "default")


def default_db_path() -> Path:
    return _instance_root() / "calendar" / "calendar.db"


class CalendarStore:
    def __init__(self, path: Path | str | None = None):
        self.path = Path(path) if path is not None else default_db_path()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with _LOCK, self._connect() as conn:
            conn.executescript(_SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    @contextmanager
    def _write(self):
        with _LOCK, self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            yield conn
            conn.commit()

    @staticmethod
    def _event(row: sqlite3.Row) -> dict[str, Any]:
        out = dict(row)
        out["all_day"] = bool(out["all_day"])
        out["readonly"] = bool(out["source_id"])
        return out

    @staticmethod
    def _source(row: sqlite3.Row) -> dict[str, Any]:
        out = dict(row)
        out["enabled"] = bool(out["enabled"])
        return out

    def integrity(self) -> str:
        with self._connect() as conn:
            return str(conn.execute("PRAGMA quick_check").fetchone()[0])

    def list_events(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT e.*, COALESCE(s.name, 'My calendar') source_name, "
                "COALESCE(s.color, '#2563eb') source_color, COALESCE(s.kind, 'local') source_kind "
                "FROM calendar_events e LEFT JOIN calendar_sources s ON s.id=e.source_id "
                "WHERE e.source_id IS NULL OR s.enabled=1 ORDER BY e.starts_at,e.title,e.id"
            ).fetchall()
            return [self._event(row) for row in rows]

    def get_event(self, event_id: str) -> dict[str, Any]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT e.*, COALESCE(s.name, 'My calendar') source_name, "
                "COALESCE(s.color, '#2563eb') source_color, COALESCE(s.kind, 'local') source_kind "
                "FROM calendar_events e LEFT JOIN calendar_sources s ON s.id=e.source_id WHERE e.id=?",
                (event_id,),
            ).fetchone()
        if row is None:
            raise KeyError("event not found")
        return self._event(row)

    def create_event(self, payload: dict[str, Any]) -> dict[str, Any]:
        title = _text(payload.get("title"), "title", 300, required=True)
        all_day = bool(payload.get("all_day", False))
        starts_at = _when(payload.get("starts_at"), "starts_at")
        ends_at = _when(payload.get("ends_at"), "ends_at")
        if all_day and ("T" in starts_at or "T" in ends_at):
            raise ValueError("all-day events require date-only start and end")
        if not all_day and ("T" not in starts_at or "T" not in ends_at):
            raise ValueError("timed events require datetime start and end")
        _validate_window(starts_at, ends_at, all_day)
        location = _text(payload.get("location", ""), "location", 500)
        notes = _text(payload.get("notes", ""), "notes", 5000)
        rrule = _text(payload.get("rrule", ""), "rrule", 500)
        event_id, now = f"event-{uuid.uuid4().hex[:16]}", _now()
        with self._write() as conn:
            conn.execute(
                "INSERT INTO calendar_events(id,title,starts_at,ends_at,all_day,location,notes,rrule,created_at,updated_at) "
                "VALUES(?,?,?,?,?,?,?,?,?,?)",
                (event_id, title, starts_at, ends_at, int(all_day), location, notes, rrule, now, now),
            )
        return self.get_event(event_id)

    def update_event(self, event_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        current = self.get_event(event_id)
        if current["readonly"]:
            raise ValueError("subscribed calendar events are read-only")
        expected = payload.get("expected_version")
        if isinstance(expected, bool) or not isinstance(expected, int) or expected < 1:
            raise ValueError("positive expected_version is required")
        merged = {**current, **payload}
        title = _text(merged.get("title"), "title", 300, required=True)
        all_day = bool(merged.get("all_day", False))
        starts_at = _when(merged.get("starts_at"), "starts_at")
        ends_at = _when(merged.get("ends_at"), "ends_at")
        if all_day and ("T" in starts_at or "T" in ends_at):
            raise ValueError("all-day events require date-only start and end")
        if not all_day and ("T" not in starts_at or "T" not in ends_at):
            raise ValueError("timed events require datetime start and end")
        _validate_window(starts_at, ends_at, all_day)
        values = (
            title,
            starts_at,
            ends_at,
            int(all_day),
            _text(merged.get("location", ""), "location", 500),
            _text(merged.get("notes", ""), "notes", 5000),
            _text(merged.get("rrule", ""), "rrule", 500),
            _now(),
            event_id,
            expected,
        )
        with self._write() as conn:
            cursor = conn.execute(
                "UPDATE calendar_events SET title=?,starts_at=?,ends_at=?,all_day=?,location=?,notes=?,rrule=?,"
                "updated_at=?,version=version+1 WHERE id=? AND version=? AND source_id IS NULL",
                values,
            )
            if cursor.rowcount != 1:
                raise RuntimeError("event changed; reload and try again")
        return self.get_event(event_id)

    def delete_event(self, event_id: str, expected_version: int) -> dict[str, Any]:
        current = self.get_event(event_id)
        if current["readonly"]:
            raise ValueError("subscribed calendar events are read-only")
        if isinstance(expected_version, bool) or not isinstance(expected_version, int) or expected_version < 1:
            raise ValueError("positive expected_version is required")
        with self._write() as conn:
            cursor = conn.execute(
                "DELETE FROM calendar_events WHERE id=? AND version=? AND source_id IS NULL",
                (event_id, expected_version),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("event changed; reload and try again")
        return current

    def list_sources(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT s.*, COUNT(e.id) event_count FROM calendar_sources s "
                "LEFT JOIN calendar_events e ON e.source_id=s.id GROUP BY s.id ORDER BY s.name,s.id"
            ).fetchall()
            return [self._source(row) for row in rows]

    def create_source(self, *, name: Any, url: Any, color: Any = "#7c3aed") -> dict[str, Any]:
        source_id, now = f"source-{uuid.uuid4().hex[:12]}", _now()
        values = (
            source_id,
            _text(name, "name", 120, required=True),
            _text(url, "url", 2048, required=True),
            _text(color, "color", 32) or "#7c3aed",
            now,
            now,
        )
        with self._write() as conn:
            conn.execute(
                "INSERT INTO calendar_sources(id,name,kind,url,color,created_at,updated_at) VALUES(?,?,'ics',?,?,?,?)",
                values,
            )
        return self.get_source(source_id)

    def get_source(self, source_id: str) -> dict[str, Any]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT s.*, COUNT(e.id) event_count FROM calendar_sources s "
                "LEFT JOIN calendar_events e ON e.source_id=s.id WHERE s.id=? GROUP BY s.id",
                (source_id,),
            ).fetchone()
        if row is None:
            raise KeyError("calendar source not found")
        return self._source(row)

    def set_source_refresh(self, source_id: str, events: list[dict[str, Any]], error: str = "") -> dict[str, Any]:
        now = _now()
        with self._write() as conn:
            exists = conn.execute("SELECT 1 FROM calendar_sources WHERE id=?", (source_id,)).fetchone()
            if exists is None:
                raise KeyError("calendar source not found")
            if error:
                conn.execute(
                    "UPDATE calendar_sources SET last_error=?,updated_at=? WHERE id=?", (error[:1000], now, source_id)
                )
            else:
                conn.execute("DELETE FROM calendar_events WHERE source_id=?", (source_id,))
                for item in events:
                    uid = _text(item.get("uid"), "uid", 500, required=True)
                    event_id = "ical-" + hashlib.sha256(f"{source_id}\0{uid}".encode()).hexdigest()[:20]
                    conn.execute(
                        "INSERT INTO calendar_events(id,title,starts_at,ends_at,all_day,location,notes,rrule,"
                        "source_id,external_uid,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                        (
                            event_id,
                            _text(item.get("title"), "title", 300, required=True),
                            _when(item.get("starts_at"), "starts_at"),
                            _when(item.get("ends_at"), "ends_at"),
                            int(bool(item.get("all_day"))),
                            _text(item.get("location", ""), "location", 500),
                            _text(item.get("notes", ""), "notes", 5000),
                            _text(item.get("rrule", ""), "rrule", 500),
                            source_id,
                            uid,
                            now,
                            now,
                        ),
                    )
                conn.execute(
                    "UPDATE calendar_sources SET last_refreshed=?,last_error='',updated_at=? WHERE id=?",
                    (now, now, source_id),
                )
        return self.get_source(source_id)

    def delete_source(self, source_id: str) -> dict[str, Any]:
        current = self.get_source(source_id)
        with self._write() as conn:
            conn.execute("DELETE FROM calendar_sources WHERE id=?", (source_id,))
        return current
