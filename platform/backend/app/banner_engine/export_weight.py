"""Ad-network file-weight compliance for display-slot exports.

Classic display banner slots (300x250, 728x90, 320x50, 1200x300, 512x128, …)
are rejected by Google/display networks above 150 KB — but the engine exports
lossless PNG, which for photographic banners lands at 500 KB-2 MB. Until now
someone re-compressed those by hand before trafficking.

For any export in a capped slot whose PNG is over the cap, `web_variant`
produces a compliant companion ("web") file next to the master PNG:

  1. palette PNG (256-color, optimized) — flat/graphic banners compress 3-5x
     with razor-sharp text, so try it first;
  2. else a progressive JPEG walked down a quality ladder until it fits.

The master PNG stays untouched (social networks are fine with it and it is the
archival original); the web file is a sidecar the UI offers for download. If
even JPEG q50 cannot fit (virtually never at these pixel sizes), the smallest
attempt is kept and a warning is surfaced via the frame's QA note.

Responsive-display / social sizes (1200x628, 1080x1080, …) are NOT capped —
their platform limits are in the megabytes, so the PNG ships as-is.
"""
from __future__ import annotations

import io
from typing import Optional

from PIL import Image

from .prompts import DISPLAY_SIZES

# Classic uploaded-display-creative limit (Google Ads image ads & most display
# SSPs). Kept a hair under the true 150 KB so metadata never tips it over.
CAP_BYTES = 148 * 1024

_JPEG_LADDER = (85, 80, 75, 70, 65, 60, 55, 50)


def is_capped_slot(size: str) -> bool:
    """True for sizes that display networks cap at ~150 KB: the registered
    display slots (incl. custom aspect-≥2.2 strips, which engine.ensure_size
    adds to DISPLAY_SIZES) plus anything at or under leaderboard scale."""
    if size in DISPLAY_SIZES:
        return True
    try:
        w, h = (int(x) for x in size.lower().split("x"))
    except Exception:  # noqa: BLE001
        return False
    # Tiny slots are display inventory even when their aspect is moderate.
    return w * h <= 400 * 400


def web_variant(png_bytes: bytes, size: str) -> tuple[Optional[bytes], Optional[str], Optional[str]]:
    """Return (variant_bytes, extension, warning) for a capped slot over the cap.

    (None, None, None) when no variant is needed — not a capped slot, or the
    PNG already fits. `warning` is set only when even the smallest JPEG is
    over the cap (surface it in QA; never happens at sane pixel sizes).
    """
    if not is_capped_slot(size) or len(png_bytes) <= CAP_BYTES:
        return None, None, None

    img = Image.open(io.BytesIO(png_bytes)).convert("RGB")

    # 1) 256-color palette PNG — ideal for flat, graphic, text-heavy banners.
    buf = io.BytesIO()
    img.quantize(colors=256, method=Image.Quantize.MEDIANCUT).save(
        buf, format="PNG", optimize=True)
    if buf.tell() <= CAP_BYTES:
        return buf.getvalue(), "png", None

    # 2) Progressive JPEG, walked down until it fits.
    smallest = None
    for q in _JPEG_LADDER:
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=q, optimize=True, progressive=True)
        data = buf.getvalue()
        if smallest is None or len(data) < len(smallest):
            smallest = data
        if len(data) <= CAP_BYTES:
            return data, "jpg", None

    return smallest, "jpg", (
        f"web variant still {len(smallest) // 1024} KB at JPEG q{_JPEG_LADDER[-1]} "
        f"(cap {CAP_BYTES // 1024} KB) — check the slot before trafficking"
    )
