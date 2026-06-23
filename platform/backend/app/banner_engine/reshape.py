"""Reshape a generated PNG to an EXACT pixel size (display-ad export).

The OpenAI image API only emits 1024x1024 / 1536x1024 / 1024x1536. Display-ad
slots (300x250, 728x90, 160x600, …) are arbitrary, often extreme, ratios. We
generate at the nearest supported aspect and then **cover-crop** to the exact
pixel box here (center-weighted) so the export lands at precise dimensions.

This is the 'crop fallback': true AI outpaint to extreme ratios isn't something
the image API supports (it has no arbitrary-canvas output), so for shapes far
from the generated aspect we keep the most central band.
"""
from __future__ import annotations

import io

from PIL import Image


def fit_cover(png_bytes: bytes, width: int, height: int) -> bytes:
    """Scale to *cover* width x height, center-crop, return PNG bytes at exact px."""
    src = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    sw, sh = src.size
    if (sw, sh) == (width, height):
        out = src
    else:
        scale = max(width / sw, height / sh)
        nw, nh = max(1, round(sw * scale)), max(1, round(sh * scale))
        resized = src.resize((nw, nh), Image.LANCZOS)
        left = (nw - width) // 2
        top = (nh - height) // 2
        out = resized.crop((left, top, left + width, top + height))
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()
