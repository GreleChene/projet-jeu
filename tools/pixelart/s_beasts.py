"""Bêtes : loup, molosse infernal, cerbère, sanglier, ours."""
from gen import C

def legs4(c, frame, hind, front, top, col_far, col_near, w=2, paw='k'):
    """Quatre pattes animées. hind/front = x des hanches/épaules, top = y d'attache, sol = c.h-1."""
    g = c.h - 1
    ph = [(2, -2), (-2, 2)][frame % 2]
    for (x, d, col) in ((hind - 2, ph[1], col_far), (front - 2, ph[0], col_far), (hind, ph[0], col_near), (front, ph[1], col_near)):
        knee = (x + d * 0.5 + (1 if x < front - 4 else 0), (top + g) / 2 + 1)
        c.line(x, top, knee[0], knee[1], col, w + 1)
        c.line(knee[0], knee[1], x + d, g - 1, col, w)
        c.rect(int(x + d) - 1, g, 3, 1, paw)

WOLF_PAL = {'F': '#8a8378', 'f': '#5e5850', 'L': '#bdb6aa', 'k': '#1a1412', 'E': '#ffd23f', 'W': '#f3ead7', 'r': '#7a2030', 'N': '#3a3430'}
WOLF_VAR = {
  'snow': {'F': '#dfe8f0', 'f': '#9fb0c0', 'L': '#ffffff', 'N': '#7d8fa0', 'E': '#7fe8ff'},
  'alpha': {'F': '#55504a', 'f': '#2f2b28', 'L': '#857d72', 'N': '#1f1c1a', 'E': '#ff5a2a'},
  'ally': {'F': '#9a8a74', 'f': '#6b5d4a', 'L': '#c9b89c', 'N': '#4a3e30', 'E': '#7dff8a'},
  'fox': {'F': '#d9772e', 'f': '#9a4a18', 'L': '#f3ead7', 'N': '#5a2e10', 'E': '#ffd23f'},
}
def wolf(frame=0, hell=False):
    c = C(44, 26)
    # queue
    c.poly([(1, 9), (7, 6), (11, 8), (8, 12), (2, 13)], 'F'); c.poly([(0, 11), (3, 10), (4, 13)], 'L')
    c.line(4, 8, 9, 8, 'f')
    legs4(c, frame, 12, 29, 15, 'N', 'F')
    # corps
    c.ell(19, 12, 11, 5.2, 'F'); c.ell(29, 12, 5.5, 5.8, 'F')
    c.recolor('F', 'f', lambda x, y: y <= 8)
    c.recolor('F', 'L', lambda x, y: y >= 16 or (x >= 30 and y >= 12))
    for x in range(11, 31, 3): c.poly([(x, 8), (x + 1, 4 + (x % 2)), (x + 2, 8)], 'f')
    c.ell(12, 13, 4.5, 4.5, 'F'); c.recolor('F', 'f', lambda x, y: y <= 9)
    # tête
    j = 1 if frame == 2 else 0
    c.poly([(29, 7), (34, 4), (38, 5), (42, 8), (43, 10), (38, 11), (32, 12), (28, 11)], 'F')
    c.poly([(32, 5), (33, 0), (36, 5)], 'f'); c.px(34, 3, 'r')
    c.recolor('F', 'L', lambda x, y: x >= 36 and y >= 10)
    c.poly([(35, 11), (42, 11 + j), (36, 13 + j)], 'f')
    c.line(36, 10 + j, 42, 10 + j, 'r')
    for x in (37, 39, 41): c.px(x, 10, 'W'); c.px(x, 11 + j, 'W')
    c.rect(42, 8, 2, 2, 'k')
    c.px(36, 7, 'E'); c.px(37, 7, 'E'); c.px(36, 6, 'k'); c.line(35, 6, 38, 6, 'f')
    if hell:
        for x in range(12, 32, 3): c.poly([(x, 5), (x + 1, 0 + (x // 3) % 3), (x + 2, 5)], 'O' if x % 2 else 'Y')
        for (x0, y0, x1, y1) in [(14, 11, 18, 13), (18, 13, 23, 11), (24, 14, 27, 12)]: c.line(x0, y0, x1, y1, 'O')
    return c.rows()

HOUND_PAL = {**WOLF_PAL, 'F': '#5a2320', 'f': '#2e100e', 'L': '#7a3a30', 'N': '#240c0a', 'E': '#ff4a1a', 'O': '#ff7a1a', 'Y': '#ffd23f'}

def cerberus(frame=0):
    c = C(46, 34)
    rows = wolf(frame, True)
    # deux têtes supplémentaires derrière la principale (dessinées d'abord)
    for (dx, dy) in ((-8, 0), (-3, 3)):
        for y, r in enumerate(rows[0:14]):
            for x, ch in enumerate(r):
                if x >= 30 and ch != ' ': c.px(x + dx, y + dy, ch)
    c.text(0, 8, rows)
    return c.rows()

BOAR_PAL = {'F': '#7a5135', 'f': '#4a2e1c', 'L': '#a07050', 'k': '#140c08', 'E': '#ff3a2a', 'W': '#efe6cf', 'P': '#c98a7a', 'N': '#3a2414'}
BOAR_VAR = {'giant': {'F': '#5e3a22', 'f': '#321c0e', 'L': '#7e5434', 'N': '#24140a'}}
def boar(frame=0):
    c = C(42, 26)
    legs4(c, frame, 11, 28, 16, 'N', 'f', 3)
    c.ell(19, 13, 13, 7.5, 'F'); c.ell(23, 9, 8, 5, 'F')
    c.recolor('F', 'L', lambda x, y: y >= 17)
    for x in range(8, 32, 2): c.line(x, 6 + (x % 4 == 0) * -1, x + 1, 10, 'f')
    c.poly([(9, 7), (12, 3), (15, 6), (18, 2), (21, 5), (24, 1), (27, 5), (30, 3), (31, 8), (9, 9)], 'f')
    # tête en coin
    c.poly([(29, 7), (34, 8), (40, 12), (41, 16), (35, 17), (30, 15)], 'F')
    c.recolor('F', 'f', lambda x, y: x >= 29 and y <= 9)
    c.rect(39, 12, 3, 4, 'P'); c.px(40, 13, 'k'); c.px(40, 15, 'k')
    c.line(36, 16, 39, 10, 'W'); c.px(37, 15, 'W')
    c.poly([(30, 7), (31, 3), (33, 7)], 'f')
    c.px(34, 10, 'E'); c.px(33, 9, 'k'); c.px(35, 9, 'k')
    c.px(4, 12, 'f'); c.line(5, 11, 6, 13, 'f')
    return c.rows()

BEAR_VAR = {'black': {'F': '#2e2a30', 'f': '#17141a', 'L': '#4a444e', 'N': '#0e0c10', 'M': '#8a7a6a'}}
BEAR_PAL = {'F': '#6b4a2e', 'f': '#3e2a18', 'L': '#9a7450', 'k': '#140c08', 'E': '#1a1010', 'W': '#e8dcc0', 'N': '#2e1e10', 'M': '#b08860'}
def bear(frame=0):
    c = C(40, 28)
    legs4(c, frame, 11, 27, 17, 'N', 'f', 3)
    c.ell(18, 14, 13, 8.5, 'F')
    c.recolor('F', 'L', lambda x, y: y >= 19)
    c.recolor('F', 'f', lambda x, y: y <= 8)
    c.ell(31, 11, 6, 5.5, 'F'); c.ell(29, 6, 2, 2, 'f'); c.ell(34, 6, 2, 2, 'f')
    c.ell(37, 13, 3, 2.5, 'M'); c.px(39, 12, 'k'); c.px(40, 12, 'k')
    c.px(33, 10, 'E'); c.px(33, 9, 'W')
    for x in (26, 28, 30): c.px(x, 27, 'W')
    return c.rows()
