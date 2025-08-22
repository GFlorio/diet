#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "Pillow>=11.3.0",
# ]
# ///

from __future__ import annotations
from pathlib import Path
from typing import Tuple

from PIL import Image, ImageDraw, ImageFilter


BRAND_PRIMARY = "#0ea5e9"  # theme_color
BRAND_DARK = "#0b1220"     # background_color / dark accent
PLATE_WHITE = "#ffffff"
PLATE_RIM = "#eef3f7"


def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def draw_rounded_rect(draw: ImageDraw.ImageDraw, xy: Tuple[int, int, int, int], radius: int, fill: str) -> None:
    draw.rounded_rectangle(xy, radius=radius, fill=fill)


def make_base_icon(size: int = 1024) -> Image.Image:
    """Create a simple, crisp icon: rounded brand background + plate + lightning bolt."""
    scale = size / 1024.0
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)

    # Background rounded square
    pad = int(64 * scale)
    radius = int(200 * scale)
    draw_rounded_rect(draw, (pad, pad, size - pad, size - pad), radius, BRAND_PRIMARY)

    # Plate shadow (blurred ellipse)
    plate_r = int(size * 0.33)
    cx, cy = size // 2, size // 2
    shadow_offset_y = int(size * 0.02)
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.ellipse(
        (cx - plate_r, cy - plate_r + shadow_offset_y, cx + plate_r, cy + plate_r + shadow_offset_y),
        fill=(0, 0, 0, 80),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(int(size * 0.03)))
    im.alpha_composite(shadow)

    # Plate (outer + rim)
    draw.ellipse((cx - plate_r, cy - plate_r, cx + plate_r, cy + plate_r), fill=PLATE_WHITE)
    rim_r = int(plate_r * 0.82)
    draw.ellipse((cx - rim_r, cy - rim_r, cx + rim_r, cy + rim_r), fill=PLATE_RIM)
    inner_r = int(plate_r * 0.66)
    draw.ellipse((cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r), fill=PLATE_WHITE)

    # Lightning bolt (calories) centered on plate
    bolt_h = int(plate_r * 1.35)
    bolt_w = int(plate_r * 0.85)
    # Normalized bolt polygon around (0,0). Tweaked for good readability at small sizes.
    pts_norm = [
        (0.05, -1.00),
        (-0.35, -0.10),
        (-0.05, -0.10),
        (-0.25, 1.00),
        (0.35, 0.12),
        (0.10, 0.12),
    ]

    def to_abs(p: Tuple[float, float]) -> Tuple[int, int]:
        x, y = p
        ax = int(cx + x * (bolt_w / 2))
        ay = int(cy + y * (bolt_h / 2))
        return (ax, ay)

    pts = list(map(to_abs, pts_norm))
    draw.polygon(pts, fill=BRAND_DARK)

    # Small highlight on plate (subtle)
    hl = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    hld = ImageDraw.Draw(hl)
    hl_r = int(plate_r * 0.95)
    hld.pieslice(
        (cx - hl_r, cy - hl_r, cx + hl_r, cy + hl_r),
        start=220,
        end=320,
        fill=(255, 255, 255, 36),
    )
    im.alpha_composite(hl)

    return im


def save_png(im: Image.Image, path: Path, size: int, opaque: bool = False) -> None:
    img = im if im.size == (size, size) else im.resize((size, size), Image.Resampling.LANCZOS)
    if opaque:
        # Flatten onto solid background for Apple touch icon (no transparency preferred)
        bg = Image.new("RGB", img.size, BRAND_PRIMARY)
        bg.paste(img, mask=img.split()[-1])
        bg.save(path, format="PNG")
    else:
        img.save(path, format="PNG")


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    out_dir = repo_root / "frontend" / "icons"
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
