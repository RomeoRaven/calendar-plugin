"""Host-free tests for the human Calendar plugin."""

import importlib
from pathlib import Path

import pytest
import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent


def test_register_contributes_tools_skill_and_two_routers(plugin, registry):
    plugin.register(registry)
    assert [tool.name for tool in registry.tools] == ["calendar_status", "calendar_event_list", "calendar_event_create"]
    assert registry.skill_dirs == ["skills"]
    assert [prefix for prefix, _ in registry.routers] == ["/plugins/calendar", "/api/plugins/calendar"]


def test_manifest_is_human_calendar_shape():
    manifest = yaml.safe_load((ROOT / "protoagent.plugin.yaml").read_text(encoding="utf-8"))
    assert manifest["id"] == "calendar"
    assert manifest["version"] == "0.3.0"
    assert manifest["enabled"] is False
    assert manifest["public_paths"] == ["/plugins/calendar/assets/"]
    assert manifest["subscribes"] == ["scheduler.fired"]
    assert manifest["capabilities"]["network"]
    skill = yaml.safe_load(
        (ROOT / "skills" / "calendar-skill" / "SKILL.md").read_text(encoding="utf-8").split("---", 2)[1]
    )
    assert skill["description"]


def test_page_assets_and_data_routes(plugin, tmp_path):
    store_module = importlib.import_module(plugin.__name__ + ".calendar_store")
    plugin._STORE = store_module.CalendarStore(tmp_path / "calendar.db")
    app = FastAPI()
    app.include_router(plugin._page_router(), prefix="/plugins/calendar")
    app.include_router(plugin._data_router(), prefix="/api/plugins/calendar")
    client = TestClient(app)

    page = client.get("/plugins/calendar/view")
    assert page.status_code == 200
    assert "New event" in page.text
    assert "New schedule" not in page.text
    assert 'data-mode="day"' in page.text
    assert "https://www.calendarlabs.com/ical-calendar/" in page.text
    assert 'rel="noopener noreferrer"' in page.text
    for name in ("calendar.js", "calendar.css", "calendar-model.js"):
        assert client.get(f"/plugins/calendar/assets/{name}").status_code == 200
    assert client.get("/plugins/calendar/assets/secret.txt").status_code == 404

    created = client.post(
        "/api/plugins/calendar/events",
        json={
            "title": "Dennis birthday",
            "starts_at": "2026-09-12",
            "ends_at": "2026-09-13",
            "all_day": True,
            "rrule": "FREQ=YEARLY",
        },
    )
    assert created.status_code == 201
    event = created.json()["event"]
    assert event["source_kind"] == "local"
    assert event["readonly"] is False

    updated = client.patch(
        f"/api/plugins/calendar/events/{event['id']}",
        json={"expected_version": event["version"], "location": "Home"},
    )
    assert updated.status_code == 200
    assert updated.json()["event"]["version"] == 2
    assert (
        client.patch(
            f"/api/plugins/calendar/events/{event['id']}",
            json={"expected_version": 1, "location": "Stale"},
        ).status_code
        == 409
    )
    assert client.delete(f"/api/plugins/calendar/events/{event['id']}?expected_version=2").status_code == 200
    assert client.get("/api/plugins/calendar/events").json() == {"events": []}


def test_store_replaces_subscribed_events_atomically(plugin, tmp_path):
    store_module = importlib.import_module(plugin.__name__ + ".calendar_store")
    store = store_module.CalendarStore(tmp_path / "calendar.db")
    source = store.create_source(name="Family", url="https://example.com/family.ics", color="#123456")
    first = {
        "uid": "birthday-1",
        "title": "Birthday",
        "starts_at": "1980-05-10",
        "ends_at": "1980-05-11",
        "all_day": True,
        "rrule": "FREQ=YEARLY",
    }
    refreshed = store.set_source_refresh(source["id"], [first])
    assert refreshed["event_count"] == 1
    event = store.list_events()[0]
    assert event["readonly"] is True
    assert event["source_name"] == "Family"
    with pytest.raises(ValueError, match="read-only"):
        store.update_event(event["id"], {"expected_version": 1, "title": "No"})
    store.set_source_refresh(source["id"], [{**first, "title": "Updated birthday"}])
    assert [value["title"] for value in store.list_events()] == ["Updated birthday"]
    store.delete_source(source["id"])
    assert store.list_events() == []
    assert store.integrity() == "ok"


def test_ics_parser_handles_all_day_yearly_and_timed(plugin):
    feed = importlib.import_module(plugin.__name__ + ".ics_feed")
    text = """BEGIN:VCALENDAR\r
BEGIN:VEVENT\r
UID:birthday\r
SUMMARY:Dennis\\, Birthday\r
DTSTART;VALUE=DATE:19800912\r
DTEND;VALUE=DATE:19800913\r
RRULE:FREQ=YEARLY\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:appointment\r
SUMMARY:Dentist\r
DTSTART:20260826T140000Z\r
DTEND:20260826T150000Z\r
LOCATION:Main Street\r
END:VEVENT\r
END:VCALENDAR\r
"""
    events = feed.parse_ics(text)
    assert events[0] == {
        "uid": "birthday",
        "title": "Dennis, Birthday",
        "starts_at": "1980-09-12",
        "ends_at": "1980-09-13",
        "all_day": True,
        "location": "",
        "notes": "",
        "rrule": "FREQ=YEARLY",
    }
    assert events[1]["starts_at"] == "2026-08-26T14:00:00Z"
    assert events[1]["location"] == "Main Street"


def test_ics_fetch_refuses_local_and_non_https(plugin):
    feed = importlib.import_module(plugin.__name__ + ".ics_feed")
    with pytest.raises(ValueError, match="HTTPS"):
        feed.fetch_ics("http://example.com/calendar.ics")
    with pytest.raises(ValueError, match="public"):
        feed.fetch_ics("https://127.0.0.1/calendar.ics")


def test_browser_uses_calendar_data_google_and_scheduler_apis():
    source = (ROOT / "view" / "calendar.js").read_text(encoding="utf-8")
    assert '"/api/plugins/calendar/events"' in source
    assert '"/api/plugins/google/upcoming"' in source
    assert '"/api/scheduler/jobs"' in source
    assert "calendar.db" not in source
    assert "New schedule" not in source
    assert "function renderDay" in source
    assert "Daily schedule" in source
