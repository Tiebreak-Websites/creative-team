"""Generate PWA icon PNGs from the Tiebreak brand crescent.

One-off dev tool — NOT a runtime dependency. Rasterizes the two crescent paths
(from public/logo.svg) onto a near-black tile, supersampled for smooth edges.

Run (needs Pillow + svg.path in the env):
    python scripts/gen-pwa-icons.py
Outputs into public/: icon-192.png, icon-512.png, icon-maskable-512.png
(icon.svg is hand-authored and committed separately.)
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw
from svg.path import parse_path

# Brand crescent paths (native viewBox 0..145.844 x 0..166.471), two-tone mint.
VIEW_W, VIEW_H = 145.844, 166.471
PATHS = [
    ("#63ECAE",
     "M99.2694 154.11C105.543 154.11 111.594 153.155 117.288 151.38C105 160.844 89.6126 166.471 72.9201 166.471C32.6485 166.471 0 133.737 0 93.3629V0C18.144 0 33.3667 12.5243 37.5415 29.4224C48.0188 23.5817 60.0852 20.2559 72.9201 20.2559C89.6126 20.2559 105 25.878 117.288 35.3423C111.596 33.5692 105.543 32.612 99.2694 32.612C65.8021 32.612 38.6741 59.8122 38.6741 93.3612C38.6741 126.91 65.8004 154.11 99.2694 154.11Z"),
    ("#3ED08E",
     "M145.844 93.5385V93.7269C145.844 94.0903 145.839 94.4503 145.83 94.8103C145.825 94.9247 145.822 95.034 145.822 95.1433C145.005 121.529 123.414 142.66 96.907 142.66C83.5402 142.66 71.4201 137.289 62.5889 128.571C64.8508 129.027 67.1899 129.259 69.5827 129.259C89.3627 129.259 105.398 113.184 105.398 93.3534C105.398 73.5231 89.3627 57.4476 69.5827 57.4476C67.408 57.4476 65.2787 57.6411 63.2097 58.0179C71.9839 49.6639 83.8506 44.5381 96.907 44.5381C123.907 44.5381 145.808 66.4678 145.844 93.5368V93.5385Z"),
]
BG = "#171717"          # matches index.html theme-color / dark app shell
SS = 4                  # supersample factor → downsample with LANCZOS
SAMPLES = 96            # points sampled per path segment

PUBLIC = Path(__file__).resolve().parent.parent / "public"


def _polygon(d: str, scale: float, ox: float, oy: float) -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    for seg in parse_path(d):
        for i in range(SAMPLES + 1):
            p = seg.point(i / SAMPLES)
            pts.append((ox + p.real * scale, oy + p.imag * scale))
    return pts


def render(px: int, content_frac: float) -> Image.Image:
    """Dark tile with the crescent occupying `content_frac` of the height."""
    big = px * SS
    img = Image.new("RGBA", (big, big), BG)
    draw = ImageDraw.Draw(img)
    scale = (content_frac * big) / VIEW_H
    ox = (big - VIEW_W * scale) / 2
    oy = (big - VIEW_H * scale) / 2
    for color, d in PATHS:
        draw.polygon(_polygon(d, scale, ox, oy), fill=color)
    return img.resize((px, px), Image.LANCZOS)


def main() -> None:
    # Normal icons: crescent ~62% tall. Maskable: ~50% so it survives the safe-zone crop.
    render(192, 0.62).save(PUBLIC / "icon-192.png")
    render(512, 0.62).save(PUBLIC / "icon-512.png")
    render(512, 0.50).save(PUBLIC / "icon-maskable-512.png")
    print("wrote icon-192.png, icon-512.png, icon-maskable-512.png to", PUBLIC)


if __name__ == "__main__":
    main()
