"""Regression tests for the recompose ghost-text defense.

Guards the two nets against the double-exposure defect (remnants of the square
master's text/button surviving in wide recomposes), with no network calls:
(1) the recompose prompt carries the CLEAN REPAINT anti-ghost contract, and
(2) the vision QA's layout-artifact sweep fails a ghosted frame while staying
never-raise on model errors.

Run:  .venv/Scripts/python.exe test_recompose_qa.py   (or python -m pytest test_recompose_qa.py)
"""
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("OPENAI_API_KEY", "sk-dummy-for-tests")
os.environ.setdefault("PLATFORM_ARTIFACT_DIR", tempfile.mkdtemp(prefix="recompose-qa-tests-"))
sys.path.insert(0, str(Path(__file__).resolve().parent))  # so `import app` resolves

from app.banner_engine import prompts as bprompts  # noqa: E402
from app import banner_edit  # noqa: E402


def _concept():
    return {"title": "Oil prices fell. The ringgit moved.",
            "hook_phrase": "Oil prices",
            "subtitle": "Three signals, one connected story.",
            "cta": "Learn more",
            "button_combo": ["#2563EB", "#FFFFFF"],
            "locale": "en"}


def test_recomp_prompt_carries_clean_repaint_rule():
    # The wide family is where the ghosts shipped — but the rule must ride
    # EVERY recomposed aspect.
    for target in ("1200x628", "960x1200", "1080x1920"):
        p = bprompts.build_recomp_prompt(_concept(), master_size="1200x1200",
                                         target_size=target)
        assert "CLEAN REPAINT" in p, target
        assert "EXACTLY ONCE" in p, target
        assert "double exposure" in p.lower(), target
        assert "no second CTA button" in p, target
    # ...and the constant itself stays a named, reusable rule.
    assert "REFERENCE ONLY" in bprompts.CLEAN_REPAINT_RULE


def test_plate_prompt_and_plate_mode_recomp():
    # The plate derivation prompt: strip ALL typography, change nothing else.
    assert "Remove ALL text" in bprompts.PLATE_PROMPT
    assert "ZERO typography" in bprompts.PLATE_PROMPT
    assert "same person/subject" in bprompts.PLATE_PROMPT
    # Plate-mode recompose: typeset onto the text-free scene, style from image 2.
    p = bprompts.build_recomp_prompt(_concept(), master_size="1200x1200",
                                     target_size="1200x628", from_plate=True)
    assert "TEXT-FREE" in p and "TYPESET" in p
    assert "SECOND attached image" in p and "style reference" in p
    assert "CLEAN REPAINT" in p          # the once-only contract still rides along
    # Legacy (no plate) wording is unchanged.
    p2 = bprompts.build_recomp_prompt(_concept(), master_size="1200x1200",
                                      target_size="1200x628")
    assert "RECOMPOSE the attached master" in p2 and "TEXT-FREE" not in p2


def test_ensure_plate_derives_once_and_falls_back():
    from app import runner

    class _StubRun:
        def __init__(self, d):
            self.dir = d
            self.id = "r_platetest"
            self.api_key = "sk-test"
            self.model = "gpt-image-2"
            self.quality = "medium"

    run_dir = Path(tempfile.mkdtemp(prefix="plate-run-"))
    run = _StubRun(run_dir)
    # no master on disk yet -> no plate, no API call
    calls = {"n": 0}
    orig = runner.engine.generate_png

    def fake_generate(**kw):
        calls["n"] += 1
        assert kw["prompt"] == bprompts.PLATE_PROMPT
        assert kw["mode"] == "edit"
        return b"plate-png-bytes"

    runner.engine.generate_png = fake_generate
    try:
        assert runner._ensure_plate(run, "c1") is None and calls["n"] == 0
        # master exists -> derived exactly once, cached for every later size
        (run_dir / "c1__1200x1200.png").write_bytes(b"master-bytes")
        p1 = runner._ensure_plate(run, "c1")
        p2 = runner._ensure_plate(run, "c1")
        assert p1 and p1 == p2 and p1.endswith("c1__plate.png")
        assert Path(p1).read_bytes() == b"plate-png-bytes"
        assert calls["n"] == 1                     # amortized: ONE call, all sizes
        # derivation failure -> graceful None (recompose falls back to master)
        def boom(**kw):
            raise RuntimeError("edits down")
        runner.engine.generate_png = boom
        (run_dir / "c2__1200x1200.png").write_bytes(b"master-bytes")
        assert runner._ensure_plate(run, "c2") is None
    finally:
        runner.engine.generate_png = orig


def test_qa_artifact_sweep_flags_ghosts():
    calls = {}

    def fake_vision(api_key, **kw):
        calls["user"] = kw.get("user_text") or ""
        calls["system"] = kw.get("system") or ""
        return {"results": [
            {"expected": "Oil prices fell. The ringgit moved.",
             "read": "Oil prices fell. The ringgit moved.", "matches": True},
            {"expected": "layout-artifact sweep",
             "read": "ghost partial letters along the left edge; a second yellow "
                     "button stub behind the CTA", "matches": False},
        ]}

    orig = banner_edit._vision_json
    banner_edit._vision_json = fake_vision
    try:
        v = banner_edit._qa_candidate("sk-test", b"png-bytes",
                                      ["Oil prices fell. The ringgit moved."], [],
                                      artifacts=True)
    finally:
        banner_edit._vision_json = orig
    assert v["qa_ok"] is False                     # ghosts fail the frame
    assert "ghost" in v["qa_read"]                 # the reason surfaces to the re-roll
    assert "Layout-artifact sweep" in calls["user"]     # the sweep was actually asked
    assert "layout-artifact sweep" in calls["system"]   # ...and defined for the model


def test_qa_master_reference_compare():
    calls = {}

    def fake_vision(api_key, **kw):
        calls["user"] = kw.get("user_text") or ""
        calls["reference"] = kw.get("reference_bytes")
        return {"results": [
            {"expected": "Title", "read": "Title", "matches": True},
            {"expected": "layout-artifact sweep", "read": "clean", "matches": True},
            {"expected": "master fidelity",
             "read": "the green baseline meets the subject at different heights "
                     "left vs right; hero noticeably smaller than the master",
             "matches": False},
        ]}

    orig = banner_edit._vision_json
    banner_edit._vision_json = fake_vision
    try:
        v = banner_edit._qa_candidate("sk-test", b"candidate-png", ["Title"], [],
                                      artifacts=True, reference_png=b"master-png")
    finally:
        banner_edit._vision_json = orig
    assert v["qa_ok"] is False                          # fidelity break fails the frame
    assert "different heights" in v["qa_read"]          # the reason reaches the re-roll
    assert calls["reference"] == b"master-png"          # master actually attached
    assert "IMAGE 1 is the APPROVED MASTER" in calls["user"]
    assert "Master-fidelity check" in calls["user"]
    # without a reference, the fidelity entry is never asked
    calls2 = {}

    def fake_vision2(api_key, **kw):
        calls2["user"] = kw.get("user_text") or ""
        calls2["reference"] = kw.get("reference_bytes", "missing")
        return {"results": [{"expected": "T", "read": "T", "matches": True}]}

    banner_edit._vision_json = fake_vision2
    try:
        banner_edit._qa_candidate("sk-test", b"png", ["T"], [])
    finally:
        banner_edit._vision_json = orig
    assert "Master-fidelity" not in calls2["user"]
    assert calls2["reference"] is None


def test_qa_clean_pass_edit_path_unchanged_and_never_raise():
    orig = banner_edit._vision_json
    # all-clean -> pass
    banner_edit._vision_json = lambda api_key, **kw: {"results": [
        {"expected": "T", "read": "T", "matches": True},
        {"expected": "layout-artifact sweep", "read": "clean", "matches": True}]}
    try:
        v = banner_edit._qa_candidate("sk-test", b"png", ["T"], [], artifacts=True)
        assert v["qa_ok"] is True
    finally:
        banner_edit._vision_json = orig
    # the edit workspace's existing calls (no artifacts kwarg) keep old behavior
    banner_edit._vision_json = lambda api_key, **kw: (_ for _ in ()).throw(
        AssertionError("must not be called"))
    try:
        v = banner_edit._qa_candidate("sk-test", b"png", [], [])
        assert v["qa_ok"] is None and v["qa_read"] == ""   # nothing to check -> skip
    finally:
        banner_edit._vision_json = orig

    # model failure -> never raises, verdict is "unavailable"
    def boom(api_key, **kw):
        raise RuntimeError("model down")
    banner_edit._vision_json = boom
    try:
        v = banner_edit._qa_candidate("sk-test", b"png", ["T"], [], artifacts=True)
        assert v["qa_ok"] is None
    finally:
        banner_edit._vision_json = orig


if __name__ == "__main__":
    test_recomp_prompt_carries_clean_repaint_rule()
    test_plate_prompt_and_plate_mode_recomp()
    test_ensure_plate_derives_once_and_falls_back()
    test_qa_artifact_sweep_flags_ghosts()
    test_qa_master_reference_compare()
    test_qa_clean_pass_edit_path_unchanged_and_never_raise()
    print("ALL RECOMPOSE-QA TESTS PASSED")
