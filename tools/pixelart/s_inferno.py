"""Araignée, diablotin, salamandre, élémentaire, Mère-Spore, squelette."""
from gen import C

SPIDER_PAL = {'F': '#3e4a2a', 'f': '#252e18', 'L': '#5a6a3e', 'R': '#c4281e', 'E': '#ff2a2a', 'k': '#120c0a', 'h': '#6a7a4e'}
SPIDER_VAR = {'queen': {'F': '#2b3320', 'f': '#161c10', 'L': '#40502e'}}
def spider(frame=0):
    c = C(44, 24)
    k = [0, 1][frame % 2]
    def legs(far):
        col = 'f' if far else 'F'
        for i in range(4):
            bx, by = 22 - i * 2, 13
            fx = [42, 35, 9, 2][i] + (-2 if far else 0) + ((k + i) % 2) * 2 - 1
            kx = bx + (fx - bx) * 0.5; ky = 2 + (1 if i in (1, 2) else 0) + ((k + i) % 2) + (2 if far else 0)
            c.line(bx, by, kx, ky, col, 2); c.line(kx, ky, fx, 23, col)
    legs(True)
    c.ell(12, 13, 9, 7.5, 'F'); c.recolor('F', 'L', lambda x, y: y <= 8 and x <= 12)
    for (x, y) in ((6, 9), (9, 7), (14, 7), (17, 10), (5, 15)): c.px(x, y, 'h')
    c.poly([(12, 8), (14, 12), (12, 16), (10, 12)], 'R')
    legs(False)
    c.ell(25, 13, 5, 4, 'F'); c.recolor('F', 'L', lambda x, y: x >= 23 and y <= 10)
    for (x, y) in ((27, 11), (29, 12), (26, 10), (28, 10)): c.px(x, y, 'E')
    o = 1 if frame == 2 else 0
    c.line(28, 15, 30, 18 + o, 'k'); c.line(26, 16, 27, 19 + o, 'k')
    return c.rows()

IMP_PAL = {'F': '#e5462e', 'f': '#9a2a1a', 'L': '#ff8a6a', 'W': '#5a1a14', 'w': '#3a0e0a', 'H': '#2e1e1a', 'E': '#ffe14a', 'x': '#2a0e12', 'T': '#f3ead7'}
IMP_VAR = {'lord': {'F': '#b8251a', 'f': '#6e1410', 'L': '#e05040', 'W': '#3a0e0a', 'w': '#1e0806'}}
def imp(frame=0):
    c = C(36, 40)
    up = frame % 2 == 0
    def wing(far):
        col = 'w' if far else 'W'; ox = -3 if far else 0
        tip = (4 + ox, 3) if up else (2 + ox, 20)
        c.poly([(14 + ox, 15), tip, (tip[0] - 2, tip[1] + 8), (6 + ox, 22), (10 + ox, 21), (14 + ox, 22)], col)
        c.line(14 + ox, 15, tip[0] - 2, tip[1] + 8, 'w' if not far else 'W')
    wing(True)
    # queue
    c.line(14, 30, 7, 32, 'f', 2); c.line(7, 32, 4, 27, 'f', 2); c.poly([(2, 25), (6, 24), (4, 28)], 'f')
    c.line(15, 30, 13, 38, 'f', 3); c.line(20, 30, 22, 38, 'F', 3)
    c.ell(17, 25, 5.5, 7, 'F'); c.ell(18, 26, 2.5, 4, 'L')
    wing(False)
    c.ell(19, 13, 5.5, 5, 'F'); c.recolor('F', 'f', lambda x, y: x >= 23 and y <= 18)
    c.line(16, 9, 13, 5, 'H', 2); c.line(13, 5, 14, 2, 'H'); c.line(21, 9, 24, 5, 'H', 2); c.line(24, 5, 23, 2, 'H')
    c.px(21, 12, 'E'); c.px(22, 12, 'E'); c.line(20, 11, 23, 11, 'x')
    c.line(18, 16, 23, 16, 'x'); c.px(19, 17, 'T'); c.px(22, 17, 'T')
    a = 3 if frame == 2 else 0
    c.line(22, 21, 28, 18 - a, 'F', 2)
    for d in (-1, 1): c.line(28, 18 - a, 30, 17 - a + d, 'T')
    return c.rows()

SALA_PAL = {'F': '#ff8a1a', 'f': '#c0561a', 'd': '#7a2e10', 'L': '#ffd23f', 'O': '#ff3d1a', 'Y': '#fff2a0', 'k': '#120c0a', 'E': '#ffe14a'}
SALA_VAR = {'ancient': {'F': '#ff5a1a', 'f': '#a8361a', 'd': '#5a1e0c'}}
def salamander(frame=0):
    c = C(46, 22)
    w = [0, 1][frame % 2]
    c.line(14, 13, 6, 12 + w, 'f', 3); c.line(6, 12 + w, 1, 9 + 2 * w, 'f', 2)
    g = [1, -1][frame % 2]
    for (x, d, col) in ((15, g, 'd'), (29, -g, 'd')): c.line(x, 15, x - 3 + d, 19, col, 2); c.line(x - 3 + d, 19, x - 2 + d, 21, col, 2)
    c.ell(22, 13, 10, 4.5, 'F'); c.recolor('F', 'f', lambda x, y: y <= 10)
    c.line(14, 16, 31, 16, 'L'); c.line(16, 17, 29, 17, 'Y')
    for (x, y) in ((17, 11), (21, 10), (25, 11), (28, 12)): c.px(x, y, 'd')
    for i, x in enumerate(range(13, 33, 3)):
        h = 4 + (i + frame) % 3; c.poly([(x, 9), (x + 1, 9 - h), (x + 2, 9)], 'O' if i % 2 else 'L')
    for (x, d, col) in ((17, -g, 'F'), (31, g, 'F')): c.line(x, 16, x + 3 + d, 19, col, 2); c.line(x + 3 + d, 19, x + 4 + d, 21, col, 2)
    c.poly([(30, 10), (38, 10), (43, 13), (38, 16), (31, 16)], 'F'); c.recolor('F', 'f', lambda x, y: x >= 30 and y <= 11)
    c.line(36, 14, 43, 13, 'k'); c.px(37, 12, 'E'); c.px(36, 11, 'k')
    return c.rows()

ELEM_PAL = {'R': '#3a2620', 'r': '#22140f', 'O': '#ff7a1a', 'L': '#ffb02e', 'Y': '#ffd23f', 'y': '#fff2a0', 'E': '#ffe14a'}
ELEM_VAR = {'magma': {'R': '#2a1a14', 'r': '#140a06', 'O': '#ff5a1a'}}
def elemental(frame=0):
    c = C(42, 50)
    st = [0, 1][frame % 2]
    up = 6 if frame == 2 else 0
    # flammes de la tête et des épaules
    for i, x in enumerate(range(12, 31, 3)):
        h = 9 + ((i + frame) % 3) * 2 - abs(i - 3)
        c.poly([(x - 1, 14), (x + 1, 14 - h), (x + 3, 14)], 'O' if i % 2 else 'Y')
    c.line(16, 36, 14 - st, 48, 'R', 5); c.line(26, 36, 28 + st, 48, 'R', 5)
    c.line(14 - st, 40, 14 - st, 46, 'O'); c.line(28 + st, 40, 28 + st, 46, 'O')
    c.line(11, 18, 6, 30, 'r', 4); c.rect(3, 29, 6, 6, 'r'); c.line(4, 31, 7, 33, 'O')
    c.poly([(10, 16), (16, 12), (27, 12), (33, 17), (32, 30), (27, 37), (15, 37), (10, 30)], 'R')
    c.recolor('R', 'r', lambda x, y: x >= 29 or y >= 34)
    for (x0, y0, x1, y1) in [(13, 18, 18, 23), (18, 23, 15, 30), (15, 30, 20, 35), (18, 23, 25, 21), (25, 21, 29, 27), (22, 28, 26, 33)]: c.line(x0, y0, x1, y1, 'O')
    c.rect(19, 23, 3, 3, 'L'); c.px(20, 24, 'y')
    c.poly([(17, 12), (18, 6), (26, 6), (27, 12)], 'R')
    c.px(20, 9, 'E'); c.px(24, 9, 'E'); c.line(20, 11, 24, 11, 'O')
    c.line(31, 18, 36, 26 - up, 'R', 4); c.rect(33, 26 - up, 7, 7, 'r'); c.line(34, 29 - up, 38, 28 - up, 'O')
    c.px(36, 34 - up + frame % 2, 'L')
    return c.rows()

MOTHER_PAL = {'C': '#c6ff5e', 'c': '#8fd13b', 'd': '#5a8a20', 'P': '#f6c8ff', 'p': '#b14cff', 'S': '#cfbf9c', 's': '#9a8a6a', 'x': '#2a0e12', 'W': '#efe6cf', 'V': '#9dff3a', 'T': '#5a4a66', 'g': '#3a2a40'}
def mother(frame=0):
    c = C(56, 40)
    for i in range(9):
        x = 8 + i * 5; k = ((i + frame) % 2) * 2 - 1
        c.line(x + 4, 28, x + k * 2, 39, 'T', 2)
    c.poly([(12, 18), (44, 18), (46, 32), (10, 32)], 'S'); c.recolor('S', 's', lambda x, y: x >= 40 or y >= 30)
    for x in (16, 22, 28, 34, 40): c.line(x, 19, x - 1, 31, 's')
    for (x, y, r) in ((19, 23, 2.2), (26, 22, 2.8), (34, 23, 2.2), (23, 27, 1.5), (31, 27, 1.5)):
        c.ell(x, y, r, r, 'W'); c.px(int(x + 0.5), int(y), 'x'); c.px(int(x + 0.5), int(y) - 1, 'V')
    c.rect(18, 29, 20, 2 + (frame == 2), 'x')
    for x in range(19, 38, 3): c.px(x, 29, 'W')
    c.ell(28, 18, 26, 3, 'g')
    c.poly([(2, 18), (6, 9), (16, 3), (28, 1), (40, 3), (50, 9), (54, 18)], 'C')
    c.recolor('C', 'c', lambda x, y: y >= 14 or x >= 46)
    for (x, y, r) in ((13, 11, 3), (24, 6, 3.5), (36, 8, 3), (46, 13, 2), (8, 15, 1.6), (30, 13, 1.6)):
        c.ell(x, y, r, r, 'p'); c.ell(x, y, r * 0.55, r * 0.55, 'P')
    for i in range(5): c.px(6 + i * 11, (frame + i) % 3, 'V')
    return c.rows()

SKEL_PAL = {'O': '#e8e2cf', 'o': '#a89c7e', 'x': '#0a0608', 'E': '#7dffd0', 'B': '#7a5a3a', 'A': '#c9a040', 'M': '#c3c8cf', 'm': '#7d828b'}
def skeleton(frame=0):
    c = C(28, 34)
    st = [0, 1][frame % 2]
    c.line(11, 22, 9 - st, 33, 'O'); c.line(15, 22, 17 + st, 33, 'O')
    c.rect(10, 20, 7, 2, 'o')
    c.line(13, 10, 13, 20, 'o')
    for y in (11, 13, 15, 17): c.line(10, y, 16, y, 'O')
    c.ell(6, 15, 4, 5, 'B'); c.px(6, 15, 'A'); c.line(9, 12, 9, 18, 'o')
    c.ell(14, 5, 4.5, 4.2, 'O'); c.recolor('O', 'o', lambda x, y: y >= 8 and x <= 13)
    c.rect(13, 4, 2, 2, 'x'); c.rect(16, 4, 2, 2, 'x'); c.px(13, 4, 'E'); c.px(16, 4, 'E')
    c.line(13, 8, 17, 8, 'x'); c.px(14, 8, 'O'); c.px(16, 8, 'O')
    a = 4 if frame == 2 else 0
    c.line(16, 11, 20, 15, 'O'); c.line(20, 15, 22, 13 - a, 'O')
    c.line(22, 14 - a, 26, 4 - a, 'M', 2); c.line(23, 13 - a, 27, 4 - a, 'm'); c.line(20, 13 - a, 24, 16 - a, 'A')
    return c.rows()
