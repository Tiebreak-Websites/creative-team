"""Backend smoke tests — boot the app, exercise auth + the (now protected) API.

No billable API calls. A deterministic test admin is seeded via env BEFORE import;
the /run test trips engine validation (an unsupported size) before any OpenAI call.

Run:  .venv/Scripts/python.exe test_smoke.py   (or python -m pytest test_smoke.py)
"""
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("OPENAI_API_KEY", "sk-dummy-for-tests")  # reach validation; never spent
os.environ["ADMIN_EMAIL"] = "admin@test.local"                 # deterministic test admin
os.environ["ADMIN_PASSWORD"] = "smoke-test-pass"
# A copywriter account for the writer-scoping tests, and a throwaway artifact
# dir so test-created projects never rehydrate into a real workspace.
os.environ["PLATFORM_USERS"] = "writer@test.local|writer-pass|copywriter"
os.environ.setdefault("PLATFORM_ARTIFACT_DIR", tempfile.mkdtemp(prefix="creative-smoke-"))
sys.path.insert(0, str(Path(__file__).resolve().parent))       # so `import app` resolves

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402
from app import runner  # noqa: E402

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
    assert available == {"banner-builder"}, available  # single-purpose app
    for removed in ("qa", "creative-summary", "translate-figma",
                    "banner-prompt", "banner-higgsfield", "pull", "push"):
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


def test_director_validation_and_fallback():
    """The GPT-5.5 director's output is run through the engine's own rules with a
    per-field deterministic fallback. Pure logic — no network."""
    # Good result: hook is a verbatim substring, briefs clean, bg approved.
    good = runner._validate_director(
        title="Oil prices fell. The ringgit moved.",
        base_hook="Oil prices",
        base_brief="TEMPLATE BRIEF",
        base_button_combo=["#2563EB", "#FFFFFF"],
        has_cta=True,
        sizes=["1200x1200", "1080x1920"],
        result={
            "hook_phrase": "Oil prices fell",
            "button_bg": "#F97316",
            "size_briefs": {
                "1200x1200": "A clean editorial poster with a warm gradient.",
                "1080x1920": "Tall composition, hook stacked high, calm mood.",
            },
        },
    )
    assert good["hook"] == "Oil prices fell"                 # accepted (substring of title)
    assert good["button_combo"] == ["#F97316", "#FFFFFF"]    # snapped to the approved pair
    assert good["sizes_directed"] == 2
    assert good["size_briefs"]["1080x1920"].startswith("Tall")

    # Bad result: hook not in title -> base hook; forbidden keyword -> template brief;
    # unknown bg -> keep base combo.
    bad = runner._validate_director(
        title="Premium fund launch",
        base_hook="Premium fund",
        base_brief="TEMPLATE BRIEF",
        base_button_combo=["#2563EB", "#FFFFFF"],
        has_cta=True,
        sizes=["1200x1200"],
        result={
            "hook_phrase": "RIGGED MARKETS",
            "button_bg": "#000000",
            "size_briefs": {"1200x1200": "poster featuring elon musk silhouette"},
        },
    )
    assert bad["hook"] == "Premium fund"                     # reverted to base
    assert bad["button_combo"] == ["#2563EB", "#FFFFFF"]     # bad bg ignored
    assert bad["size_briefs"]["1200x1200"] == "TEMPLATE BRIEF"  # moderation fallback
    assert bad["sizes_directed"] == 0


writer = TestClient(app)   # the copywriter role, seeded via PLATFORM_USERS


def _login_writer():
    r = writer.post("/api/auth/login",
                    json={"email": "writer@test.local", "password": "writer-pass"})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["role"] == "copywriter"


_login_writer()


def test_copywriter_sees_only_assigned_pages():
    a = client.post("/api/tools/lp-builder/projects", json={"name": "unassigned page"})
    assert a.status_code == 201, a.text
    b = client.post("/api/tools/lp-builder/projects",
                    json={"name": "assigned page", "assigned_to": "writer@test.local"})
    assert b.status_code == 201, b.text
    assert b.json()["status"] == "draft" and b.json()["assigned_to"] == "writer@test.local"
    mine = writer.get("/api/tools/lp-builder/projects").json()["projects"]
    assert {p["id"] for p in mine} == {b.json()["id"]}, mine
    everyone = client.get("/api/tools/lp-builder/projects").json()["projects"]
    assert {a.json()["id"], b.json()["id"]} <= {p["id"] for p in everyone}
    assert writer.get(f"/api/tools/lp-builder/projects/{a.json()['id']}").status_code == 403
    assert writer.get(f"/api/tools/lp-builder/projects/{b.json()['id']}").status_code == 200
    globals()["_PID_A"], globals()["_PID_B"] = a.json()["id"], b.json()["id"]


def test_copywriter_put_is_content_only():
    pid = _PID_B
    # admin lays out one styled section instance + an image the writer must not touch
    r = client.put(f"/api/tools/lp-builder/projects/{pid}",
                   json={"sections": [{"iid": "aaaa1111", "template_key": "el-title",
                                       "texts": {}, "images": {"img": "/api/x.png"},
                                       "props": {"title": {"base": {"color": "#111111"}}}}]})
    assert r.status_code == 200, r.text
    # writer sends a full hostile doc: content applies (texts, structure,
    # repeats, brief/meta/status) — design and page identity do not
    r = writer.put(f"/api/tools/lp-builder/projects/{pid}", json={
        "name": "HACKED", "brand_id": "evil", "tokens": {"primary": "#000000"},
        "brief": "A launch page for the new savings account",
        "meta_title": "Writer meta title", "status": "copy_ready",
        "sections": [
            {"iid": "aaaa1111", "template_key": "el-title", "texts": {"title": "Written by AI-era human"},
             "images": {"img": "/api/evil.png"}, "props": {"title": {"base": {"color": "#FF0000"}}}},
            {"iid": "bbbb2222", "template_key": "el-cards", "texts": {"body": "new section by the writer"},
             "repeats": {"cards": 5}, "props": {"body": {"base": {"color": "#FF0000"}}}},
        ]})
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["name"] == "assigned page"            # name change dropped
    assert p["brand_id"] != "evil"                 # brand change dropped
    assert p["brief"].startswith("A launch page")  # brief applied
    assert p["meta_title"] == "Writer meta title"  # meta applied
    assert p["status"] == "copy_ready"             # status transition applied
    assert len(p["sections"]) == 2                 # writers CAN add sections
    a = next(s for s in p["sections"] if s["iid"] == "aaaa1111")
    b = next(s for s in p["sections"] if s["iid"] == "bbbb2222")
    assert a["texts"] == {"title": "Written by AI-era human"}          # texts applied
    assert a["props"] == {"title": {"base": {"color": "#111111"}}}     # designer styling kept
    assert a["images"] == {"img": "/api/x.png"}                        # designer image kept
    assert b["texts"] == {"body": "new section by the writer"}
    assert b["repeats"] == {"cards": 5}                                # repeat counts applied
    assert b["props"] == {} and b["images"] == {}                      # new sections design-clean
    # writer cannot touch a page not assigned to them
    assert writer.put(f"/api/tools/lp-builder/projects/{_PID_A}",
                      json={"brief": "nope"}).status_code == 403


def test_copywriter_forbidden_surfaces():
    assert writer.post("/api/tools/lp-builder/projects", json={"name": "x"}).status_code == 403
    assert writer.post(f"/api/tools/lp-builder/projects/{_PID_B}/duplicate", json={}).status_code == 403
    assert writer.delete(f"/api/tools/lp-builder/projects/{_PID_B}").status_code == 403
    assert writer.get(f"/api/tools/lp-builder/projects/{_PID_B}/export.zip").status_code == 403
    assert writer.get(f"/api/tools/lp-builder/projects/{_PID_B}/preview.html").status_code == 403
    assert writer.post("/api/tools/lp-builder/assets/import", json={"url": "x"}).status_code == 403
    # other tools 403 at the router mount, before any handler logic
    assert writer.get("/api/tools/banner-builder/runs/none").status_code == 403
    assert writer.get("/api/tools/email-builder/copy/jobs").status_code == 403
    # ...while the admin still reaches them (404 = past the gate, into the handler)
    assert client.get("/api/tools/banner-builder/runs/none").status_code == 404


def test_writers_listing_and_copy_validation():
    ws = client.get("/api/tools/lp-builder/writers")
    assert ws.status_code == 200
    assert any(w["email"] == "writer@test.local" for w in ws.json()["writers"])
    # generation refuses to start without a brief / without a rewrite section
    r = writer.post("/api/tools/lp-builder/copy/generate",
                    json={"project_id": _PID_B, "brief": "", "sections": []})
    assert r.status_code == 422
    r = writer.post("/api/tools/lp-builder/copy/generate",
                    json={"project_id": _PID_B, "brief": "About the page",
                          "sections": [{"iid": "aaaa1111", "mode": "keep"}]})
    assert r.status_code == 422


if __name__ == "__main__":
    test_health()
    test_auth_required_without_session()
    test_auth_flow()
    test_meta_exposes_engine_constants()
    test_tools_listing()
    test_tool_config_gates()
    test_run_rejects_bad_size_with_422()
    test_director_validation_and_fallback()
    test_copywriter_sees_only_assigned_pages()
    test_copywriter_put_is_content_only()
    test_copywriter_forbidden_surfaces()
    test_writers_listing_and_copy_validation()
    print("ALL BACKEND SMOKE TESTS PASSED")
