"""Tréant, larve putride, crapaud, champignon, mutant."""
from gen import C

TREANT_PAL = {'B': '#5a4a31', 'b': '#3a2d1d', 'l': '#76603e', 'x': '#0b0705', 'G': '#6fd6ff', 'g': '#e0fbff', 'L': '#2f6b4a', 'K': '#4a9a68', 'k': '#1d4a30', 'S': '#7e7b86', 's': '#55525e', 'M': '#4f7a32'}
TREANT_VAR = {'colossal': {'L': '#24563a', 'K': '#3a7a52', 'k': '#123a22'}}
def treant(frame=0):
    c = C(46, 56)
    st = [0, 1][frame % 2]
    up = 6 if frame == 2 else 0
    # ramure arrière et feuillage
    c.line(15, 14, 8, 6, 'b', 3); c.line(8, 6, 4, 4, 'b', 2)
    for (x, y, r) in ((5, 4, 5), (12, 2, 4)): c.ell(x, y + 3, r, r * 0.8, 'k')
    # bras arrière massif
    c.line(13, 17, 7, 28, 'b', 4); c.line(7, 28, 6, 38, 'b', 3)
    for dx in (-2, 0, 2): c.line(6, 38, 6 + dx, 42, 'b')
    # jambes-racines
    c.line(17, 38, 15 + st, 50, 'b', 5); c.line(27, 38, 29 - st, 50, 'B', 5)
    for x0 in (15 + st, 29 - st):
        c.rect(x0 - 3, 46, 7, 2, 'S'); c.px(x0, 46, 'G')
        for dx in (-4, -1, 2, 4): c.line(x0, 51, x0 + dx, 55, 'b')
    # tronc large aux épaules
    c.poly([(16, 38), (14, 28), (11, 18), (14, 13), (22, 10), (31, 11), (35, 17), (32, 28), (30, 38)], 'B')
    c.recolor('B', 'l', lambda x, y: x <= 15)
    c.recolor('B', 'b', lambda x, y: x >= 31)
    for x in (17, 21, 25, 29): c.line(x, 14, x + (1 if x % 2 else -1), 37, 'b')
    for (x, y) in ((16, 30), (30, 20)): c.ell(x, y, 1.6, 1.2, 'x')
    # veines et cœur bleutés
    for (x0, y0, x1, y1) in [(23, 17, 22, 23), (22, 23, 24, 29), (22, 23, 18, 26), (23, 20, 27, 19)]: c.line(x0, y0, x1, y1, 'G')
    c.rect(22, 21, 2, 2, 'g')
    # mousse
    for (x, y) in ((14, 14), (16, 13), (31, 13), (17, 36)): c.rect(x, y, 3, 1, 'M')
    # visage creusé dans le haut du tronc
    c.poly([(22, 14), (31, 13), (29, 16), (23, 16)], 'x')
    c.px(24, 14, 'G'); c.px(28, 14, 'G'); c.px(24, 15, 'g')
    c.line(24, 19, 29, 18, 'x')
    # ramure avant, large et feuillue
    c.line(25, 11, 25, 4, 'B', 3); c.line(30, 12, 37, 5, 'B', 3); c.line(37, 5, 41, 4, 'B', 2)
    for (x, y, r) in ((24, 3, 5), (35, 3, 4.5), (42, 5, 4), (30, 6, 3.2)):
        c.ell(x, y, r, r * 0.8, 'L'); c.px(x - 1, int(y - r * 0.4), 'K'); c.px(x + 1, int(y - r * 0.2), 'K')
    # bras avant (se lève à l'attaque)
    c.line(32, 17, 39, 27 - up, 'B', 4); c.line(39, 27 - up, 40, 37 - up, 'B', 3)
    for dx in (-2, 0, 2): c.line(40, 37 - up, 40 + dx, 41 - up, 'b')
    return c.rows()

CRAWL_PAL = {'F': '#7fd13b', 'f': '#4f9420', 'd': '#2e5a12', 'Y': '#e8ff6a', 'P': '#b14cff', 'k': '#2a1a1a', 'S': '#b8ff3a'}
def crawler(frame=0):
    c = C(44, 20)
    for i in range(7):
        x = 6 + i * 5; r = 3.2 + i * 0.35; y = 12 - (1 if (i + frame) % 2 else 0)
        for dx in (-1, 1): c.line(x + dx, y + 2, x + dx * 2 + ((i + frame) % 2), 19, 'd')
        c.ell(x, y, r, r * 0.95, 'f' if i % 2 else 'F')
        c.line(x - 2, y - 1, x + 2, y - 1, 'd')
        if i % 2 == 0: c.px(x - 1, y - 2, 'Y')
        c.poly([(x - 1, y - r + 0.5), (x, y - r - 3), (x + 1, y - r + 0.5)], 'P')
    hx = 42 - 2
    c.ell(hx, 11, 4, 4, 'f'); c.px(hx + 1, 9, 'Y'); c.px(hx + 2, 10, 'Y')
    o = 1 if frame == 2 else 0
    c.line(hx + 2, 13, hx + 5, 15 + o, 'k'); c.line(hx + 2, 14, hx + 4, 17, 'k')
    c.px(hx + 2, 17, 'S')
    return c.rows()

TOAD_PAL = {'F': '#58a62a', 'f': '#3a7a1a', 'L': '#d8e0a0', 'k': '#120c0a', 'Y': '#e8c83a', 'w': '#2e5a12', 'T': '#d8506a', 'V': '#9dff3a'}
TOAD_VAR = {'king': {'F': '#3f8a1e', 'f': '#24601a', 'w': '#1a4010'}}
def toad(frame=0):
    c = C(40, 24)
    b = [0, 1][frame % 2]
    c.poly([(3, 23), (1, 16), (6, 13), (12, 20), (10, 23)], 'f')
    c.ell(18, 15 - b * 0.3, 15, 8.5 + b * 0.3, 'F')
    c.recolor('F', 'L', lambda x, y: y >= 18 and x >= 12)
    for (x, y) in ((8, 10), (12, 8), (16, 9), (10, 14), (6, 15), (20, 8), (14, 12), (24, 10)): c.rect(x, y, 2, 2, 'w'); c.px(x, y, 'F')
    c.line(17, 17, 33, 16, 'k')
    if frame == 2: c.line(33, 16, 39, 15, 'T', 2)
    for ex in (21, 28):
        c.ell(ex, 7, 3.2, 3, 'F'); c.ell(ex, 7, 2.2, 2, 'Y'); c.line(ex - 1, 7, ex + 2, 7, 'k')
    c.poly([(26, 20), (30, 23), (24, 23)], 'f')
    c.px(31, 18 + frame % 2, 'V')
    return c.rows()

SHROOM_PAL = {'C': '#b14cff', 'c': '#7a2ab8', 'W': '#f3ead7', 'S': '#d8c6a0', 's': '#a8966e', 'g': '#4a2a5a', 'x': '#0a0608', 'E': '#c6ff5e', 'V': '#c6ff5e'}
SHROOM_VAR = {'titan': {'C': '#9a2fe6', 'c': '#5e1a9a'}}
def shroom(frame=0):
    c = C(34, 36)
    st = [0, 1][frame % 2]
    c.line(13, 28, 11 - st, 35, 's', 3); c.line(20, 28, 22 + st, 35, 'S', 3)
    c.poly([(10, 17), (23, 17), (24, 29), (9, 29)], 'S'); c.recolor('S', 's', lambda x, y: x >= 21 or y >= 27)
    c.line(9, 20, 5, 26, 's', 2); c.line(24, 20, 28, 24 - (3 if frame == 2 else 0), 'S', 2)
    c.ell(14, 21, 1.6, 2, 'x'); c.ell(20, 21, 1.6, 2, 'x'); c.px(14, 21, 'E'); c.px(20, 21, 'E')
    c.ell(17, 25, 2.5, 1 + (frame == 2), 'x')
    c.ell(17, 17, 15, 3, 'g')
    c.poly([(2, 17), (4, 9), (10, 3), (17, 1), (24, 3), (30, 9), (32, 17)], 'C')
    c.recolor('C', 'c', lambda x, y: x >= 26 or y >= 15)
    for (x, y, r) in ((9, 9, 2.2), (17, 5, 2), (24, 10, 2), (13, 13, 1.3), (28, 14, 1.2)): c.ell(x, y, r, r, 'W')
    for i in range(3): c.px(8 + i * 8, (0 + frame + i) % 3, 'V')
    return c.rows()

ZOMBIE_PAL = {'F': '#6b8f3a', 'f': '#4a6a26', 'L': '#8fb05a', 'P': '#3a3448', 'p': '#262230', 'T': '#6b5f6e', 't': '#4a404e', 'x': '#0a0608', 'E': '#d8ff6a', 'W': '#e8dcc0', 'r': '#5a1a24'}
ZOMBIE_VAR = {'abomination': {'F': '#4f6e2a', 'f': '#344a1a', 'L': '#6e8f44'}}
def zombie(frame=0):
    c = C(40, 48)
    st = [0, 1][frame % 2]
    up = 5 if frame == 2 else 0
    c.line(15, 32, 12 - st, 46, 'p', 4); c.line(23, 32, 26 + st, 46, 'P', 4)
    c.rect(9 - st, 46, 6, 2, 'x'); c.rect(24 + st, 46, 6, 2, 'x')
    c.line(13, 16, 8, 26, 'f', 3); c.line(8, 26, 12, 32, 'f', 3)
    c.poly([(11, 14), (26, 13), (29, 20), (27, 31), (12, 32), (9, 22)], 'F')
    c.recolor('F', 'f', lambda x, y: x >= 26)
    c.recolor('F', 'L', lambda x, y: x <= 12)
    c.ell(19, 21, 3.5, 4.5, 'r')
    for y in (18, 20, 22, 24): c.line(17, y, 21, y, 'W')
    c.line(12, 17, 18, 15, 'x');
    for x in (13, 15, 17): c.px(x, 15 + (x % 2), 'x')
    c.poly([(11, 30), (28, 30), (27, 34), (22, 33), (19, 35), (15, 33), (11, 34)], 'T'); c.recolor('T', 't', lambda x, y: y >= 33)
    # tête basse penchée
    c.ell(25, 10, 5.5, 5, 'F'); c.recolor('F', 'f', lambda x, y: y >= 13 and x >= 22)
    c.rect(24, 9, 2, 2, 'x'); c.rect(28, 9, 2, 2, 'x'); c.px(24, 9, 'E')
    c.rect(24, 13, 6, 2, 'x'); c.px(25, 13, 'W'); c.px(27, 13, 'W'); c.px(29, 13, 'W')
    c.line(21, 6, 23, 8, 'x'); c.px(22, 7, 'W')
    # bras difforme tendu
    c.line(26, 16, 33, 19 - up, 'F', 5); c.line(33, 19 - up, 37, 21 - up, 'F', 4)
    for dy in (-1, 1, 3): c.line(38, 21 - up + dy, 40, 22 - up + dy, 'W')
    return c.rows()
