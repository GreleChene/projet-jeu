from gen import C
WITCH_PAL = {'q': '#0b2a31', 'Q': '#16505a', 'C': '#278b92', 'c': '#4fbdbb', 'I': '#a6f6ee', 'F': '#cdf6f2', 'f': '#8fd0cc', 'e': '#f2fffd', 'z': '#3fb2ac', 'Z': '#d8fffb'}
def witch(frame=0):
    c = C(36, 54, 4)
    sway = [0, 1, 0, -1][frame % 4]
    # voile d'éclats emporté vers l'arrière
    for i, (y, L) in enumerate([(16, 9), (20, 12), (24, 9), (28, 11), (32, 8), (36, 7)]):
        c.poly([(13, y), (13 - L, y + 3 + sway * (1 if i % 2 else -1)), (13 - L + 3, y + 2), (13, y + 4)], 'q' if i % 2 else 'Q')
    # robe en éclats
    robe = [(14, 15), (22, 15), (21, 22), (23, 30), (25, 40), (26, 47), (23, 43), (22, 48), (19, 42), (17, 48), (15, 42), (12, 48), (11, 40), (13, 30), (14, 22)]
    c.poly(robe, 'Q')
    c.recolor('Q', 'C', lambda x, y: x <= 15 + (y - 15) * 0.08 and y < 44)
    c.recolor('Q', 'q', lambda x, y: x >= 21 + (y - 15) * 0.12)
    for (x0, y0, x1, y1) in [(18, 16, 17, 25), (17, 25, 19, 34), (19, 34, 18, 41), (17, 25, 14, 30), (19, 34, 22, 38)]: c.line(x0, y0, x1, y1, 'c')
    for (x, y) in [(18, 18), (17, 23), (18, 29), (19, 35), (15, 29), (21, 37)]: c.px(x, y, 'I')
    c.line(13, 15, 23, 15, 'c'); c.line(14, 16, 22, 16, 'C')
    # mèches de glace vers l'arrière
    for i, (y, L) in enumerate([(8, 8), (10, 10), (12, 7), (14, 9)]):
        c.poly([(15, y), (15 - L, y + 2 - sway), (15, y + 2)], 'C' if i % 2 else 'Q')
    # visage anguleux
    c.poly([(15, 7), (21, 7), (21, 11), (19, 14), (17, 14), (15, 11)], 'F')
    c.recolor('F', 'f', lambda x, y: x <= 16 or y >= 13)
    c.px(18, 10, 'q'); c.px(20, 10, 'q'); c.px(18, 9, 'e'); c.px(20, 9, 'e')
    c.px(19, 12, 'f'); c.line(18, 13, 20, 13, 'q')
    # couronne de pics
    for x, h, col in [(15, 3, 'c'), (16, 6, 'I'), (17, 4, 'c'), (18, 8, 'I'), (19, 4, 'c'), (20, 7, 'I'), (21, 3, 'c')]:
        c.line(x, 6, x, 6 - h, col)
    c.line(15, 6, 21, 6, 'C')
    # lance de glace en diagonale (devant la robe)
    c.line(10, 1, 25, 49, 'z')
    c.poly([(9, 0), (11, -3), (13, 1), (11, 3)], 'Z'); c.px(10, 0, 'I')
    # bras levé et griffes
    c.line(22, 17, 26, 13, 'C', 2); c.line(26, 13, 27, 9, 'C', 2)
    for (x1, y1) in [(29, 5), (30, 7), (30, 9), (27, 5)]: c.line(27, 9, x1, y1, 'I')
    for (x, y) in [(31, 3), (32, 6), (29, 2), (33, 9), (31, 11)][frame % 2::2] + [(30, 4)]: c.px(x, y, 'e')
    return c.rows()

LICH_PAL = {'P': '#3a2638', 'p': '#251722', 'R': '#5a3a56', 'O': '#ddd3b6', 'o': '#a89c7e', 'x': '#0c070c', 'V': '#a8ff5e', 'v': '#5fc23a', 'Y': '#e8ffb0', 'A': '#c09a30', 'a': '#8a6a1a', 'w': '#4a3424', 'n': '#7a6a48', 'm': '#8d8597'}
def lich(frame=0):
    c = C(40, 46)
    fl = [0, -1, -1, 0][frame % 4]
    # bâton à crâne (main arrière)
    c.line(6, 45, 8, 9, 'w', 2)
    c.ell(8, 7, 3, 2.6, 'O'); c.px(7, 7, 'x'); c.px(9, 7, 'x'); c.line(7, 9, 9, 9, 'o')
    for (x, y, ch) in [(8, 4, 'V'), (7, 3, 'V'), (8, 2, 'Y'), (9, 3, 'V'), (8, 1 + fl, 'V'), (7, 1, 'v'), (9, 0 + fl, 'v')]: c.px(x, y, ch)
    # robe massive aux pans déchirés
    robe = [(11, 15), (28, 15), (31, 24), (32, 37), (33, 44), (30, 41), (28, 45), (25, 40), (22, 45), (19, 40), (16, 45), (13, 40), (10, 45), (9, 34), (9, 24)]
    c.poly(robe, 'P')
    c.recolor('P', 'R', lambda x, y: x <= 12 + (y - 15) * 0.02)
    c.recolor('P', 'p', lambda x, y: x >= 28 + (y - 15) * 0.1)
    for x in (14, 19, 24, 28): c.line(x, 30, x + 1, 42, 'p')
    # cage thoracique
    c.ell(20, 23, 4.2, 5.5, 'x')
    for y in (19, 21, 23, 25): c.line(17, y, 23, y, 'O')
    c.line(20, 18, 20, 27, 'o'); c.px(20, 23, 'V'); c.px(21, 22, 'v')
    # ceinture de corde, chaînes
    c.line(9, 30, 32, 30, 'n'); c.px(20, 30, 'A')
    for (x, y) in [(14, 31), (15, 32), (14, 33), (15, 34)]: c.px(x, y, 'm')
    # main arrière sur le bâton
    c.ell(9, 22, 2, 1.6, 'O')
    # épaulières en crânes
    for cx, k in ((11, -1), (28, 1)):
        c.ell(cx, 15, 3.2, 2.6, 'O'); c.px(cx - 1, 15, 'x'); c.px(cx + 1, 15, 'x'); c.line(cx - 1, 17, cx + 1, 17, 'o')
    # capuche rabattue
    c.poly([(13, 4), (26, 4), (27, 15), (12, 15)], 'p')
    # crâne
    c.ell(20, 9, 5, 4.6, 'O')
    c.recolor('O', 'o', lambda x, y: 15 <= x <= 25 and 4 <= y <= 14 and (x <= 16 or y >= 12))
    c.rect(17, 8, 2, 2, 'x'); c.rect(21, 8, 2, 2, 'x'); c.px(18, 8, 'V'); c.px(22, 8, 'V')
    c.px(20, 11, 'x')
    # mâchoire
    j = 1 if frame == 3 else 0
    c.rect(17, 13 + j, 7, 2, 'O'); c.line(17, 13 + j, 23, 13 + j, 'x')
    for x in (17, 19, 21, 23): c.px(x, 13 + j, 'O')
    # couronne d'or ternie
    c.rect(15, 4, 11, 2, 'A'); c.line(15, 5, 25, 5, 'a')
    for x in (15, 18, 21, 24): c.line(x, 3, x + 1, 1, 'A'); c.px(x + 1, 2, 'A')
    c.px(17, 4, 'V'); c.px(23, 4, 'V')
    # bras avant, main osseuse et flamme nécrotique
    c.line(28, 18, 33, 22, 'P', 3)
    for (x1, y1) in [(36, 20), (36, 22), (35, 24)]: c.line(34, 22, x1, y1, 'O')
    fh = [0, 1, 2, 1][frame % 4]
    c.poly([(34, 19), (35.5, 12 - fh), (37, 15), (38, 19), (36, 20)], 'V')
    c.poly([(35, 19), (35.5, 15 - fh), (37, 18)], 'Y')
    # brume au sol
    for i, x in enumerate(range(10, 34, 3)): c.px(x + (frame % 2), 44 - (i % 3), 'v')
    return c.rows()
