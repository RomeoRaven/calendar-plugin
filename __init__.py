"""Human Calendar workspace with Scheduler and external-calendar overlays."""

from __future__ import annotations

import json
import urllib.parse
from pathlib import Path

from langchain_core.tools import tool

_ROOT = Path(__file__).resolve().parent
_VIEW = _ROOT / "view"
_STORE = None


def store():
    global _STORE
    if _STORE is None:
        from .calendar_store import CalendarStore

        _STORE = CalendarStore()
    return _STORE


def _public_source(value: dict) -> dict:
    out = dict(value)
    raw = str(out.pop("url", ""))
    parsed = urllib.parse.urlparse(raw.replace("webcal://", "https://", 1))
    out["url_host"] = parsed.hostname or ""
    return out


def _refresh(source_id: str) -> dict:
    from .ics_feed import fetch_ics, parse_ics

    source = store().get_source(source_id)
    try:
        text, _ = fetch_ics(source["url"])
        events = parse_ics(text)
        if not events:
            raise ValueError("calendar feed contained no readable VEVENT entries")
        return store().set_source_refresh(source_id, events)
    except Exception as exc:  # noqa: BLE001 — persisted source error is the operator contract
        store().set_source_refresh(source_id, [], f"{type(exc).__name__}: {exc}")
        raise


@tool
def calendar_event_list() -> str:
    """List human Calendar events from the local calendar and subscribed iCalendar feeds."""
    return json.dumps(store().list_events(), ensure_ascii=False, sort_keys=True)


@tool
def calendar_event_create(
    title: str,
    starts_at: str,
    ends_at: str,
    all_day: bool = False,
    location: str = "",
    notes: str = "",
    recurrence: str = "",
) -> str:
    """Create a human event in the local Calendar. Dates/datetimes must be ISO formatted."""
    event = store().create_event(
        {
            "title": title,
            "starts_at": starts_at,
            "ends_at": ends_at,
            "all_day": all_day,
            "location": location,
            "notes": notes,
            "rrule": recurrence,
        }
    )
    return json.dumps(event, ensure_ascii=False, sort_keys=True)


@tool
def calendar_status() -> str:
    """Describe Calendar sources, event count, and storage health."""
    return json.dumps(
        {
            "events": len(store().list_events()),
            "sources": len(store().list_sources()),
            "integrity": store().integrity(),
            "overlays": ["local events", "iCalendar feeds", "Google Workspace when installed", "Scheduler"],
        },
        sort_keys=True,
    )


def _page_router():
    from fastapi import APIRouter, HTTPException
    from fastapi.responses import FileResponse

    router = APIRouter()
    assets = {
        "calendar.js": ("calendar.js", "text/javascript"),
        "calendar.css": ("calendar.css", "text/css"),
        "calendar-model.js": ("calendar-model.js", "text/javascript"),
    }

    @router.get("/view")
    async def view():
        return FileResponse(_VIEW / "calendar.html", media_type="text/html")

    @router.get("/assets/{name}")
    async def asset(name: str):
        item = assets.get(name)
        if item is None:
            raise HTTPException(status_code=404, detail="asset not found")
        filename, media_type = item
        return FileResponse(_VIEW / filename, media_type=media_type)

    return router


def _data_router():
    from fastapi import APIRouter, Body, HTTPException, Query

    router = APIRouter()

    def run(fn):
        try:
            return fn()
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(409, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(502, f"{type(exc).__name__}: {exc}") from exc

    @router.get("/status")
    def status():
        return {"plugin": "calendar", "status": "ready", "integrity": store().integrity()}

    @router.get("/events")
    def events():
        return {"events": run(store().list_events)}

    @router.post("/events", status_code=201)
    def create_event(payload: dict = Body(...)):
        return {"event": run(lambda: store().create_event(payload))}

    @router.patch("/events/{event_id}")
    def update_event(event_id: str, payload: dict = Body(...)):
        return {"event": run(lambda: store().update_event(event_id, payload))}

    @router.delete("/events/{event_id}")
    def delete_event(event_id: str, expected_version: int = Query(...)):
        return {"event": run(lambda: store().delete_event(event_id, expected_version))}

    @router.get("/sources")
    def sources():
        return {"sources": [_public_source(value) for value in run(store().list_sources)]}

    @router.post("/sources", status_code=201)
    def create_source(payload: dict = Body(...)):
        source = run(
            lambda: store().create_source(name=payload.get("name"), url=payload.get("url"), color=payload.get("color"))
        )
        try:
            source = run(lambda: _refresh(source["id"]))
        except HTTPException:
            source = store().get_source(source["id"])
        return {"source": _public_source(source)}

    @router.post("/sources/{source_id}/refresh")
    def refresh_source(source_id: str):
        return {"source": _public_source(run(lambda: _refresh(source_id)))}

    @router.delete("/sources/{source_id}")
    def delete_source(source_id: str):
        return {"source": _public_source(run(lambda: store().delete_source(source_id)))}

    return router


def register(registry) -> None:
    registry.register_tools([calendar_status, calendar_event_list, calendar_event_create])
    registry.register_skill_dir("skills")
    registry.register_router(_page_router(), prefix="/plugins/calendar")
    registry.register_router(_data_router(), prefix="/api/plugins/calendar")
