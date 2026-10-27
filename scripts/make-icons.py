"""Regenerates every app/web icon from assets/brand/icon-source.png (needs Pillow):
    python3 scripts/make-icons.py
iOS/web use the full icon; Android adaptive icons put the cream panel inside the safe zone on the orange frame color.
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageStat
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(ROOT, 'assets/brand/icon-source.png')
A, P = os.path.join(ROOT, 'assets'), os.path.join(ROOT, 'public')
im = Image.open(src).convert('RGB')
W, H = im.size

# The cream panel (inside the orange frame) with its rounded corners, orange removed.
box = (33, 31, 1221, 1219)
panel = im.crop(box).convert('RGBA')
pw, ph = panel.size
mask = Image.new('L', (pw * 2, ph * 2), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, pw * 2 - 1, ph * 2 - 1), radius=int(pw * 0.2 * 2), fill=255)
mask = mask.resize((pw, ph), Image.LANCZOS)
panel.putalpha(mask)

# Background cream = average of the panel's border area so the edge blends in.
ring = im.crop((60, 450, 140, 750))
CREAM = tuple(int(v) for v in ImageStat.Stat(ring).mean[:3])
print('cream', CREAM, '#%02X%02X%02X' % CREAM)
ORANGE = (240, 128, 43)  # the icon's orange frame (#F0802B)
print('orange', ORANGE, '#%02X%02X%02X' % ORANGE)

def place(canvas, img, frac, bg=(0, 0, 0, 0)):
    c = Image.new('RGBA', (canvas, canvas), bg)
    s = frac * canvas / max(img.size)
    r = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    c.alpha_composite(r, ((canvas - r.width) // 2, (canvas - r.height) // 2))
    return c

# Soft edge so the panel melts into the cream background layer.
soft = panel.copy()
soft.putalpha(mask.filter(ImageFilter.GaussianBlur(pw * 0.03)))

full = im.convert('RGBA')
full.resize((1024, 1024), Image.LANCZOS).convert('RGB').save(os.path.join(A, 'icon.png'))
full.resize((48, 48), Image.LANCZOS).convert('RGB').save(os.path.join(A, 'favicon.png'))
for size, path in [(512, os.path.join(P, 'icon-512.png')), (192, os.path.join(P, 'icon-192.png')), (180, os.path.join(P, 'apple-touch-icon.png')), (256, os.path.join(A, 'logo.png'))]:
    full.resize((size, size), Image.LANCZOS).convert('RGB').save(path)

# Android adaptive icon: the panel inside the safe zone on a matching cream layer.
place(512, panel, 0.64).save(os.path.join(A, 'android-icon-foreground.png'))
Image.new('RGB', (512, 512), ORANGE).save(os.path.join(A, 'android-icon-background.png'))
# Themed (monochrome) icon: the dark strokes of the logo (D, utensils, text, outlines).
gray = im.crop(box).convert('L')
dark = gray.point(lambda v: 255 if v < 150 else (0 if v > 200 else int((200 - v) * 255 / 50)))
dark = Image.composite(dark, Image.new('L', dark.size, 0), mask.point(lambda v: 255 if v > 250 else 0).filter(ImageFilter.MinFilter(121)))
silhouette = Image.new('RGBA', dark.size, (0, 0, 0, 255))
silhouette.putalpha(dark)
place(432, silhouette, 0.62).save(os.path.join(A, 'android-icon-monochrome.png'))
# Maskable PWA icon.
place(512, panel, 0.8, ORANGE + (255,)).convert('RGB').save(os.path.join(P, 'icon-maskable-512.png'))
# Splash: the full icon in the middle (background color from app.json).
place(1024, full, 0.62).save(os.path.join(A, 'splash-icon.png'))
