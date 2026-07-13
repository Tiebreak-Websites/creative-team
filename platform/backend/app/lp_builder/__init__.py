"""LP Builder — section-based drag-and-drop landing-page builder.

See docs/prompt-v1.54-lp-builder.md for the product spec. Public surface:
build_lp_builder_router() (mounted at /api/tools/lp-builder) and rehydrate()
(startup: seed built-in sections + restore disk state).
"""
from .core import rehydrate
from .router import build_lp_builder_router

__all__ = ["build_lp_builder_router", "rehydrate"]
