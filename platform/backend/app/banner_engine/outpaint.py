"""Outpaint the side margins for targets a cover-crop would slice vertically.

The OpenAI image API only renders 1024x1024 / 1536x1024 / 1024x1536, so any
export whose aspect is "wider" than its render — the 4:5 portrait family
(960x1200, 1080x1350, 1200x1500) from a 2:3 render, and moderate landscape
slots (1200x628, 1920x1080) from a 3:2 render — must be widened to the target
box. Blur-padding the sides reads as "unfinished background"; cover-cropping
slices heads and the CTA button off the top/bottom. This module does it
properly with one masked /images/edits call:

  1. Lay the full render (contained, nothing cropped) on a canvas of the
     source's own OpenAI size, leftover area pre-filled with the old blur —
     a color/scene hint the model paints over.
  2. Mask everything EXCEPT the render as editable and ask the model to
     extend the background seamlessly (no text, no logos, no new objects).
  3. Pixel-composite the ORIGINAL render back over the center (feathered a
     few px so the hand-off to the painted margins stays seamless) — the
     banner itself is guaranteed untouched.
  4. Crop the target-aspect window and resize to the exact export pixels.

Callers treat this as best-effort: any failure falls back to the blur-pad.
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

# How far the protected center is inset / feathered when compositing the
# original pixels back, so the seam to the painted margins blends over ~6px.
_FEATHER_INSET = 6
_FEATHER_RADIUS = 3

OUTPAINT_PROMPT = (
    "Extend this finished advertising banner to fill the whole canvas. "
    "The sharp central area is FINAL artwork - do not repaint, restyle, "
    "recolor or add anything on top of it. Fill ONLY the blurred margins by "
    "continuing the banner's background scene seamlessly: same lighting, "
    "colors, materials, perspective and depth of field, as if the photo had "
    "simply been shot wider. Do NOT add any text, letters, numbers, logos, "
    "watermarks, buttons, people or new standalone objects in the margins - "
    "pure background continuation only."
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

    # Base: the old blur fill as a scene hint, with the real render on top.
    base = reshape._cover(src, cw, ch).filter(
        ImageFilter.GaussianBlur(radius=max(8, cw // 22)))
    base.paste(fg, (fx, fy))

    # Mask: transparent = editable (OpenAI convention). Protect the render.
    mask = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    protect = Image.new("RGBA", (fw - 4, fh - 4), (255, 255, 255, 255))
    mask.paste(protect, (fx + 2, fy + 2))

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
    buf = io.BytesIO()
    final.save(buf, format="PNG")
    return buf.getvalue()
