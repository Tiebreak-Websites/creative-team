"""Generate PWA icon PNGs from the Internovus brand crescent.

One-off dev tool — NOT a runtime dependency. Rasterizes a red radial-gradient
tile (#E71E25 center → #9E181C edge) with a solid WHITE crescent (from
public/icon.svg / fav-logo.svg) painted through it; the crescent's inner "eye"
is left as a hole so the red tile shows through. Supersampled for smooth edges.

Run (needs Pillow + svg.path in the env):
    python scripts/gen-pwa-icons.py
Outputs into public/: icon-192.png, icon-512.png, icon-maskable-512.png
(icon.svg is the supplied vector and is used as-is.)
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw
from svg.path import parse_path

# Brand crescent (native 300x300 viewBox; two subpaths — outer shape + inner hole).
CRESCENT = (
    "M263.849 131.342C252.279 162.655 217.68 221.477 161.176 252.565C161.176 252.565 "
    "111.862 285.89 81.644 238.698C51.5385 191.618 37.2624 135.468 34.5267 118.142C31.7909 "
    "100.816 24.6908 44.0039 76.3643 38.4124C104.785 35.2812 139.721 36.8468 172.634 "
    "44.1157C167.242 48.3652 163.648 54.8513 163.76 62.0083C164.209 76.8816 170.837 85.8279 "
    "186.788 86.3871C202.74 86.9462 212.738 74.8687 212.738 62.0083C212.738 59.9954 212.513 "
    "57.9825 211.951 56.1932C223.859 61.0019 234.867 66.817 244.528 73.6386C244.64 73.5267 "
    "279.801 88.2882 263.849 131.342ZM177.689 96.1162C148.483 90.6366 159.267 121.054 135.901 "
    "156.392C112.76 191.954 86.699 206.827 98.2694 213.649C109.727 220.47 146.573 208.84 "
    "169.826 173.39C193.079 138.052 190.945 98.6883 177.689 96.1162Z"
)
VIEW = 300.0
RX = 66.0                      # rounded-tile corner radius in the 300 space (iOS-style)
INNER = (231, 30, 37)          # #E71E25
OUTER = (158, 24, 28)          # #9E181C
GCX, GCY, GR = 150.0, 70.0, 280.0  # tile gradient center + radius (from the SVG)
GSTOP = 1.0                    # offset where OUTER is reached
SS = 4                         # supersample factor
SAMPLES = 110                  # points sampled per path segment

PUBLIC = Path(__file__).resolve().parent.parent / "public"


def _subpaths(d: str) -> list[str]:
    return [s.strip() for s in d.replace("Z", "Z|").split("|") if s.strip()]


def _poly(d: str, scale: float, cs: float) -> list[tuple[float, float]]:
    """Sample a subpath to points, scaled to the canvas, shrunk by `cs` about center."""
    pts = []
    for seg in parse_path(d):
        for i in range(SAMPLES + 1):
            p = seg.point(i / SAMPLES)
            x = (150 + (p.real - 150) * cs) * scale
            y = (150 + (p.imag - 150) * cs) * scale
            pts.append((x, y))
    return pts


def _gradient(res: int) -> Image.Image:
    """Red radial gradient computed at low res (fast), later upscaled."""
    img = Image.new("RGB", (res, res))
    px = img.load()
    cx, cy, r = GCX / VIEW * res, GCY / VIEW * res, GR / VIEW * res
    for y in range(res):
        for x in range(res):
            t = min(1.0, (math.hypot(x - cx, y - cy) / r) / GSTOP)
            px[x, y] = (
                int(INNER[0] + (OUTER[0] - INNER[0]) * t),
                int(INNER[1] + (OUTER[1] - INNER[1]) * t),
                int(INNER[2] + (OUTER[2] - INNER[2]) * t),
            )
    return img


def render(size: int, maskable: bool = False) -> Image.Image:
    big = size * SS
    scale = big / VIEW
    cs = 0.78 if maskable else 1.0  # shrink for the maskable safe zone

    # Red radial-gradient tile (rounded corners for the normal icon; full-bleed maskable).
    tile = _gradient(256).resize((big, big), Image.LANCZOS).convert("RGBA")
    if not maskable:  # rounded tile for the normal icon; maskable stays full-bleed
        corner = Image.new("L", (big, big), 0)
        ImageDraw.Draw(corner).rounded_rectangle(
            [0, 0, big - 1, big - 1], radius=int(RX / VIEW * big), fill=255
        )
        tile.putalpha(corner)

    # Solid white crescent painted through the mask; inner "eye" left as a hole.
    white = Image.new("RGBA", (big, big), (255, 255, 255, 255))

    sub = _subpaths(CRESCENT)
    mask = Image.new("L", (big, big), 0)
    d = ImageDraw.Draw(mask)
    d.polygon(_poly(sub[0], scale, cs), fill=255)
    if len(sub) > 1:  # cut the inner "eye" so the red tile shows through
        d.polygon(_poly(sub[1], scale, cs), fill=0)

    tile.paste(white, (0, 0), mask)
    return tile.resize((size, size), Image.LANCZOS)


def main() -> None:
    render(192).save(PUBLIC / "icon-192.png")
    render(512).save(PUBLIC / "icon-512.png")
    render(512, maskable=True).save(PUBLIC / "icon-maskable-512.png")
    print("wrote icon-192.png, icon-512.png, icon-maskable-512.png to", PUBLIC)


if __name__ == "__main__":
    main()
