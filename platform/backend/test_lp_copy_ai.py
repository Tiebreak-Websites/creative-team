"""Unit tests for the LP Builder AI copywriter (lp_builder.copy_ai).

Pure logic — no network, no billable calls: the GPT-5.5 call is replaced by a
fake. Guards the spec builder (rewrite fields vs read-only context, language
resolution), strict output validation (off-spec pairs dropped), the apply +
before-snapshot round-trip, and per-section restore.

Run:  .venv/Scripts/python.exe test_lp_copy_ai.py   (or python -m pytest test_lp_copy_ai.py)
"""
import os
import sys
import tempfile
import time
from pathlib import Path

os.environ.setdefault("PLATFORM_ARTIFACT_DIR", tempfile.mkdtemp(prefix="lp-copy-tests-"))
sys.path.insert(0, str(Path(__file__).resolve().parent))  # so `import app` resolves

from app.lp_builder import copy_ai, core  # noqa: E402

SEC = {
    "key": "t-hero", "name": "Hero", "category": "test", "position": 10,
    "enabled": True, "built_in": False,
    "html": '<section><h1 data-lp-text="title">x</h1><p data-lp-rich="body">y</p></section>',
    "css": "",
    "texts": {"en": {"title": "Default EN title", "body": "Default EN body"},
              "pt": {"title": "Titulo padrao PT", "body": "Corpo padrao PT"}},
    "names": {"title": "Headline", "body": "Supporting text"},
}


def _seed_project(pid: str, lang: str = "pt") -> dict:
    p = {
        "id": pid, "name": "Test LP", "brand_id": "test", "language": lang,
        "sections": [
            {"iid": "sec1", "template_key": "t-hero",
             "texts": {"title": "Handwritten PT title"}},   # override beats defaults
            {"iid": "sec2", "template_key": "t-hero", "texts": {}},
        ],
        "meta_title": "", "meta_description": "", "brief": "",
        "assigned_to": "writer@test.local", "status": "draft",
        "created_by": "admin@test.local",
        "created_at": core._now(), "updated_at": core._now(),
    }
    with core.lock():
        core.sections()["t-hero"] = SEC
        core.projects()[pid] = p
    return p


def _wait(job, secs: float = 5.0) -> None:
    deadline = time.time() + secs
    while job["status"] in ("queued", "running") and time.time() < deadline:
        time.sleep(0.02)


def test_build_spec_fields_language_and_targets():
    p = _seed_project("lp_spec")
    with core.lock():
        smap = dict(core.sections())
    spec, targets = copy_ai._build_spec(p, smap, {"sec1": "rewrite"}, "brief here", True)
    assert spec["page"]["language"]["code"] == "pt"
    by_iid = {s["iid"]: s for s in spec["sections"]}
    # rewrite section: fields with label + current (instance override wins over
    # the pt default, pt default wins over en)
    f = {x["key"]: x for x in by_iid["sec1"]["fields"]}
    assert f["title"]["current"] == "Handwritten PT title"
    assert f["title"]["label"] == "Headline"
    assert f["body"]["current"] == "Corpo padrao PT"
    assert f["title"]["target_chars"] >= 24
    # untouched section rides along as read-only context
    assert by_iid["sec2"]["mode"] == "context"
    assert by_iid["sec2"]["copy"]["title"] == "Titulo padrao PT"
    assert targets == {("sec1", "title"), ("sec1", "body")}


def test_job_applies_validates_and_snapshots():
    p = _seed_project("lp_apply")
    calls = {}

    def fake_llm(api_key, **kw):
        calls["effort"] = kw.get("effort")
        calls["system"] = kw.get("system")
        return {"items": [
            {"iid": "sec1", "key": "title", "value": "Novo titulo gerado"},
            {"iid": "sec1", "key": "body", "value": "Novo corpo gerado"},
            {"iid": "sec2", "key": "title", "value": "OFF-SPEC (kept section)"},
            {"iid": "sec1", "key": "ghost", "value": "OFF-SPEC (unknown key)"},
        ], "meta_title": "Meta novo", "meta_description": "Descricao nova"}

    orig = copy_ai._llm_json
    copy_ai._llm_json = fake_llm
    try:
        job = copy_ai.start_job(api_key="sk-test", project_id="lp_apply",
                                brief="Pagina sobre poupanca", modes={"sec1": "rewrite", "sec2": "keep"},
                                include_meta=True, user_email="writer@test.local")
        _wait(job)
    finally:
        copy_ai._llm_json = orig
    assert job["status"] == "done", job.get("error")
    assert calls["effort"] == copy_ai.EFFORT           # pinned, not configurable
    assert "PART 1" in calls["system"]                 # lp_copywriter.md loaded verbatim
    with core.lock():
        live = core.projects()["lp_apply"]
    sec1 = next(i for i in live["sections"] if i["iid"] == "sec1")
    sec2 = next(i for i in live["sections"] if i["iid"] == "sec2")
    assert sec1["texts"]["title"] == "Novo titulo gerado"
    assert sec1["texts"]["body"] == "Novo corpo gerado"
    assert sec2["texts"] == {}                         # off-spec fill dropped
    assert live["meta_title"] == "Meta novo" and job["meta_written"]
    assert live["brief"] == "Pagina sobre poupanca"    # brief persisted with the page
    assert job["rewrote_iids"] == ["sec1"]
    assert job["before"]["sec1"] == {"title": "Handwritten PT title"}  # snapshot
    assert "_api_key" not in job and "_api_key" not in copy_ai.public_job(job)
    assert "before" not in copy_ai.public_job(job)
    globals()["_JOB"] = job


def test_restore_section_and_meta():
    job = _JOB
    copy_ai.restore_section(job, "sec1")
    with core.lock():
        live = core.projects()["lp_apply"]
    sec1 = next(i for i in live["sections"] if i["iid"] == "sec1")
    assert sec1["texts"] == {"title": "Handwritten PT title"}
    copy_ai.restore_section(job, "__meta__")
    with core.lock():
        live = core.projects()["lp_apply"]
    assert live["meta_title"] == ""
    try:
        copy_ai.restore_section(job, "sec2")
        raise AssertionError("expected KeyError for a section that was never rewritten")
    except KeyError:
        pass


def test_job_error_paths():
    _seed_project("lp_err")
    # model returns nothing usable -> job errors instead of silently done
    orig = copy_ai._llm_json
    copy_ai._llm_json = lambda api_key, **kw: {"items": [], "meta_title": "", "meta_description": ""}
    try:
        job = copy_ai.start_job(api_key="sk-test", project_id="lp_err", brief="b",
                                modes={"sec1": "rewrite"}, include_meta=False,
                                user_email="w@test.local")
        _wait(job)
    finally:
        copy_ai._llm_json = orig
    assert job["status"] == "error" and "usable" in (job["error"] or "")
    # nothing rewritable selected -> error, not a silent no-op
    job2 = copy_ai.start_job(api_key="sk-test", project_id="lp_err", brief="b",
                             modes={}, include_meta=False, user_email="w@test.local")
    _wait(job2)
    assert job2["status"] == "error"


if __name__ == "__main__":
    test_build_spec_fields_language_and_targets()
    test_job_applies_validates_and_snapshots()
    test_restore_section_and_meta()
    test_job_error_paths()
    print("ALL LP COPY-AI TESTS PASSED")
