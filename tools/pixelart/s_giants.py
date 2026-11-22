"""Golems, yéti, esprit, phénix."""
from gen import C

GOLEM_PAL = {'R': '#9fd3ff', 'r': '#6a9cc8', 'T': '#d8f0ff', 'd': '#3f6a90', 'G': '#8ff0ff', 'g': '#e8ffff', 'k': '#120c0a', 'M': '#5f9e4a'}
GOLEM_VAR = {
  'ancient': {'R': '#7cb8e8', 'r': '#4f88b8', 'T': '#c0e4ff', 'd': '#2a557a'},
  'obsidian': {'R': '#3a2e44', 'r': '#251c2e', 'T': '#5c4a6e', 'd': '#140e1a', 'G': '#c06bff', 'g': '#f0d0ff', 'M': '#4a3a5a'},
}
def golem(frame=0):
    c = C(40, 40)
    st = [0, 1][frame % 2]
    # jambes massives
    c.rect(11, 28 + st, 7, 11 - st, 'r'); c.rect(22, 28 - st, 7, 11 + st, 'r')
    c.rect(10, 37, 9, 3, 'd'); c.rect(21, 37, 9, 3, 'd')
    # bras arrière
    c.poly([(5, 12), (10, 11), (10, 28), (8, 30), (3, 29)], 'r'); c.poly([(1, 28), (9, 28), (9, 34), (1, 34)], 'd')
    # torse rocheux
    c.poly([(8, 10), (16, 6), (27, 6), (33, 10), (34, 20), (30, 29), (10, 29), (6, 20)], 'R')
    c.recolor('R', 'T', lambda x, y: y <= 9 or (x <= 10 and y <= 20))
    c.recolor('R', 'r', lambda x, y: x >= 29 or y >= 26)
    for (x0, y0, x1, y1) in [(12, 12, 15, 17), (25, 9, 23, 14), (28, 20, 31, 24), (11, 22, 14, 25)]: c.line(x0, y0, x1, y1, 'd')
    # veines lumineuses + cœur
    for (x0, y0, x1, y1) in [(20, 8, 19, 15), (19, 15, 22, 21), (22, 21, 20, 27), (19, 15, 15, 19), (22, 21, 26, 18)]: c.line(x0, y0, x1, y1, 'G')
    c.rect(19, 16, 3, 3, 'G'); c.px(20, 17, 'g')
    # éclats de cristal sur les épaules
    for (x, h) in ((10, 7), (13, 5), (29, 6), (32, 4)): c.poly([(x - 1, 10), (x, 10 - h), (x + 2, 10)], 'T')
    c.px(10, 5, 'g'); c.px(29, 6, 'g')
    # tête enfoncée, fente lumineuse
    c.poly([(16, 6), (17, 1), (25, 1), (26, 6)], 'r'); c.recolor('r', 'T', lambda x, y: y <= 2)
    c.line(19, 4, 24, 4, 'G'); c.px(23, 4, 'g')
    # bras avant + poing (levé à l'attaque)
    up = 4 if frame == 2 else 0
    c.poly([(30, 12), (36, 12), (37, 27 - up), (32, 28 - up), (30, 20)], 'R'); c.recolor('R', 'r', lambda x, y: x >= 35)
    c.poly([(30, 27 - up), (39, 27 - up), (39, 34 - up), (30, 34 - up)], 'r'); c.line(31, 30 - up, 38, 30 - up, 'd')
    c.rect(8, 9, 4, 1, 'M'); c.rect(28, 9, 3, 1, 'M')
    return c.rows()

YETI_PAL = {'F': '#eef3f8', 'f': '#a9b8c8', 'L': '#ffffff', 's': '#5a6a80', 'k': '#120c0a', 'E': '#8ff0ff', 'W': '#f8f4e8', 'H': '#d8ccb0', 'h': '#a89c7e', 'r': '#4a1a28'}
def yeti(frame=0):
    c = C(40, 42)
    st = [0, 1][frame % 2]
    c.rect(11, 30 + st, 7, 11 - st, 'f'); c.rect(22, 30 - st, 7, 11 + st, 'F')
    c.poly([(5, 12), (11, 12), (10, 34), (6, 37), (3, 34)], 'f')
    c.poly([(7, 13), (14, 7), (27, 7), (33, 13), (33, 26), (28, 32), (11, 32), (7, 26)], 'F')
    c.recolor('F', 'f', lambda x, y: x >= 30 or y >= 29)
    for i in range(14):
        x = 9 + (i * 7) % 22; y = 10 + (i * 5) % 20
        c.px(x, y, 'f' if i % 2 else 'L'); c.px(x - 1, y + 1, 'f' if i % 2 else 'L')
    # tête basse, cornes, visage bleu
    c.line(17, 6, 14, 1, 'H'); c.line(14, 1, 15, 0, 'h'); c.line(27, 6, 30, 1, 'H'); c.line(30, 1, 29, 0, 'h')
    c.ell(23, 8, 7, 5.5, 'F')
    c.poly([(22, 6), (30, 6), (30, 13), (23, 13)], 's')
    c.px(25, 8, 'E'); c.px(28, 8, 'E'); c.line(24, 7, 29, 7, 'k')
    j = 1 if frame == 2 else 0
    c.rect(24, 11, 5, 1 + j, 'r'); c.px(24, 10, 'W'); c.px(28, 10, 'W'); c.px(25, 12 + j, 'W'); c.px(27, 12 + j, 'W')
    up = 5 if frame == 2 else 0
    c.poly([(30, 13), (35, 13), (37, 34 - up), (32, 36 - up), (30, 24)], 'F')
    c.recolor('F', 'f', lambda x, y: x >= 35)
    for x in (32, 34, 36): c.px(x, 37 - up, 'W')
    for x in (4, 6, 8): c.px(x, 38, 'W')
    return c.rows()

GHOST_PAL = {'Q': '#5f7f95', 'q': '#3a5468', 'C': '#9fc8e0', 'I': '#e6f6ff', 'x': '#05060a', 'E': '#bff4ff', 'O': '#d8d0bc'}
def ghost(frame=0):
    c = C(30, 36)
    w = [0, 1][frame % 2]
    c.poly([(10, 2), (18, 1), (23, 6), (24, 16), (26, 30), (23, 27 + w), (21, 34), (18, 28), (15, 35 - w), (12, 28), (9, 33), (7, 26 + w), (4, 31), (5, 16), (6, 6)], 'Q')
    c.recolor('Q', 'C', lambda x, y: x <= 9 and y <= 20)
    c.recolor('Q', 'q', lambda x, y: x >= 21)
    for x in (10, 14, 18): c.line(x, 14, x + 1, 26, 'q')
    c.ell(16, 8, 5, 5, 'x')
    c.px(14, 8, 'E'); c.px(18, 8, 'E'); c.px(14, 7, 'I'); c.px(18, 7, 'I')
    c.line(22, 12, 27, 15, 'Q', 2)
    for (x1, y1) in ((29, 14), (29, 16), (28, 18)): c.line(27, 15, x1, y1, 'O')
    for (x, y) in ((3, 20), (27, 26), (2, 9)): c.px(x, y + w, 'I')
    return c.rows()

PHOENIX_PAL = {'B': '#2a1a20', 'b': '#140c10', 'O': '#ff3d1a', 'o': '#ff8a1a', 'Y': '#ffd23f', 'y': '#fff2a0', 'A': '#c9a040', 'E': '#ffe14a'}
def phoenix(frame=0):
    c = C(44, 34)
    up = frame % 2 == 0
    # aile arrière
    if up: c.poly([(16, 14), (10, 2), (4, 0), (6, 6), (2, 8), (12, 16)], 'b')
    else: c.poly([(16, 15), (8, 24), (2, 30), (6, 22), (1, 20), (12, 14)], 'b')
    # queue de flammes
    for i, (L, col) in enumerate(((16, 'O'), (19, 'o'), (14, 'Y'))):
        c.poly([(12, 17 + i), (12 - L, 22 + i * 3), (12 - L + 5, 21 + i * 3), (12, 19 + i)], col)
    # corps
    c.ell(20, 17, 9, 5.5, 'B'); c.recolor('B', 'b', lambda x, y: y >= 20)
    for (x0, y0, x1, y1) in [(14, 17, 19, 15), (19, 15, 25, 17)]: c.line(x0, y0, x1, y1, 'O')
    # tête, bec, crête enflammée
    c.ell(30, 12, 4.5, 4, 'B')
    c.poly([(34, 11), (39, 13), (34, 14)], 'A')
    c.px(31, 11, 'E'); c.px(32, 11, 'y')
    for i, h in enumerate((5, 7, 4)): c.line(27 + i * 2, 8, 26 + i * 2, 8 - h, 'O' if i % 2 else 'Y')
    # aile avant
    if up: c.poly([(18, 15), (24, 2), (32, 0), (29, 6), (34, 6), (24, 16)], 'B')
    else: c.poly([(18, 18), (24, 28), (32, 33), (29, 26), (34, 27), (25, 17)], 'B')
    for (x, y) in ((24, 3), (31, 1), (32, 6)) if up else ((25, 28), (32, 32), (33, 27)): c.px(x, y, 'O')
    return c.rows()
