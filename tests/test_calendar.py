"""Host-free tests for the Calendar plugin."""

from pathlib import Path

import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent


def test_register_contributes_tool_skill_and_public_router(plugin, registry):
    plugin.register(registry)
    assert [tool.name for tool in registry.tools] == ["calendar_status"]
    assert registry.skill_dirs == ["skills"]
    assert len(registry.routers) == 1
    assert registry.routers[0][0] == "/plugins/calendar"


def test_manifest_is_release_candidate_shape():
    manifest = yaml.safe_load((ROOT / "protoagent.plugin.yaml").read_text(encoding="utf-8"))
    assert manifest["id"] == "calendar"
    assert manifest["version"] == "0.1.0"
    assert manifest["enabled"] is False
    assert manifest["min_protoagent_version"] == "0.147.0"
    assert manifest["public_paths"] == ["/plugins/calendar/assets/"]
    assert manifest["views"][0]["path"] == "/plugins/calendar/view"


def test_page_and_assets_are_served(plugin):
    app = FastAPI()
    app.include_router(plugin._page_router(), prefix="/plugins/calendar")
    client = TestClient(app)

    page = client.get("/plugins/calendar/view")
    assert page.status_code == 200
    assert "Calendar" in page.text
    assert "calendar/assets/calendar.js" in page.text

    for name in ("calendar.js", "calendar.css", "calendar-model.js"):
        response = client.get(f"/plugins/calendar/assets/{name}")
        assert response.status_code == 200
        assert response.text
    assert client.get("/plugins/calendar/assets/secret.txt").status_code == 404


def test_browser_uses_public_scheduler_api_only():
    source = (ROOT / "view" / "calendar.js").read_text(encoding="utf-8")
    assert '"/api/scheduler/jobs"' in source
    assert "/api/plugins/calendar" not in source
    assert "scheduler.db" not in source
    assert "protoagent:subscribe" in source
    assert "scheduler.fired" in source
