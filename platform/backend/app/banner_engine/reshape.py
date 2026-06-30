"""Reshape a generated PNG to an EXACT pixel size (display-ad export).

The OpenAI image API only emits 1024x1024 / 1536x1024 / 1024x1536. Export slots
(960x1200, 1080x1350, 300x250, 728x90, …) are arbitrary, often extreme, ratios.

Two strategies, chosen per target by `fit_export`:

  * COVER-CROP (the default): scale to cover the box, center-crop to exact pixels.
    Used for squares (no crop), wide/landscape, and tall 9:16 (which only crops the
    sides — the bottom CTA stays safe).

  * BLUR-PAD (4:5 portrait family — 960x1200, 1080x1350, 1440x1800, …): a cover-crop
    of those would slice the top+bottom, cutting the headline or the bottom CTA (the
    #1 recompose defect). Instead fit the WHOLE image inside the box (nothing
    cropped) and fill the leftover SIDE margins with a blurred, zoomed copy of the
    same image — so the full vertical composition (headline at top, CTA at bottom)
    always survives and the fill reads as an intentional premium backdrop, not bars.
"""
from __future__ import annotations

import io

from PIL import Image, ImageFilter


def _cover(src: "Image.Image", width: int, height: int) -> "Image.Image":
    """Scale to *cover* width x height and center-crop to exact pixels."""
    sw, sh = src.size
    if (sw, sh) == (width, height):
        return src
    scale = max(width / sw, height / sh)
    nw, nh = max(1, round(sw * scale)), max(1, round(sh * scale))
    resized = src.resize((nw, nh), Image.LANCZOS)
    left = (nw - width) // 2
    top = (nh - height) // 2
    return resized.crop((left, top, left + width, top + height))


def _blur_pad(src: "Image.Image", width: int, height: int) -> "Image.Image":
    """Contain the whole image (no crop) over a blurred, zoomed fill of itself."""
    sw, sh = src.size
    bg = _cover(src, width, height).filter(ImageFilter.GaussianBlur(radius=max(8, width // 22)))
    scale = min(width / sw, height / sh)
    fw, fh = max(1, round(sw * scale)), max(1, round(sh * scale))
    fg = src.resize((fw, fh), Image.LANCZOS)
    canvas = bg.copy()
    canvas.paste(fg, ((width - fw) // 2, (height - fh) // 2))
    return canvas


def _encode(img: "Image.Image") -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def fit_export(png_bytes: bytes, width: int, height: int) -> bytes:
    """Reshape to exact width x height, choosing cover-crop vs blur-pad per target.

    A PORTRAIT target whose cover-crop would slice the top+bottom (the target is
    "wider" than the generated source aspect) keeps its FULL height via blur-pad —
    so the headline and the bottom CTA are never cropped. Everything else uses the
    exact cover-crop.
    """
    src = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    sw, sh = src.size
    would_vertical_crop = (width / height) > (sw / sh) + 0.02
    if height > width and would_vertical_crop:
        return _encode(_blur_pad(src, width, height))
    return _encode(_cover(src, width, height))


def fit_cover(png_bytes: bytes, width: int, height: int) -> bytes:
    """Scale to *cover* width x height, center-crop, return PNG bytes at exact px.

    Kept for callers/tests that want the plain cover-crop; `fit_export` is the
    smart dispatcher the runner uses for finished banners.
    """
    return _encode(_cover(Image.open(io.BytesIO(png_bytes)).convert("RGB"), width, height))
