"""Calendar design stub scaffolded from the protoAgent Plugin DevKit."""

from __future__ import annotations

from langchain_core.tools import tool


@tool
def calendar_status() -> str:
    """Report the implementation status of the Calendar plugin."""
    return "calendar-plugin is a design stub; implementation is pending. See docs/PLAN.md."


def _page_router():
    from fastapi import APIRouter
    from fastapi.responses import HTMLResponse

    router = APIRouter()

    @router.get("/view")
    async def view():
        return HTMLResponse(
            "<!doctype html><html><head><meta charset='utf-8'>"
            "<script>window.__base=location.pathname.split('/plugins/')[0];"
            "var l=document.createElement('link');l.rel='stylesheet';"
            "l.href=window.__base+'/_ds/plugin-kit.css';document.head.appendChild(l);</script>"
            "<style>body{margin:0;padding:32px;background:var(--pl-color-bg);"
            "color:var(--pl-color-fg);font-family:var(--pl-font-sans,system-ui)}</style>"
            "</head><body><h1>Calendar</h1><p>Design stub — implementation pending.</p>"
            "<script type='module'>const kit=await import(window.__base+'/_ds/plugin-kit.js');"
            "kit.initPluginView();</script></body></html>"
        )

    return router


def _data_router():
    from fastapi import APIRouter

    router = APIRouter()

    @router.get("/status")
    async def status():
        return {"plugin": "calendar", "status": "design-stub"}

    return router


def register(registry) -> None:
    registry.register_tool(calendar_status)
    registry.register_skill_dir("skills")
    registry.register_router(_page_router(), prefix="/plugins/calendar")
    registry.register_router(_data_router(), prefix="/api/plugins/calendar")
