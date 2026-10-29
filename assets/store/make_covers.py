#!/usr/bin/env python3
"""Meta Horizon Store art for Carpathron Avatar (VRC.Quest.Asset.2):
   - the app title "Carpathron Avatar", spelled exactly like the listing, is the most prominent text
   - no tagline, banner or other text
   - branding: title + the Carpathron robot (main character)
"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROBOT = Image.open(os.environ.get('ROBOT_IMG', os.path.join(HERE, '..', 'robot.jpg'))).convert('RGB')
FONT = '/usr/share/fonts/opentype/inter/InterDisplay-Black.otf'
BG = (14, 16, 21)
ORANGE = (245, 130, 40)
TITLE = ('Carpathron', 'Avatar')   # the store title "Carpathron Avatar", one line or two equal lines


def background(w, h, spot):
    """dark background with a soft light behind the robot"""
    im = Image.new('RGB', (w, h), BG)
    glow = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(glow)
    cx, cy, r = spot
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(r * 0.45))
    light = Image.new('RGB', (w, h), (60, 66, 80))
    return Image.composite(light, im, glow)


def robot(height):
    """robot photo with its edges faded into the background (no visible rectangle)"""
    r = ROBOT.resize((round(ROBOT.width * height / ROBOT.height), height), Image.LANCZOS)
    m = Image.new('L', r.size, 0)
    f = max(8, int(r.width * 0.14))
    ImageDraw.Draw(m).rectangle((f, f, r.width - f, r.height - int(f * 0.4)), fill=255)
    m = m.filter(ImageFilter.GaussianBlur(f * 0.55))
    return r, m


def fit_font(lines, max_w, max_size):
    size = max_size
    while size > 20:
        ft = ImageFont.truetype(FONT, size)
        if max(ft.getbbox(t)[2] - ft.getbbox(t)[0] for t in lines) <= max_w:
            return ft
        size -= 4
    return ImageFont.truetype(FONT, size)


def title(im, lines, box, max_size, align='left', bar=True):
    """draws the title lines at one size, white, with a thin orange accent bar (no text)"""
    x0, y0, x1, y1 = box
    ft = fit_font(lines, x1 - x0, max_size)
    d = ImageDraw.Draw(im)
    asc, desc = ft.getmetrics()
    lh = int((asc + desc) * 0.98)
    total = lh * len(lines)
    y = y0 + (y1 - y0 - total) // 2
    widths = [ft.getbbox(t)[2] - ft.getbbox(t)[0] for t in lines]
    for t, w in zip(lines, widths):
        x = x0 if align == 'left' else x0 + ((x1 - x0) - w) // 2
        d.text((x - ft.getbbox(t)[0], y), t, font=ft, fill=(246, 247, 249))
        y += lh
    if not bar:
        return ft.size
    bar_w = int(max(widths) * 0.22)
    bx = x0 if align == 'left' else x0 + ((x1 - x0) - bar_w) // 2
    bh = max(6, ft.size // 14)
    d.rounded_rectangle((bx, y + bh * 2, bx + bar_w, y + bh * 3), radius=bh // 2, fill=ORANGE)
    return ft.size


def make(name, w, h, layout):
    if layout == 'side':                      # landscape-type: robot left, title right
        rh = int(h * 0.94)
        r, m = robot(rh)
        rx = int(w * 0.06)
        ry = h - rh
        im = background(w, h, (rx + r.width // 2, ry + rh // 2, int(rh * 0.55)))
        im.paste(r, (rx, ry), m)
        lines = TITLE if w / h < 2.4 else (' '.join(TITLE),)
        tx0 = rx + int(r.width * 0.98)
        size = title(im, lines, (tx0, int(h * 0.12), w - int(w * 0.06), int(h * 0.88)), int(h * 0.30) if len(lines) == 1 else int(h * 0.20))
    else:                                     # portrait / square: title on top, robot below
        top = int(h * (0.30 if layout == 'portrait' else 0.32))
        rh = h - top - int(h * 0.01)
        r, m = robot(rh)
        rx = (w - r.width) // 2
        im = background(w, h, (w // 2, top + rh // 2, int(rh * 0.5)))
        im.paste(r, (rx, h - rh), m)
        size = title(im, TITLE, (int(w * 0.07), int(h * 0.03), w - int(w * 0.07), top - int(h * 0.02)), int(top * 0.42), align='center', bar=False)
    out = os.path.join(HERE, name)
    im.save(out, optimize=True)
    print(f'{name}: {w}x{h}, title {size}px')


make('cover-landscape-2560x1440.png', 2560, 1440, 'side')
make('trailer-cover-2560x1440.png', 2560, 1440, 'side')
make('hero-3000x900.png', 3000, 900, 'side')
make('mini-landscape-1080x360.png', 1080, 360, 'side')
make('cover-square-1440x1440.png', 1440, 1440, 'square')
make('cover-portrait-1008x1440.png', 1008, 1440, 'portrait')
