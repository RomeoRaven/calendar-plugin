"""Calendar workspace over protoAgent's public Scheduler API."""

from __future__ import annotations

from pathlib import Path

from langchain_core.tools import tool

_ROOT = Path(__file__).resolve().parent
_VIEW = _ROOT / "view"


@tool
def calendar_status() -> str:
    """Describe the Calendar plugin's active capability and ownership boundary."""
    return (
        "Calendar provides month, week, and agenda views over protoAgent Scheduler jobs. "
        "Scheduler remains authoritative for execution, recurrence, persistence, and recovery."
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


def register(registry) -> None:
    registry.register_tool(calendar_status)
    registry.register_skill_dir("skills")
    registry.register_router(_page_router(), prefix="/plugins/calendar")
