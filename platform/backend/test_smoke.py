"""Backend smoke tests — boot the app and exercise the free endpoints.

No billable API calls: the /run test hits the engine's validation path (a bad
hook) which returns 422 before any OpenAI job starts. A dummy OPENAI_API_KEY is
set only so the secret-preflight passes and validation is reached.

Run:  .venv/Scripts/python.exe -m pytest test_smoke.py   (or just run the file)
"""
import os
import sys
from pathlib import Path

os.environ.setdefault("OPENAI_API_KEY", "sk-dummy-for-tests")  # reach validation; never spent
sys.path.insert(0, str(Path(__file__).resolve().parent))  # so `import app` resolves

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_meta_exposes_engine_constants():
    r = client.get("/api/meta")
    assert r.status_code == 200
    data = r.json()
    assert len(data["button_combos"]) == 8         # proves prompts.py imported
    assert "1200x1200" in data["sizes"]
    assert data["master_size"] == "1200x1200"
    assert "gpt-image-2" in data["models"]


def test_tools_listing():
    r = client.get("/api/tools")
    assert r.status_code == 200
    tools = {t["id"]: t for t in r.json()["tools"]}
    bb = tools["banner-builder"]
    assert bb["status"] == "available"
    assert bb["custom_ui"] is True
    assert any(s["env"] == "OPENAI_API_KEY" for s in bb["secrets"])
    # The web platform hosts exactly these four tools, all live.
    available = {tid for tid, t in tools.items() if t["status"] == "available"}
    assert available == {"banner-builder", "qa", "creative-summary", "translate-figma"}, available
    # The Claude-Code-only commands are not surfaced in the web nav.
    for removed in ("banner-prompt", "banner-higgsfield", "pull", "push"):
        assert removed not in tools, removed


def test_run_rejects_bad_hook_with_422():
    payload = {
        "banner_text": "Oil prices fell. The ringgit moved.",
        "sizes": ["1200x1200"],
        "concepts": [{
            "key": "c1",
            "title": "Oil prices fell. The ringgit moved.",
            "hook_phrase": "NOT IN THE TITLE",
            "creative_brief": "Type-hero poster, charcoal and orange, editorial.",
        }],
    }
    r = client.post("/api/tools/banner-builder/run", json=payload)
    assert r.status_code == 422, r.text
    errs = r.json()["detail"]["errors"]
    assert any("hook_phrase" in e for e in errs), errs


if __name__ == "__main__":
    test_health()
    test_meta_exposes_engine_constants()
    test_tools_listing()
    test_run_rejects_bad_hook_with_422()
    print("ALL BACKEND SMOKE TESTS PASSED")
