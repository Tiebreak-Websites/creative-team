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


def needs_outpaint(png_bytes: bytes, width: int, height: int) -> bool:
    """True when a cover-crop would slice the image VERTICALLY — the target is
    relatively "wider" than the generated source, so the top/bottom (headline,
    faces, the CTA button) would be cut. Covers the 4:5 portrait family AND
    moderate landscape slots (1200x628, 1920x1080 from a 3:2 render). These
    targets deserve a REAL background extension (outpaint.outpaint_export);
    the side blur-pad here is the fallback. Extreme display slots (728x90 …,
    aspect ≥ 2.2) keep the cover-crop — their prompts are written for it and
    outpainting ~80% of a canvas reads worse than a crop."""
    sw, sh = Image.open(io.BytesIO(png_bytes)).size
    ar = width / height
    return ar > (sw / sh) + 0.02 and ar < 2.2


def fit_export(png_bytes: bytes, width: int, height: int) -> bytes:
    """Reshape to exact width x height, choosing cover-crop vs blur-pad per target.

    A target whose cover-crop would slice the top+bottom (the target is "wider"
    than the generated source aspect — 4:5 portrait AND moderate landscape like
    1200x628) keeps its FULL height via blur-pad — so faces, the headline and
    the bottom CTA are never cropped. Everything else (and extreme display
    slots) uses the exact cover-crop.
    """
    src = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    if needs_outpaint(png_bytes, width, height):
        return _encode(_blur_pad(src, width, height))
    return _encode(_cover(src, width, height))


def fit_cover(png_bytes: bytes, width: int, height: int) -> bytes:
    """Scale to *cover* width x height, center-crop, return PNG bytes at exact px.

    Kept for callers/tests that want the plain cover-crop; `fit_export` is the
    smart dispatcher the runner uses for finished banners.
    """
    return _encode(_cover(Image.open(io.BytesIO(png_bytes)).convert("RGB"), width, height))
