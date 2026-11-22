import gob
BOW = ["  ww", " w  w", " n   w", " n   w", " n    w", " n    w", " n    w", " n    w", " n    w", " n   w", " n   w", " w  w", "  ww"]
QUIVER = ["  M M", "  nmn", " bBb", " bBBb", " bBBb", " bBBb", "  bBBb", "  bBBb", "   bb"]
def archer(frame):
    rows = list(gob.BASE)
    if frame == 1:
        for k, v in gob.WALK2.items(): rows[k] = v
    rows[22] = " sSSs bBBTTTTTTBBbsSSSS"
    rows[23] = " sSs  bBBBBBBBBBBbsSSSSS"
    rows[24] = "  ss  bbbbbbAAbbbb  sSS"
    rows += [''] * 0
    grid = [list(r.ljust(30)) for r in rows]
    def put(x, y, art):
        for j, r in enumerate(art):
            for i, ch in enumerate(r):
                if ch != ' ' and 0 <= y + j < len(grid): grid[y + j][x + i] = ch
    q = [[' '] * 30 for _ in range(0)]
    put(0, 9, QUIVER)
    put(22, 16, BOW)
    return [''.join(r).rstrip() for r in grid]
