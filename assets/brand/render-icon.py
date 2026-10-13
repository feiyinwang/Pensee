"""Render Pensée's brand mark: SVG sources and the 1024px app-icon PNG.

The mark is the Thick–Thin pilcrow (¶) in its "maison" cut: a heavy left stem,
a light right stem, a top bar, one concave serif in at the top left and one out
at the bottom right. Geometry and rules live in docs/brand.md.

Usage (from the repo root):
    python3 -I assets/brand/render-icon.py
    cd apps/desktop && node_modules/.bin/tauri icon ../../assets/brand/app-icon-1024.png
    cp assets/brand/favicon-512.png apps/website/public/favicon.png
"""

import math
import os

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))

INK = (11, 11, 11)  # #0b0b0b
CREAM = (236, 231, 220)  # #ece7dc

# Two cuts of the same drawing. Units are arbitrary; the left stem starts at x=0.
#   w1 heavy stem, g gap, w2 light stem, T/B top and bottom, h top bar,
#   R1 top-left serif, R2 bottom-right serif.
DISPLAY = dict(w1=21, g=8, w2=3, T=12, B=88, h=3, R1=30, R2=22)  # large sizes, print
SMALL = dict(w1=21, g=8, w2=6, T=12, B=88, h=5, R1=28, R2=20)  # app icon, favicon, < 64px


def outline(w1, g, w2, T, B, h, R1, R2, steps=48):
    """The mark as one closed polygon (list of (x, y)), clockwise, y down."""
    c = w1 + g + w2
    pts = [(-R1, T), (c, T), (c, B - R2)]
    # Bottom-right serif: arc centred (c+R2, B-R2) from 180° down to 90°, hugging the corner (c, B).
    cx, cy = c + R2, B - R2
    for i in range(1, steps + 1):
        a = math.radians(180 - 90 * i / steps)
        pts.append((cx + R2 * math.cos(a), cy + R2 * math.sin(a)))
    pts += [(w1 + g, B), (w1 + g, T + h), (w1, T + h), (w1, B), (0, B), (0, T + R1)]
    # Top-left serif: arc centred (-R1, T+R1) from 0° up to -90°, hugging the corner (0, T).
    cx, cy = -R1, T + R1
    for i in range(1, steps + 1):
        a = math.radians(-90 * i / steps)
        pts.append((cx + R1 * math.cos(a), cy + R1 * math.sin(a)))
    return pts


def svg_path(w1, g, w2, T, B, h, R1, R2):
    """The same outline as an SVG path with true arcs."""
    c = w1 + g + w2
    return (
        f"M{-R1} {T}H{c}V{B - R2}A{R2} {R2} 0 0 0 {c + R2} {B}"
        f"H{w1 + g}V{T + h}H{w1}V{B}H0V{T + R1}A{R1} {R1} 0 0 0 {-R1} {T}Z"
    )


def bounds(p):
    c = p["w1"] + p["g"] + p["w2"]
    return -p["R1"], p["T"], c + p["R2"], p["B"]


def write_mark_svg(name, p, color="currentColor"):
    x0, y0, x1, y1 = bounds(p)
    pad = 2
    vb = f"{x0 - pad} {y0 - pad} {x1 - x0 + 2 * pad} {y1 - y0 + 2 * pad}"
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" fill="{color}">'
        f'<path d="{svg_path(**p)}"/></svg>\n'
    )
    with open(os.path.join(HERE, name), "w") as f:
        f.write(svg)


def squircle(cx, cy, half, n=5.0, steps=720):
    """macOS-style continuous-corner square (superellipse)."""
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        ct, st = math.cos(t), math.sin(t)
        x = half * math.copysign(abs(ct) ** (2 / n), ct)
        y = half * math.copysign(abs(st) ** (2 / n), st)
        pts.append((cx + x, cy + y))
    return pts


def render_icon(size=1024, ss=4):
    S = size * ss
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # macOS icon grid: an 824px body centred on the 1024px canvas.
    half = 412 / 1024 * S
    body = squircle(S / 2, S / 2, half)

    # Soft drop shadow under the body.
    shadow = Image.new("L", (S, S), 0)
    ImageDraw.Draw(shadow).polygon([(x, y + 12 * ss) for x, y in body], fill=90)
    shadow = shadow.filter(ImageFilter.GaussianBlur(14 * ss))
    canvas.paste((0, 0, 0, 255), (0, 0), shadow)

    # Body: near-black with a faint top-to-bottom fall-off.
    grad = Image.new("RGBA", (S, S))
    gd = ImageDraw.Draw(grad)
    top, bottom = (30, 30, 30), INK
    for y in range(S):
        t = y / S
        gd.line([(0, y), (S, y)], fill=tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).polygon(body, fill=255)
    canvas.paste(grad, (0, 0), mask)

    # The mark (small cut), cream, centred, about 56% of the body's height.
    p = SMALL
    x0, y0, x1, y1 = bounds(p)
    scale = (0.56 * 2 * half) / (y1 - y0)
    ox = S / 2 - (x0 + x1) / 2 * scale
    oy = S / 2 - (y0 + y1) / 2 * scale
    mark = [(ox + x * scale, oy + y * scale) for x, y in outline(**p)]
    ImageDraw.Draw(canvas).polygon(mark, fill=CREAM + (255,))

    return canvas.resize((size, size), Image.LANCZOS)


def write_icon_svg():
    """Vector version of the app icon (rounded square approximates the squircle)."""
    p = SMALL
    x0, y0, x1, y1 = bounds(p)
    body, half = 824, 412
    scale = (0.56 * body) / (y1 - y0)
    tx = 512 - (x0 + x1) / 2 * scale
    ty = 512 - (y0 + y1) / 2 * scale
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">'
        f'<rect x="{512 - half}" y="{512 - half}" width="{body}" height="{body}" rx="185" fill="#0b0b0b"/>'
        f'<path transform="translate({tx:.2f} {ty:.2f}) scale({scale:.4f})" fill="#ece7dc" d="{svg_path(**p)}"/>'
        "</svg>\n"
    )
    with open(os.path.join(HERE, "app-icon.svg"), "w") as f:
        f.write(svg)


if __name__ == "__main__":
    write_mark_svg("pensee-mark.svg", DISPLAY)
    write_mark_svg("pensee-mark-small.svg", SMALL)
    write_icon_svg()
    icon = render_icon(1024)
    icon.save(os.path.join(HERE, "app-icon-1024.png"))
    icon.resize((512, 512), Image.LANCZOS).save(os.path.join(HERE, "favicon-512.png"))
    print("wrote pensee-mark.svg, pensee-mark-small.svg, app-icon.svg, app-icon-1024.png, favicon-512.png")
