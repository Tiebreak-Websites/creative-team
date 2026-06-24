"""Composite a brand logo onto a finished banner PNG (Pillow).

The base image is python:3.12-slim with NO SVG rasterizer (cairosvg / svglib are
unavailable and pull heavy native deps). So this module reliably composites
RASTER logos only:

  - a base64 data: URI ("data:image/png;base64,...", jpg/webp too), or
  - raw PNG/JPEG/WebP bytes.

For an SVG logo we DO NOT attempt to rasterize (it would need a native lib we
can't assume): `decode_logo` returns ("svg", None) and the caller skips the pixel
overlay — generation still succeeds — and the brand colors are still folded into
the art direction upstream. See the TODO below if an SVG rasterizer is ever added.

`composite_logo_corner` returns NEW PNG bytes with the logo placed in one of the
four corners ('tl','tr','bl','br') with padding + scaling proportional to the
banner, so it reads sensibly across square / wide / tall exports.
"""
from __future__ import annotations

import base64
import io
import re
from typing import Optional, Tuple

from PIL import Image

# Logo box as a fraction of the banner's shorter side, with sane px clamps so it
# never disappears on a tiny display ad nor dominates a large hero.
_LOGO_FRACTION = 0.18
_LOGO_MIN_PX = 32
_LOGO_MAX_PX = 320
# Padding from the edges, as a fraction of the shorter side (min 8px).
_PAD_FRACTION = 0.04
_PAD_MIN_PX = 8

_CORNERS = {"tl", "tr", "bl", "br"}

_DATA_URI_RE = re.compile(r"^data:(?P<mime>[^;,]+)?(?P<b64>;base64)?,(?P<data>.*)$", re.DOTALL)


def _looks_like_svg(s: str) -> bool:
    head = s.lstrip()[:256].lower()
    return head.startswith("<svg") or head.startswith("<?xml") or "<svg" in head


def decode_logo(logo_svg: Optional[str]) -> Tuple[str, Optional[bytes]]:
    """Classify a brand logo string and return (kind, raster_bytes).

    kind is one of:
      "raster" -> raster_bytes is decoded PNG/JPEG/WebP bytes ready to open.
      "svg"    -> raster_bytes is None; caller must skip the pixel overlay
                  (no rasterizer installed). TODO: if cairosvg/resvg is ever
                  added to the image, rasterize here and return ("raster", png).
      "none"   -> nothing usable.
    """
    if not logo_svg or not isinstance(logo_svg, str):
        return "none", None
    s = logo_svg.strip()
    if not s:
        return "none", None

    m = _DATA_URI_RE.match(s)
    if m:
        mime = (m.group("mime") or "").lower()
        is_b64 = bool(m.group("b64"))
        data = m.group("data") or ""
        if "svg" in mime:
            return "svg", None
        if is_b64:
            try:
                return "raster", base64.b64decode(data, validate=False)
            except (ValueError, base64.binascii.Error):
                return "none", None
        # Non-base64 data: URI (rare) — likely URL-encoded SVG markup.
        return ("svg", None) if "<svg" in data.lower() else ("none", None)

    if _looks_like_svg(s):
        return "svg", None

    # A bare base64 blob (no data: prefix) — accept if it decodes to a known
    # raster magic header; otherwise treat as unusable.
    try:
        raw = base64.b64decode(s, validate=True)
    except (ValueError, base64.binascii.Error):
        return "none", None
    if raw[:8] == b"\x89PNG\r\n\x1a\n" or raw[:3] == b"\xff\xd8\xff" or (
        raw[:4] == b"RIFF" and raw[8:12] == b"WEBP"):
        return "raster", raw
    return "none", None


def composite_logo_corner(banner_png: bytes, logo_raster: bytes, corner: str) -> bytes:
    """Place `logo_raster` in `corner` of `banner_png`; return new PNG bytes.

    Preserves the logo's aspect ratio and alpha; scales it to ~_LOGO_FRACTION of
    the banner's shorter side (clamped); insets it by _PAD_FRACTION. Raises on
    undecodable input so the caller can decide to keep the un-overlaid banner.
    """
    if corner not in _CORNERS:
        corner = "br"
    base = Image.open(io.BytesIO(banner_png)).convert("RGBA")
    logo = Image.open(io.BytesIO(logo_raster)).convert("RGBA")

    bw, bh = base.size
    short = min(bw, bh)
    target = int(max(_LOGO_MIN_PX, min(_LOGO_MAX_PX, round(short * _LOGO_FRACTION))))
    # Fit the logo within a target x target box, keeping aspect ratio.
    lw, lh = logo.size
    if lw <= 0 or lh <= 0:
        raise ValueError("logo has zero dimension")
    scale = min(target / lw, target / lh)
    nw, nh = max(1, round(lw * scale)), max(1, round(lh * scale))
    logo = logo.resize((nw, nh), Image.LANCZOS)

    pad = int(max(_PAD_MIN_PX, round(short * _PAD_FRACTION)))
    if corner == "tl":
        x, y = pad, pad
    elif corner == "tr":
        x, y = bw - nw - pad, pad
    elif corner == "bl":
        x, y = pad, bh - nh - pad
    else:  # "br"
        x, y = bw - nw - pad, bh - nh - pad
    x = max(0, min(x, bw - nw))
    y = max(0, min(y, bh - nh))

    base.alpha_composite(logo, (x, y))
    out = io.BytesIO()
    base.convert("RGB").save(out, format="PNG")
    return out.getvalue()


__all__ = ["decode_logo", "composite_logo_corner"]
