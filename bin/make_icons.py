#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "Pillow>=11.3.0",
# ]
# ///

from __future__ import annotations
import math
from pathlib import Path
from typing import Tuple

from PIL import Image, ImageDraw


BRAND_PRIMARY = "#7c3aed"  # --brand from styles.css
BRAND_DARK = "#0b1220"     # --bg from styles.css


def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def draw_rounded_rect(draw: ImageDraw.ImageDraw, xy: Tuple[int, int, int, int], radius: int, fill: str) -> None:
    draw.rounded_rectangle(xy, radius=radius, fill=fill)


def make_base_icon(size: int = 1024) -> Image.Image:
    """Ring icon: dark rounded-square background with a thick brand arc and a notch at top-right."""
    scale = size / 1024.0
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)

    # Dark background (rounded square)
    pad = int(64 * scale)
    radius = int(200 * scale)
    draw_rounded_rect(draw, (pad, pad, size - pad, size - pad), radius, BRAND_DARK)

    cx, cy = size // 2, size // 2
    ring_r = int(size * 0.36)         # radius to ring centre-line
    ring_thickness = int(size * 0.13) # stroke width

    bbox = (cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r)

    # 30° gap centred at 315° (top-right). PIL angles are clockwise from 3 o'clock.
    gap_center = 315
    gap_half = 15
    arc_start = gap_center + gap_half  # 330°
    arc_end = gap_center - gap_half    # 300°

    # Arc covers 330° of the circle (clockwise from arc_start to arc_end)
    draw.arc(bbox, start=arc_start, end=arc_end, fill=BRAND_PRIMARY, width=ring_thickness)

    return im


def save_png(im: Image.Image, path: Path, size: int, opaque: bool = False) -> None:
    img = im if im.size == (size, size) else im.resize((size, size), Image.Resampling.LANCZOS)
    if opaque:
        # Flatten onto solid background for Apple touch icon (no transparency preferred)
        bg = Image.new("RGB", img.size, BRAND_DARK)
        bg.paste(img, mask=img.split()[-1])
        bg.save(path, format="PNG")
    else:
        img.save(path, format="PNG")


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    out_dir = repo_root / "frontend" / "public" / "icons"
    ensure_dir(out_dir)

    base = make_base_icon(1024)

    outputs = {
        "app-icon-1024.png": (1024, False),
        "app-icon-512.png": (512, False),
        "app-icon-192.png": (192, False),
        "apple-touch-icon-180.png": (180, True),
        "favicon-48.png": (48, False),
        "favicon-32.png": (32, False),
        "favicon-16.png": (16, False),
        "maskable-512.png": (512, False),
    }

    for name, (size, opaque) in outputs.items():
        save_png(base, out_dir / name, size=size, opaque=opaque)

    # Build a multi-size ICO from the high-res base
    ico_path = out_dir / "favicon.ico"
    base.save(ico_path, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])

    print("Wrote icons to:")
    for name in outputs:
        print(f" - {out_dir / name}")
    print(f" - {ico_path}")


if __name__ == "__main__":
    main()
