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
    test_qa_artifact_sweep_flags_ghosts()
    test_qa_clean_pass_edit_path_unchanged_and_never_raise()
    print("ALL RECOMPOSE-QA TESTS PASSED")
