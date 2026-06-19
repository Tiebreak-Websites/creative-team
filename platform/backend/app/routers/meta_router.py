"""GET /api/meta — engine-derived constants so the frontend never hardcodes them."""
from fastapi import APIRouter

from .. import engine

router = APIRouter(prefix="/api", tags=["meta"])


@router.get("/meta")
def meta():
    return {
        "button_combos": [{"bg": bg, "text": text} for bg, text in engine.BUTTON_COMBOS],
        "sizes": engine.SUPPORTED_SIZES,
        "master_size": engine.MASTER_SIZE,
        "models": engine.MODELS,
        "qualities": ["low", "medium"],
    }
