# Créatures des héros (rat, slime, squelette archer) et monture du chevalier
from gen import C
from s_beasts import legs4

RAT_VAR = {'field': {'F': '#a87a4e', 'f': '#7a5430', 'L': '#d9b98a', 'E': '#140c10'}}
RAT_PAL = {'F': '#7d7684', 'f': '#55505c', 'L': '#a8a1ae', 'k': '#140c10', 'E': '#ff3d4a', 'P': '#e89aa8', 'W': '#f3ead7'}
def rat(frame=0):
    c = C(28, 14)
    legs4(c, frame, 9, 17, 10, 'f', 'f', 1)
    c.ell(13, 8, 8, 4.2, 'F'); c.ell(13, 10, 6, 2, 'L')
    c.ell(21, 7, 4.2, 3.2, 'F'); c.line(24, 8, 26, 9, 'F')
    c.ell(19, 3.5, 1.8, 1.8, 'f'); c.px(19, 3, 'P')
    c.px(22, 6, 'E'); c.px(26, 9, 'P')
    c.line(25, 10, 27, 11, 'W')
    a = [0, 2, -1][frame % 3]
    c.line(5, 8, 2, 6 + a, 'P'); c.line(2, 6 + a, 0, 2 + a, 'P')
    if frame == 2: c.line(24, 9, 27, 7, 'W')
    return c.rows()

SLIME_VAR = {'cave': {'G': '#7fa8c8', 'g': '#4a6a8a', 'L': '#d0e8ff', 'B': '#5a80a8'}}
SLIME_PAL = {'G': '#58c84a', 'g': '#2f8a2a', 'L': '#b8f0a0', 'k': '#0e1a0c', 'W': '#ffffff', 'B': '#3a9a34'}
def slime(frame=0):
    c = C(22, 18)
    sq = [0, 1, -1][frame % 3]
    c.ell(11, 11 + sq * 0.5, 9.5 + sq, 6.5 - sq, 'G')
    c.rect(2 - sq, 15, 19 + 2 * sq, 2, 'g')
    c.recolor('G', 'g', lambda x, y: y >= 14)
    c.ell(7, 8 + sq * 0.5, 2.2, 1.6, 'L'); c.px(6, 7, 'W')
    c.rect(11, 10, 2, 3, 'k'); c.rect(15, 10, 2, 3, 'k'); c.px(11, 10, 'W'); c.px(15, 10, 'W')
    c.line(12, 14, 15, 14, 'k')
    for (x, y) in ((5, 12), (16, 7)): c.px(x, y + sq, 'B')
    return c.rows()

SKEL_VAR = {'cursed': {'O': '#c8d0b8', 'o': '#7a8a6a', 'E': '#c06bff', 'B': '#4a3a5a', 'b': '#2e2438', 'A': '#9a7ad8'}}
SKEL_PAL = {'O': '#e8e2cf', 'o': '#a89c7e', 'x': '#0a0608', 'E': '#7dffd0', 'B': '#7a5a3a', 'b': '#5a3e24', 'A': '#c9a040', 'S': '#f3ead7'}
def skeleton_archer(frame=0):
    c = C(28, 34)
    st = [0, 1][frame % 2]
    c.line(11, 22, 9 - st, 33, 'O'); c.line(15, 22, 17 + st, 33, 'O')
    c.rect(10, 20, 7, 2, 'o')
    c.line(13, 10, 13, 20, 'o')
    for y in (11, 13, 15, 17): c.line(10, y, 16, y, 'O')
    # carquois dans le dos
    c.rect(5, 9, 3, 10, 'b'); c.px(5, 8, 'A'); c.px(7, 7, 'S'); c.px(6, 7, 'S')
    c.ell(14, 5, 4.5, 4.2, 'O'); c.recolor('O', 'o', lambda x, y: y >= 8 and x <= 13)
    c.rect(13, 4, 2, 2, 'x'); c.rect(16, 4, 2, 2, 'x'); c.px(13, 4, 'E'); c.px(16, 4, 'E')
    c.line(13, 8, 17, 8, 'x'); c.px(14, 8, 'O'); c.px(16, 8, 'O')
    # arc tendu devant lui
    pull = 2 if frame == 2 else 0
    c.line(16, 12, 21, 14, 'O')
    for j in range(-8, 9):
        bx = 23 + round((1 - (j * j) / 64) ** 0.5 * 3)
        c.px(bx, 14 + j, 'B' if j % 3 else 'b')
    c.line(23, 6, 21 - pull, 14, 'S'); c.line(21 - pull, 14, 23, 22, 'S')
    if frame == 2: c.line(16, 14, 26, 14, 'A')
    return c.rows()

HORSE_PAL = {'F': '#8a5a34', 'f': '#5e3a1e', 'L': '#a97a4e', 'M': '#2a1a10', 'k': '#140c08', 'E': '#140c08', 'R': '#b23a48', 'r': '#7a1f2c', 'A': '#f2c14e', 'W': '#f3ead7', 'H': '#3c2a1e'}
def horse(frame=0):
    c = C(50, 34)
    legs4(c, frame, 12, 32, 19, 'f', 'F', 2, 'H')
    c.ell(22, 15, 14, 7, 'F'); c.ell(22, 19, 11, 3, 'L')
    # cou et tête
    c.poly([(30, 12), (36, 3), (41, 2), (38, 14), (33, 18)], 'F')
    c.poly([(38, 2), (46, 6), (47, 9), (44, 10), (38, 8)], 'F')
    c.px(45, 8, 'k'); c.px(41, 4, 'E'); c.line(39, 1, 40, -1, 'F')
    # crinière et queue
    c.line(35, 3, 31, 13, 'M', 2); c.px(37, 1, 'M')
    t = [0, 1][frame % 2]
    c.line(8, 12, 3, 16 + t, 'M', 2); c.line(3, 16 + t, 2, 22 + t, 'M')
    # selle et caparaçon
    c.rect(16, 8, 12, 3, 'R'); c.rect(16, 10, 12, 1, 'r'); c.px(18, 9, 'A'); c.px(25, 9, 'A')
    c.poly([(14, 11), (30, 11), (29, 19), (15, 19)], 'R'); c.recolor('R', 'r', lambda x, y: y >= 17)
    for x in range(16, 29, 3): c.px(x, 18, 'A')
    return c.rows()

# Oiseaux du fauconnier (vue de profil, en vol) : faucon, pigeon (variante), aigle (variante)
BIRD_PAL = {'F': '#8a5a34', 'f': '#5e3a1e', 'H': '#d8c4a0', 'W': '#6e4526', 'w': '#a97a4e', 'Y': '#f2c14e', 'k': '#140c08', 'N': '#c8b090'}
BIRD_VAR = {
  'pigeon': {'F': '#8d96a3', 'f': '#6a7380', 'H': '#6f7a88', 'W': '#b8c0cc', 'w': '#dfe4ea', 'Y': '#e89aa8', 'N': '#5fae8a'},
  'eagle': {'F': '#4a3220', 'f': '#2e1e12', 'H': '#f3ead7', 'W': '#3a2414', 'w': '#6b4a2e', 'Y': '#f2c14e', 'N': '#f3ead7'},
  'crow': {'F': '#2c2c38', 'f': '#17171f', 'H': '#3a3a4a', 'W': '#1f1f29', 'w': '#4a4a5e', 'Y': '#8a8a98', 'k': '#e8e0ff', 'N': '#5a4a7a'},
}
def bird(frame=0):
    c = C(26, 18)
    c.poly([(1, 8), (6, 7), (6, 11), (1, 12)], 'f')
    c.ell(11, 10, 6.5, 3.4, 'F'); c.ell(11, 11, 5, 1.8, 'w')
    c.ell(18, 8, 3.2, 2.8, 'H'); c.px(16, 10, 'N'); c.px(17, 10, 'N')
    c.px(19, 7, 'k'); c.rect(21, 8, 2, 1, 'Y'); c.px(22, 9, 'Y')
    if frame % 2 == 0:
        c.poly([(7, 9), (15, 9), (12, 1), (9, 0)], 'W'); c.line(9, 1, 12, 8, 'w')
    else:
        c.poly([(7, 10), (15, 10), (13, 17), (10, 17)], 'W'); c.line(10, 16, 12, 11, 'w')
    return c.rows()

# Familiers du chenil (mini-jeux) : tortue, lapin, écureuil
TURTLE_PAL = {'S': '#5aa04a', 's': '#3a7a32', 'l': '#8fd070', 'H': '#c9a46a', 'h': '#9a7a46', 'B': '#e8d8a0', 'k': '#140c08'}
def turtle(frame=0):
    c = C(30, 17)
    st = 1 if frame % 2 else 0
    # pattes (arrière en sombre)
    for (x, d) in ((6, st), (18, -st)): c.rect(x + d, 12, 4, 4, 'h')
    # tête et cou (sort davantage pour attaquer)
    hx = 27 if frame == 2 else 25
    c.line(20, 11, hx - 2, 10, 'H', 2); c.ell(hx, 9, 3.6, 2.8, 'H'); c.px(hx + 1, 8, 'k'); c.line(hx + 1, 10, hx + 3, 10, 'h')
    # carapace bombée et bordure
    c.ell(14, 8, 10.5, 6.5, 'S'); c.rect(4, 11, 21, 2, 'B')
    for (x, y) in ((9, 5), (15, 4), (12, 8), (6, 8), (18, 8)): c.ell(x, y, 2.2, 1.6, 's')
    c.px(10, 3, 'l'); c.px(11, 3, 'l'); c.px(9, 4, 'l')
    for (x, d) in ((9, -st), (21, st)): c.rect(x + d, 13, 4, 3, 'H')
    return c.rows()

RABBIT_VAR = {'hare': {'F': '#a8865a', 'f': '#7a5a38', 'L': '#e8d8b8'}}
RABBIT_PAL = {'F': '#d9c8b4', 'f': '#a8947c', 'L': '#f3ead7', 'P': '#e89aa8', 'k': '#140c08', 'W': '#ffffff'}
def rabbit(frame=0):
    c = C(24, 24)
    h = [0, 2, 0][frame % 3]  # petit bond
    y = 2 - h
    c.ell(2, 14 + y, 2.4, 2.4, 'W')                       # queue
    c.ell(10, 16 + y, 7, 5, 'F'); c.ell(11, 18 + y, 4.5, 2.2, 'L')  # corps
    c.ell(5, 18 + y, 3.6, 3, 'f')                         # patte arrière
    c.rect(14, 20 + y, 2, 2, 'f'); c.rect(11, 20 + y, 2, 2, 'f')
    c.line(15, 8 + y, 13, 0 + y, 'F', 2); c.line(18, 8 + y, 18, 0 + y, 'F', 2)   # oreilles
    c.line(14, 6 + y, 13, 2 + y, 'P'); c.line(18, 6 + y, 18, 2 + y, 'P')
    c.ell(17, 11 + y, 4.4, 3.8, 'F')                      # tête
    c.px(18, 10 + y, 'k'); c.px(21, 12 + y, 'P'); c.px(19, 13 + y, 'L'); c.px(20, 13 + y, 'L')
    return c.rows()

SQUIRREL_PAL = {'F': '#c86a2a', 'f': '#8a4518', 'L': '#f0d2a8', 'T': '#d9843a', 't': '#a85a20', 'k': '#140c08', 'N': '#7a5030', 'n': '#c9a46a'}
def squirrel(frame=0):
    c = C(26, 24)
    b = 1 if frame % 2 else 0
    # queue touffue en panache
    c.ell(6, 10, 5.5, 8, 'T'); c.ell(9, 3.5, 4.5, 3.5, 'T')
    c.recolor('T', 't', lambda x, y: x <= 3 or (y >= 14 and x <= 6))
    c.line(5, 4, 4, 12, 't')
    # corps, ventre
    c.ell(14, 17 - b, 5, 5.5, 'F'); c.ell(15, 18 - b, 3, 3.5, 'L')
    # tête, oreille, œil, museau
    c.ell(18, 10 - b, 4, 3.6, 'F'); c.line(16, 7 - b, 16, 4 - b, 'F', 2); c.px(16, 4 - b, 'f')
    c.px(19, 9 - b, 'k'); c.px(22, 11 - b, 'k'); c.px(20, 12 - b, 'L')
    # noisette entre les pattes
    nx = 22 if frame == 2 else 20
    c.ell(nx, 16 - b, 2.2, 2, 'N'); c.px(nx, 14 - b, 'n')
    c.rect(11, 22, 3, 2, 'f'); c.rect(16, 22, 3, 2, 'f')
    return c.rows()
