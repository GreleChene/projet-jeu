# Générateur de sprites pixel art -> aperçu PNG + données JS
import json, sys, math
from PIL import Image
OUTLINE = '#120c0a'

class C:
    def __init__(s, w, h, oy=0): s.w, s.h, s.oy = w, h, oy; s.g = [[' '] * w for _ in range(h)]
    def px(s, x, y, ch):
        x, y = int(round(x)), int(round(y)) + s.oy
        if 0 <= x < s.w and 0 <= y < s.h: s.g[y][x] = ch
    def line(s, x0, y0, x1, y1, ch, w=1):
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for i in range(n + 1):
            t = i / max(1, n); x = x0 + (x1 - x0) * t; y = y0 + (y1 - y0) * t
            for dx in range(w):
                for dy in range(w): s.px(math.floor(x) + dx - w // 2 + (w % 2 == 0 and 1 or 0) * 0, math.floor(y) + dy - w // 2, ch)
    def poly(s, pts, ch):
        ys = [p[1] for p in pts]
        for y in range(int(min(ys)), int(max(ys)) + 1):
            yc = y + 0.5; xs = []
            for i in range(len(pts)):
                (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % len(pts)]
                if (y0 <= yc < y1) or (y1 <= yc < y0): xs.append(x0 + (yc - y0) * (x1 - x0) / (y1 - y0))
            xs.sort()
            for a, b in zip(xs[::2], xs[1::2]):
                for x in range(int(math.ceil(a - 0.5)), int(math.floor(b - 0.5)) + 1): s.px(x, y, ch)
    def rect(s, x, y, w, h, ch):
        for yy in range(y, y + h):
            for xx in range(x, x + w): s.px(xx, yy, ch)
    def ell(s, cx, cy, rx, ry, ch):
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1: s.px(x, y, ch)
    def recolor(s, frm, to, cond):
        for y in range(s.h):
            for x in range(s.w):
                if s.g[y][x] in frm and cond(x, y - s.oy): s.g[y][x] = to
    def text(s, x, y, rows):
        for j, r in enumerate(rows):
            for i, ch in enumerate(r):
                if ch not in ' .': s.px(x + i, y + j, ch)
    def rows(s): return [''.join(r).rstrip() for r in s.g]
    def copy(s):
        c = C(s.w, s.h); c.g = [r[:] for r in s.g]; return c

def render(rows, pal, scale):
    h = len(rows); w = max(len(r) for r in rows)
    W, H = w + 2, h + 2
    pix = {}
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch not in ' .': pix[(x + 1, y + 1)] = pal[ch]
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    hexc = lambda c: tuple(int(c[i:i+2], 16) for i in (1, 3, 5)) + (255,)
    for (x, y), c in pix.items(): im.putpixel((x, y), hexc(c))
    for y in range(H):
        for x in range(W):
            if (x, y) not in pix and any((x + dx, y + dy) in pix for dx, dy in ((1,0),(-1,0),(0,1),(0,-1))): im.putpixel((x, y), hexc(OUTLINE))
    return im.resize((W * scale, H * scale), Image.NEAREST)

def sheet(sprites, path, scale=6, bg=(105, 184, 71)):
    ims = []
    for name, sp in sprites.items():
        for fr in sp['frames']: ims.append(render(fr, sp['pal'], scale))
    W = sum(i.width for i in ims) + 16 * len(ims) + 16; H = max(i.height for i in ims) + 20
    out = Image.new('RGB', (W, H), bg); x = 10
    for i in ims: out.paste(i, (x, H - 10 - i.height), i); x += i.width + 16
    out.save(path)
