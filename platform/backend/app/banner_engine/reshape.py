"""Reshape a generated PNG to an EXACT pixel size (display-ad export).

The OpenAI image API only emits 1024x1024 / 1536x1024 / 1024x1536. Export slots
(960x1200, 1080x1350, 300x250, 728x90, …) are arbitrary, often extreme, ratios.

Two strategies, chosen per target by `fit_export`:

  * COVER-CROP (the default): scale to cover the box, center-crop to exact pixels.
    Used for squares (no crop), wide/landscape, and tall 9:16 (which only crops the
    sides — the bottom CTA stays safe).

  * EDGE-PAD (4:5 portrait family — 960x1200, 1080x1350, 1440x1800, …): a cover-crop
    of those would slice the top+bottom, cutting the headline or the bottom CTA (the
    #1 recompose defect). Instead fit the WHOLE image inside the box (nothing
    cropped) and fill the leftover SIDE margins by continuing the image's own border
    pixels outward (edge-stretch, blurred), blended with a feathered seam — so the
    full vertical composition always survives. The old fill here was a blurred
    ZOOMED COPY of the whole image: the same background at a different scale/offset
    right next to the sharp original, which read as a duplicated, misplaced scene
    behind a hard cut (the seam users reported on 960x1200 / 1200x1500 exports).
"""
from __future__ import annotations

import io

from PIL import Image, ImageFilter


def sharpen_if_upscaled(img: "Image.Image", scale: float) -> "Image.Image":
    """Counter LANCZOS softness on upscaled exports (1440x1800, 1920x1080, … are
    blown up from 1024-class renders) with a moderate unsharp mask. No-op for
    downscales/near-1:1 — sharpening those adds halos for no benefit."""
    if scale <= 1.02:
        return img
    return img.filter(ImageFilter.UnsharpMask(radius=2, percent=110, threshold=2))


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
    return sharpen_if_upscaled(resized.crop((left, top, left + width, top + height)), scale)


def _edge_fill(fg: "Image.Image", width: int, height: int,
               fx: int, fy: int) -> "Image.Image":
    """Margin fill that continues `fg`'s own border pixels outward (edge-stretch),
    heavily blurred, for a canvas of width x height with `fg` placed at (fx, fy).

    Every margin row/column matches the adjacent real pixels in color and
    lighting, and — unlike a blurred cover copy of the whole image — contains NO
    structures at the wrong scale/offset for an inpainting model to latch onto
    (the cause of the "same background but misplaced" seam on extended exports).

    NOTE: the returned canvas is blurred EVERYWHERE, including under `fg` —
    callers paste/composite the sharp `fg` back on top.
    """
    fw, fh = fg.size
    canvas = Image.new("RGB", (width, height))
    canvas.paste(fg, (fx, fy))
    s = 16  # border strip sampled for the stretch
    lw, rw = fx, width - fx - fw
    if lw > 0:
        canvas.paste(fg.crop((0, 0, min(s, fw), fh)).resize((lw, fh), Image.LANCZOS), (0, fy))
    if rw > 0:
        canvas.paste(fg.crop((max(0, fw - s), 0, fw, fh)).resize((rw, fh), Image.LANCZOS),
                     (fx + fw, fy))
    th, bh = fy, height - fy - fh
    # Top/bottom bands stretch the already-filled row at the seam, so the corners
    # continue the side fills instead of going black.
    if th > 0:
        canvas.paste(canvas.crop((0, fy, width, fy + min(s, fh))).resize((width, th), Image.LANCZOS),
                     (0, 0))
    if bh > 0:
        canvas.paste(canvas.crop((0, fy + fh - min(s, fh), width, fy + fh)).resize((width, bh), Image.LANCZOS),
                     (0, fy + fh))
    return canvas.filter(ImageFilter.GaussianBlur(radius=max(8, min(width, height) // 64)))


def _blur_pad(src: "Image.Image", width: int, height: int) -> "Image.Image":
    """Contain the whole image (no crop) over an edge-stretch fill of its own
    borders, blended in with a feathered seam (no hard paste line). This is the
    no-API fallback look when a real outpaint isn't available."""
    sw, sh = src.size
    scale = min(width / sw, height / sh)
    fw, fh = max(1, round(sw * scale)), max(1, round(sh * scale))
    fg = sharpen_if_upscaled(src.resize((fw, fh), Image.LANCZOS), scale)
    px, py = (width - fw) // 2, (height - fh) // 2
    bg = _edge_fill(fg, width, height, px, py)
    fg_full = Image.new("RGB", (width, height))
    fg_full.paste(fg, (px, py))
    inset = max(2, min(fw, fh) // 50)
    feather = Image.new("L", (width, height), 0)
    inner = Image.new("L", (max(1, fw - 2 * inset), max(1, fh - 2 * inset)), 255)
    feather.paste(inner, (px + inset, py + inset))
    feather = feather.filter(ImageFilter.GaussianBlur(max(2, inset // 2)))
    return Image.composite(fg_full, bg, feather)


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
    the side edge-pad here is the fallback. Extreme display slots (728x90 …,
    aspect ≥ 2.2) keep the cover-crop — their prompts are written for it and
    outpainting ~80% of a canvas reads worse than a crop. Micro slots (at or
    under ~200x120 px) also keep the cover-crop: their prompts collapse to a
    centered single line (see prompts._is_micro), the crop loss is background
    only, and a full extra edits call for a 100px banner is waste."""
    if width <= 200 or height <= 120:
        return False
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
