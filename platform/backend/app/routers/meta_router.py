"""GET /api/meta — engine-derived constants so the frontend never hardcodes them."""
from fastapi import APIRouter

from .. import engine
from .. import sizes_config
from ..tool_config import merged_config

router = APIRouter(prefix="/api", tags=["meta"])

# gpt-image-2 image-quality tiers (low | medium | high). "high" = max fidelity.
QUALITIES = ["low", "medium", "high"]

# GPT-5.5 reasoning-effort tiers offered for the creative director. "xhigh" is
# the model's maximum ("Extended"). Values are the real OpenAI effort strings.
THINKING_EFFORTS = [
    {"value": "low", "label": "Low"},
    {"value": "medium", "label": "Medium"},
    {"value": "high", "label": "High"},
    {"value": "xhigh", "label": "Extended"},
]


@router.get("/meta")
def meta():
    # Defaults come from the admin tool-config so they stay editable from the UI.
    try:
        opts = merged_config("banner-builder").get("options", {}) or {}
    except Exception:  # noqa: BLE001 - meta must never 500 on a config hiccup
        opts = {}
    cd = opts.get("creativeDirector") or {}
    return {
        "button_combos": [{"bg": bg, "text": text} for bg, text in engine.BUTTON_COMBOS],
        # Dynamic: built-ins + every registered custom size (see sizes_config).
        "sizes": sizes_config.all_sizes(),
        "master_size": engine.MASTER_SIZE,
        "models": engine.MODELS,
        "qualities": QUALITIES,
        "default_quality": opts.get("defaultQuality") if opts.get("defaultQuality") in QUALITIES else "medium",
        "thinking_efforts": THINKING_EFFORTS,
        # Speed-first defaults (target ~1 min/run): Medium quality + Low director
        # effort. High quality (~2 min/image, measured live) and higher efforts stay
        # available per run / via admin creativeDirector.effort.
        "default_effort": cd.get("effort") or "low",
    }
