"""Backend smoke tests — boot the app, exercise auth + the (now protected) API.

No billable API calls. A deterministic test admin is seeded via env BEFORE import;
the /run test trips engine validation (an unsupported size) before any OpenAI call.

Run:  .venv/Scripts/python.exe test_smoke.py   (or python -m pytest test_smoke.py)
"""
import os
import sys
from pathlib import Path

os.environ.setdefault("OPENAI_API_KEY", "sk-dummy-for-tests")  # reach validation; never spent
os.environ["ADMIN_EMAIL"] = "admin@test.local"                 # deterministic test admin
os.environ["ADMIN_PASSWORD"] = "smoke-test-pass"
sys.path.insert(0, str(Path(__file__).resolve().parent))       # so `import app` resolves

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)   # becomes authenticated via _login() below
anon = TestClient(app)     # never logs in


def _login(c=client):
    r = c.post("/api/auth/login",
               json={"email": "admin@test.local", "password": "smoke-test-pass"})
    assert r.status_code == 200, r.text
    return r


_login()  # seed the session cookie for the protected-endpoint tests


def test_health():
    r = anon.get("/api/health")  # public
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_auth_required_without_session():
    assert anon.get("/api/meta").status_code == 401
    assert anon.get("/api/tools").status_code == 401
    assert anon.get("/api/tools/banner-builder/runs/none").status_code == 401


def test_auth_flow():
    assert anon.post("/api/auth/login",
                     json={"email": "admin@test.local", "password": "wrong"}).status_code == 401
    me = client.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["user"]["role"] == "admin"


def test_meta_exposes_engine_constants():
    r = client.get("/api/meta")
    assert r.status_code == 200
    data = r.json()
    assert len(data["button_combos"]) == 8         # proves the engine imported
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
    available = {tid for tid, t in tools.items() if t["status"] == "available"}
    assert available == {"banner-builder", "qa", "creative-summary", "translate-figma"}, available
    for removed in ("banner-prompt", "banner-higgsfield", "pull", "push"):
        assert removed not in tools, removed


def test_tool_config_gates():
    g = client.get("/api/tools/banner-builder/config")
    assert g.status_code == 200 and "instructions" in g.json()
    assert anon.get("/api/tools/banner-builder/config").status_code == 401


def test_run_rejects_bad_size_with_422():
    # New campaign/card request shape: settings menu + simple concept cards.
    payload = {
        "model": "gpt-image-2", "quality": "medium", "locale": "en",
        "style": "warm editorial, orange accents",
        "sizes": ["1200x1200", "1234x5678"],
        "concepts": [{
            "key": "c1",
            "title": "Oil prices fell. The ringgit moved.",
            "subtitle": "Three signals, one connected story.",
            "button": "Learn more",
        }],
    }
    r = client.post("/api/tools/banner-builder/run", json=payload)
    assert r.status_code == 422, r.text
    errs = r.json()["detail"]["errors"]
    assert any("1234x5678" in e for e in errs), errs


if __name__ == "__main__":
    test_health()
    test_auth_required_without_session()
    test_auth_flow()
    test_meta_exposes_engine_constants()
    test_tools_listing()
    test_tool_config_gates()
    test_run_rejects_bad_size_with_422()
    print("ALL BACKEND SMOKE TESTS PASSED")
