"""Outpaint the side margins for targets a cover-crop would slice vertically.

The OpenAI image API only renders 1024x1024 / 1536x1024 / 1024x1536, so any
export whose aspect is "wider" than its render — the 4:5 portrait family
(960x1200, 1080x1350, 1200x1500) from a 2:3 render, and moderate landscape
slots (1200x628, 1920x1080) from a 3:2 render — must be widened to the target
box. Blur-padding the sides reads as "unfinished background"; cover-cropping
slices heads and the CTA button off the top/bottom. This module does it
properly with one masked /images/edits call:

  1. Lay the full render (contained, nothing cropped) on a canvas of the
     source's own OpenAI size, leftover area pre-filled with a blurred
     EDGE-STRETCH of the render's own border pixels — a pure color/lighting
     hint with no structures in it. (It must NOT be a blurred cover copy of
     the whole render: that puts the same background at a different scale and
     offset right beside the sharp original, and the model sharpens that
     misplaced duplicate instead of continuing the real edge — the "same
     background but misplaced" seam users saw on 960x1200 / 1200x1500.)
  2. Mask everything EXCEPT the render as editable — MINUS an overlap band a
     few dozen px into the render, so the model repaints across the boundary
     and can blend structure through it — and ask the model to extend the
     background seamlessly (no text, no logos, no new objects).
  3. Pixel-composite the ORIGINAL render back over the center with a wide
     feather that lands inside that repainted overlap band — the banner
     itself is guaranteed untouched, and the hand-off is gradual.
  4. Crop the target-aspect window and resize to the exact export pixels.

Callers treat this as best-effort: any failure falls back to reshape's
edge-pad (same fill construction, no API) and surfaces a QA note.
"""
from __future__ import annotations

import io
import tempfile
from pathlib import Path

from PIL import Image, ImageFilter

from . import engine_core, reshape


def _canvas_for(sw: int, sh: int) -> tuple:
    """The edits canvas matching the source's orientation (must be one of the
    three sizes the /images/edits endpoint can output)."""
    if sw > sh:
        return 1536, 1024
    if sh > sw:
        return 1024, 1536
    return 1024, 1024

# Seam construction. The mask lets the model repaint _MASK_OVERLAP px INTO the
# render (an overlap band it can blend structure through); the feathered
# composite then restores the original pixels over everything except that band,
# where the hand-off blends gradually. Inset ≈ overlap so the blend zone and the
# repainted zone coincide. The old values (inset 6 / radius 3, no overlap) gave
# a sub-1% transition on a 1024px canvas — a visible cut line.
_MASK_OVERLAP = 24
_FEATHER_INSET = 24
_FEATHER_RADIUS = 10

OUTPAINT_PROMPT = (
    "Extend this finished advertising banner sideways to fill the whole canvas. "
    "The sharp central area is FINAL artwork - do not repaint, restyle, recolor "
    "or add anything on top of it. The blurred margins are PLACEHOLDER ONLY - a "
    "smeared color hint, not real content: repaint 100% of them from scratch. "
    "Do NOT keep or sharpen the smeared placeholder texture. Continue the scene "
    "outward strictly from the pixels at the sharp area's edge, at the exact "
    "same scale, position and perspective: every line, edge, chart, screen or "
    "object that touches the boundary must cross it perfectly straight, with no "
    "kink, offset, brightness step or change in size. Do NOT repeat or duplicate "
    "elements already visible in the sharp area (no second copy of the same "
    "chart, monitor row, window, panel or light row). Match lighting, colors, "
    "materials, film grain and depth of field exactly; the margins must be as "
    "sharp as the artwork beside them, as if the photo had simply been shot "
    "wider. Do NOT add any text, letters, numbers, logos, watermarks, buttons, "
    "people or new standalone objects - pure background continuation only."
)


def _geometry(sw: int, sh: int, width: int, height: int):
    """Boxes on the edits canvas: the target-aspect crop window and the
    contained render inside it. Returns (canvas, region, fg) where canvas is
    (cw, ch) and the boxes are (x, y, w, h)."""
    cw, ch = _canvas_for(sw, sh)
    ar = width / height
    rw, rh = cw, min(ch, round(cw / ar))
    if rh == ch:
        rw = round(ch * ar)
    rx, ry = (cw - rw) // 2, (ch - rh) // 2
    scale = min(rw / sw, rh / sh)
    fw, fh = max(1, round(sw * scale)), max(1, round(sh * scale))
    fx, fy = rx + (rw - fw) // 2, ry + (rh - fh) // 2
    return (cw, ch), (rx, ry, rw, rh), (fx, fy, fw, fh)


def outpaint_export(*, api_key: str, png_bytes: bytes, width: int, height: int,
                    model: str = "gpt-image-2", quality: str = "high",
                    timeout: int = 180, max_retries: int = 2,
                    on_attempt=None) -> bytes:
    """Widen a portrait render to width x height with painted (not blurred)
    margins. Raises on any failure — the caller owns the blur-pad fallback."""
    src = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    sw, sh = src.size
    (cw, ch), (rx, ry, rw, rh), (fx, fy, fw, fh) = _geometry(sw, sh, width, height)
    if fw >= rw - 8:  # margins under ~4px a side — nothing worth painting
        raise ValueError("target aspect leaves no margin to outpaint")

    fg = src.resize((fw, fh), Image.LANCZOS)

    # Base: blurred edge-stretch of the render's own borders as a color hint
    # (structure-free — see module docstring), with the real render on top.
    base = reshape._edge_fill(fg, cw, ch, fx, fy)
    base.paste(fg, (fx, fy))

    # Mask: transparent = editable (OpenAI convention). Protect the render MINUS
    # an overlap band, so the model repaints across the boundary and the feather
    # composite below hands off inside repainted territory.
    ov = min(_MASK_OVERLAP, (fw - 2) // 2, (fh - 2) // 2)
    mask = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    protect = Image.new("RGBA", (max(1, fw - 2 * ov), max(1, fh - 2 * ov)),
                        (255, 255, 255, 255))
    mask.paste(protect, (fx + ov, fy + ov))

    with tempfile.TemporaryDirectory(prefix="outpaint-") as td:
        base_path = Path(td) / "base.png"
        mask_path = Path(td) / "mask.png"
        base.save(base_path, format="PNG")
        mask.save(mask_path, format="PNG")
        out_bytes = engine_core.generate_png(
            api_key=api_key, prompt=OUTPAINT_PROMPT, mode="edit",
            openai_size=f"{cw}x{ch}", model=model, quality=quality,
            master_png_path=str(base_path), mask_png_path=str(mask_path),
            timeout=timeout, max_retries=max_retries, on_attempt=on_attempt,
        )

    out = Image.open(io.BytesIO(out_bytes)).convert("RGB")
    if out.size != (cw, ch):
        out = out.resize((cw, ch), Image.LANCZOS)

    # Guarantee the banner itself: composite the ORIGINAL pixels back over the
    # center, feathered at the edges so the painted margins blend in.
    fg_full = Image.new("RGB", (cw, ch))
    fg_full.paste(fg, (fx, fy))
    feather = Image.new("L", (cw, ch), 0)
    inner = Image.new(
        "L", (max(1, fw - 2 * _FEATHER_INSET), max(1, fh - 2 * _FEATHER_INSET)), 255)
    feather.paste(inner, (fx + _FEATHER_INSET, fy + _FEATHER_INSET))
    feather = feather.filter(ImageFilter.GaussianBlur(_FEATHER_RADIUS))
    out = Image.composite(fg_full, out, feather)

    final = out.crop((rx, ry, rx + rw, ry + rh)).resize((width, height), Image.LANCZOS)
    final = reshape.sharpen_if_upscaled(final, width / rw)
    buf = io.BytesIO()
    final.save(buf, format="PNG")
    return buf.getvalue()
