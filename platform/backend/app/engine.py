"""Adapter exposing the banner engine to the backend.

The engine now lives inside this package at app/banner_engine/ (prompts.py +
engine_core.py) and is imported directly — no sys.path juggling, no copies.
"""
import math
import re

from .banner_engine import prompts as _prompts
from .banner_engine.prompts import (  # noqa: F401
    build_prompt,
    build_recomp_prompt,
    check_moderation,
    validate_manifest,
    normalize_cta,
    BUTTON_COMBOS,
    LAYOUT_BASE,
    BUTTON_PLACEMENT,
    DISPLAY_SIZES,
)
from .banner_engine.engine_core import (  # noqa: F401
    generate_png,
    GenError,
    OPENAI_SIZE_MAP,
)

# Convenience constants for the backend + the /api/meta endpoint.
SUPPORTED_SIZES = sorted(LAYOUT_BASE.keys())  # built-ins (import-time snapshot)
MASTER_SIZE = "1200x1200"
MODELS = ["gpt-image-2", "gpt-image-1-mini"]

# ---------------------------------------------------------------------------
# Custom sizes — any sane WxH is generatable
# ---------------------------------------------------------------------------
# The render happens at the nearest OpenAI aspect (1:1 / 3:2 / 2:3) and is then
# reshaped to EXACT pixels (banner_engine/reshape.fit_export), and the crop-
# safety notes in prompts.py are computed numerically from the size string. So
# making a new size generatable only needs the four lookup tables filled in,
# inheriting the layout language of the closest built-in aspect.
SIZE_RE = re.compile(r"^(\d{2,4})x(\d{2,4})$")
MIN_DIM, MAX_DIM = 50, 4096
_MAX_ASPECT = 10.0  # widest built-in slot is 728x90 (~8:1)

_GEN_CHOICES = (
    ("1024x1024", 1.0),
    ("1536x1024", 1536 / 1024),
    ("1024x1536", 1024 / 1536),
)
# Canonical bases a custom size inherits layout/button/family language from,
# picked by nearest log-aspect (so 700x900 reads as PORTRAIT, 900x300 as WIDE).
_BASE_CHOICES = ("1080x1920", "960x1200", "1200x1200", "1200x960", "1920x1080", "1200x628")


def parse_size(size: str):
    """'1200x628' -> (1200, 628); None when malformed or out of bounds."""
    m = SIZE_RE.match((size or "").strip())
    if not m:
        return None
    w, h = int(m.group(1)), int(m.group(2))
    if not (MIN_DIM <= w <= MAX_DIM and MIN_DIM <= h <= MAX_DIM):
        return None
    return w, h


def _ratio(size: str) -> float:
    w, h = (int(x) for x in size.split("x"))
    return w / h


def ensure_size(size: str):
    """Make an arbitrary 'WxH' export size generatable, registering it with the
    prompt/layout tables on first sight. Idempotent; built-in sizes are a no-op.
    Returns (ok, reason) — reason is a user-facing message when ok is False."""
    if size in LAYOUT_BASE and size in OPENAI_SIZE_MAP:
        return True, ""
    if not SIZE_RE.match((size or "").strip()):
        return False, "a size must look like 1200x628 (width x height in pixels)"
    parsed = parse_size(size)
    if parsed is None:
        return False, f"each side must be between {MIN_DIM} and {MAX_DIM} pixels"
    w, h = parsed
    aspect = w / h
    if aspect > _MAX_ASPECT or aspect < 1 / _MAX_ASPECT:
        return False, "the aspect ratio can be at most 10:1"
    # The render must never be WIDER than the target: a wider render gets
    # cover-cropped at the SIDES, slicing edge text (the 1200x960 defect) —
    # while a NARROWER render is outpainted into painted side margins instead.
    # So pick the LARGEST render aspect that still fits under the target; only
    # targets narrower than every choice (skyscrapers etc.) fall back to the
    # nearest aspect and keep the intended center-crop.
    fitting = [g for g in _GEN_CHOICES if g[1] <= aspect * 1.02]
    if fitting:
        gen = max(fitting, key=lambda g: g[1])[0]
    else:
        gen = min(_GEN_CHOICES, key=lambda g: abs(math.log(aspect / g[1])))[0]
    base = min(_BASE_CHOICES, key=lambda b: abs(math.log(aspect / _ratio(b))))
    OPENAI_SIZE_MAP.setdefault(size, gen)
    LAYOUT_BASE.setdefault(size, LAYOUT_BASE[base])
    BUTTON_PLACEMENT.setdefault(size, BUTTON_PLACEMENT[base])
    _prompts.LAYOUT_FAMILY.setdefault(size, _prompts.LAYOUT_FAMILY[base])
    # Extreme ratios behave like the display-ad slots: generated at the nearest
    # aspect, then cover-cropped — keep the focal content centered.
    if aspect >= 2.2 or aspect <= 1 / 2.2:
        DISPLAY_SIZES.add(size)
    return True, ""


def known_sizes():
    """Every size currently generatable (built-ins + registered customs)."""
    return sorted(LAYOUT_BASE.keys())


__all__ = [
    "build_prompt", "build_recomp_prompt", "check_moderation", "validate_manifest",
    "normalize_cta", "BUTTON_COMBOS", "LAYOUT_BASE", "BUTTON_PLACEMENT",
    "generate_png", "GenError", "OPENAI_SIZE_MAP",
    "SUPPORTED_SIZES", "MASTER_SIZE", "MODELS", "DISPLAY_SIZES",
    "ensure_size", "known_sizes", "parse_size",
]
