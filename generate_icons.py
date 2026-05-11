#!/usr/bin/env python3
"""Generate icon-192.png and icon-512.png using only Python built-ins."""
import struct, zlib, math

def png(width, height, pixels):
    def chunk(tag, data):
        raw = tag + data
        return struct.pack('>I', len(data)) + raw + struct.pack('>I', zlib.crc32(raw) & 0xffffffff)
    rows = b''.join(b'\x00' + bytes(r for px in row for r in px) for row in pixels)
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(rows, 9))
            + chunk(b'IEND', b''))

def make_icon(size):
    BG     = (15, 14, 23)       # #0f0e17 — dark navy
    GOLD   = (226, 183, 20)     # #e2b714 — note colour
    WHITE  = (245, 240, 232)    # piano key white
    BLACK  = (30, 28, 50)       # piano key black

    pixels = [[BG] * size for _ in range(size)]

    def fill(x0, y0, x1, y1, colour):
        for y in range(max(0, y0), min(size, y1)):
            for x in range(max(0, x0), min(size, x1)):
                pixels[y][x] = colour

    def circle(cx, cy, r, colour, aa=False):
        for y in range(max(0, cy - r - 1), min(size, cy + r + 2)):
            for x in range(max(0, cx - r - 1), min(size, cx + r + 2)):
                if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                    pixels[y][x] = colour

    # Rounded rect background with a slight lighter centre
    pad = size // 8
    for y in range(size):
        for x in range(size):
            dist = max(0, pad - min(x, y, size-1-x, size-1-y))
            if dist < pad:
                pixels[y][x] = BG

    # Piano keys — three white keys bottom third
    key_top    = int(size * 0.55)
    key_bottom = int(size * 0.85)
    margin     = size // 7
    kw         = (size - margin * 2) // 3
    gap        = size // 60

    for k in range(3):
        x0 = margin + k * kw + gap
        x1 = margin + (k + 1) * kw - gap
        fill(x0, key_top, x1, key_bottom, WHITE)

    # Black keys between keys 0-1 and 1-2
    bw = int(kw * 0.55)
    bh = int((key_bottom - key_top) * 0.60)
    for k in (0, 1):
        bx = margin + (k + 1) * kw - bw // 2
        fill(bx, key_top, bx + bw, key_top + bh, BLACK)

    # Music note — notehead circle + stem
    nh_cx = int(size * 0.42)
    nh_cy = int(size * 0.30)
    nh_r  = max(4, size // 13)
    circle(nh_cx, nh_cy, nh_r, GOLD)

    # Stem (upward-right from notehead)
    sw = max(2, size // 55)
    sx = nh_cx + nh_r - sw
    for y in range(nh_cy - nh_r * 4, nh_cy - nh_r + 1):
        for x in range(sx, sx + sw):
            if 0 <= y < size and 0 <= x < size:
                pixels[y][x] = GOLD

    # Flag
    flag_y = nh_cy - nh_r * 4
    for dy in range(nh_r):
        fx_end = sx + sw + max(1, int(nh_r * 1.4 * (1 - dy / nh_r)))
        for x in range(sx + sw, fx_end):
            y = flag_y + dy
            if 0 <= y < size and 0 <= x < size:
                pixels[y][x] = GOLD

    return pixels

for size in (192, 512):
    data = png(size, size, make_icon(size))
    fname = f'icon-{size}.png'
    with open(fname, 'wb') as f:
        f.write(data)
    print(f'  created {fname} ({len(data):,} bytes)')
