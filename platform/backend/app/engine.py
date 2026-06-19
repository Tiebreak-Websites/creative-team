"""Adapter exposing the banner engine to the backend.

The engine now lives inside this package at app/banner_engine/ (prompts.py +
engine_core.py) and is imported directly — no sys.path juggling, no copies.
"""
from .banner_engine.prompts import (  # noqa: F401
    build_prompt,
    build_recomp_prompt,
    check_moderation,
    validate_manifest,
    normalize_cta,
    BUTTON_COMBOS,
    LAYOUT_BASE,
    BUTTON_PLACEMENT,
)
from .banner_engine.engine_core import (  # noqa: F401
    generate_png,
    GenError,
    OPENAI_SIZE_MAP,
)

# Convenience constants for the backend + the /api/meta endpoint.
SUPPORTED_SIZES = sorted(LAYOUT_BASE.keys())
MASTER_SIZE = "1200x1200"
MODELS = ["gpt-image-2", "gpt-image-1-mini"]

__all__ = [
    "build_prompt", "build_recomp_prompt", "check_moderation", "validate_manifest",
    "normalize_cta", "BUTTON_COMBOS", "LAYOUT_BASE", "BUTTON_PLACEMENT",
    "generate_png", "GenError", "OPENAI_SIZE_MAP",
    "SUPPORTED_SIZES", "MASTER_SIZE", "MODELS",
]
