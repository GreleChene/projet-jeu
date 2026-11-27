/* Bastion : dessin en pixel art (cases, obstacles, bâtiments, tour principale, soldats).
 * Chaque sprite est dessiné sur une petite grille de pixels (rectangles entiers), entouré automatiquement du contour
 * #120c0a, puis agrandi sans lissage (×4 : une case = 20 × 20 pixels = 80 px) et mis en cache.
 * Style : pixel art clair et coloré, comme le reste du jeu. */
(function () {
  'use strict';
  const GD = window.GameData, A = window.Art;
  const OL = '#120c0a', CELL = 80, PX = 4;
  const C = {
    wood: ['#5e3a1f', '#8a5a30', '#b07a44', '#d9a95f'],
    stone: ['#5e6672', '#8d96a3', '#b6bec9', '#dfe4ea'],
    red: ['#7a2a26', '#b5413a', '#e0584c', '#ff8a7a'],
    blue: ['#24427a', '#3d6fb5', '#5b8fd9', '#9cc4ff'],
    green: ['#2f5e22', '#4f9a3a', '#7cc35a', '#b4e58a'],
    gold: ['#8a6410', '#d9a520', '#ffd34d', '#fff0a8'],
    purple: ['#3e2a7a', '#7a4fd6', '#a988ff', '#d8c8ff'],
    ice: ['#3a8ac0', '#5ab0e0', '#9fd3ff', '#e8f6ff'],
    fire: ['#b8251a', '#ff7a1a', '#ffd76a'],
    straw: ['#a8822e', '#e2c56a', '#f5e2a0'],
    white: '#f3ead7', cream: '#fff8e8', dark: '#2a1f22', skin: '#f2c29a', steel: ['#6b7480', '#a8b2bf', '#e0e6ee']
  };

  /* ------------------------------ grille de pixels ------------------------------ */
  const CACHE = new Map();
  // Crée (ou reprend du cache) un sprite W × H dessiné par draw(P) ; renvoie un canvas agrandi ×PX (contour compris)
  function sprite(key, W, H, draw, scale) {
    const s = scale || PX, ck = key + '@' + s;
    let c = CACHE.get(ck);
    if (c) return c;
    if (CACHE.size > 900) CACHE.clear();
    const grid = new Array(W * H).fill(null);
    const P = (x, y, w, h, col) => { for (let j = Math.max(0, y); j < Math.min(H, y + h); j++) for (let i = Math.max(0, x); i < Math.min(W, x + w); i++) grid[j * W + i] = col; };
    P.dot = (x, y, col) => P(x, y, 1, 1, col);
    P.clear = (x, y, w, h) => P(x, y, w, h, null);
    // disque plein (pixels dont le centre est dans le cercle)
    P.disc = (cx, cy, r, col) => { for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++) for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) if ((i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 <= r * r) P.dot(i, j, col); };
    // ligne horizontale en dents de scie (toits, flammes)
    P.tri = (x, y, w, h, col) => { for (let k = 0; k < h; k++) { const ins = Math.round((k * w) / (2 * h)); P(x + ins, y + h - 1 - k, w - 2 * ins, 1, col); } };
    draw(P);
    const lo = document.createElement('canvas'); lo.width = W + 2; lo.height = H + 2;
    const x = lo.getContext('2d'), img = x.createImageData(W + 2, H + 2), D = img.data;
    const at = (i, j) => (i >= 1 && j >= 1 && i <= W && j <= H ? grid[(j - 1) * W + (i - 1)] : null);
    for (let j = 0; j < H + 2; j++) for (let i = 0; i < W + 2; i++) {
      let col = at(i, j);
      if (!col && (at(i + 1, j) || at(i - 1, j) || at(i, j + 1) || at(i, j - 1))) col = OL;
      if (!col) continue;
      const n = parseInt(col.slice(1), 16), k = (j * (W + 2) + i) * 4;
      D[k] = (n >> 16) & 255; D[k + 1] = (n >> 8) & 255; D[k + 2] = n & 255; D[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    c = document.createElement('canvas'); c.width = (W + 2) * s; c.height = (H + 2) * s;
    const cx = c.getContext('2d'); cx.imageSmoothingEnabled = false; cx.drawImage(lo, 0, 0, c.width, c.height);
    CACHE.set(ck, c);
    return c;
  }
  // Pose un sprite : pied (bas, centre) en (x, y) écran
  function put(ctx, c, x, y) { ctx.imageSmoothingEnabled = false; ctx.drawImage(c, Math.round(x - c.width / 2), Math.round(y - c.height + PX)); }

  // petits motifs réutilisés
  function bricks(P, x, y, w, h, base, light, dark) {
    P(x, y, w, h, base);
    P(x, y, w, 1, light);
    for (let j = y + 2; j < y + h; j += 2) for (let i = x + ((j / 2) % 2 ? 1 : 3); i < x + w - 1; i += 4) P.dot(i, j, dark);
  }
  function planks(P, x, y, w, h, base, dark) { P(x, y, w, h, base); for (let i = x + 2; i < x + w; i += 3) P(i, y, 1, h, dark); }
  function flag(P, x, y, col, f, len) { P(x, y, 1, 7, C.wood[0]); const L = len || 4; for (let i = 0; i < L; i++) P(x + 1 + i, y + ((i + f) % 2), 1, 3, i === L - 1 ? col[0] : col[1]); }
  function crenel(P, x, y, w, col) { for (let i = x; i < x + w; i += 3) P(i, y, 2, 2, col); }

  /* ------------------------------ bâtiments (20 × 26 pixels ; la case = les 20 lignes du bas) ------------------------------ */
  const W = 20, H = 26;
  const SPEC_COL = (spec) => ({ elite: C.gold, arbaletes: C.steel, feu: C.fire, lourde: C.stone, foudre: C.gold, arcane: C.purple, chevaliers: C.blue, lanciers: C.red, blizzard: C.ice, prison: C.ice, guerre: C.gold, tambours: C.red, vigie: C.blue, signal: C.fire, benediction: C.gold, gardiens: C.blue, pieux: C.wood, rempart: C.stone, bucherons: C.green, negoce: C.gold, taille: C.stone, orpaillage: C.gold, grenier: C.straw, ecuries: C.wood, guilde: C.gold, foire: C.purple, coffre: C.gold, usure: C.green, chasseurs: C.red, fete: C.purple, profond: C.gold, joaillier: C.purple }[spec] || C.gold);

  const DRAW = {
    archers(P, o) {
      bricks(P, 4, 20, 12, 6, C.stone[1], C.stone[2], C.stone[0]);
      planks(P, 6, 11, 8, 9, C.wood[1], C.wood[0]);
      P(6, 14, 8, 1, C.wood[2]); P(9, 16, 2, 3, C.dark); // meurtrière
      P(4, 9, 12, 2, C.wood[2]); P(4, 10, 12, 1, C.wood[1]);
      crenel(P, 4, 7, 12, C.wood[2]);
      // archer sur la plate-forme
      P(9, 5, 2, 2, C.skin); P(8, 7, 4, 2, C.green[1]); P(12, 4, 1, 5, C.wood[0]);
      if (o.lvl >= 2) { P.tri(3, 0, 14, 5, C.red[1]); P.tri(4, 1, 6, 3, C.red[2]); P.clear(8, 5, 4, 2); P(4, 5, 12, 2, C.wood[1]); }
      if (o.lvl >= 3) { P(5, 12, 1, 6, C.gold[1]); P(14, 12, 1, 6, C.gold[1]); }
      if (o.spec === 'elite') { P(9, 0, 2, 1, C.gold[2]); P(8, 17, 4, 2, C.gold[2]); P.dot(9, 17, C.red[1]); P.dot(10, 18, C.red[1]); }
      if (o.spec === 'arbaletes') { P(2, 8, 16, 1, C.steel[1]); P(2, 7, 1, 3, C.steel[0]); P(17, 7, 1, 3, C.steel[0]); P(9, 8, 2, 1, C.steel[2]); }
    },
    catapulte(P, o) {
      const big = o.lvl >= 2 ? 1 : 0;
      P(3, 18, 14, 3, C.wood[1]); P(3, 18, 14, 1, C.wood[2]);
      P.disc(5.5, 22.5, 2.6, C.wood[0]); P.disc(14.5, 22.5, 2.6, C.wood[0]); P.dot(5, 22, C.wood[3]); P.dot(14, 22, C.wood[3]);
      P(8, 12 - big, 2, 7 + big, C.wood[2]); P(11, 12 - big, 2, 7 + big, C.wood[2]); P(8, 13, 5, 1, C.wood[0]);
      // bras incliné et godet
      for (let i = 0; i < 9; i++) P(5 + i, 10 + Math.round(i * 0.45) - big, 1, 2, C.wood[1]);
      P(2, 6 - big, 5, 4, C.wood[0]); P(3, 6 - big, 3, 2, o.spec === 'feu' ? C.fire[1] : C.stone[2]);
      if (o.spec === 'feu') { P(3, 4 - big, 3, 2, C.fire[2]); P.dot(4, 3 - big, C.fire[1]); }
      if (o.spec === 'lourde') P.disc(4.5, 5 - big, 2.4, C.stone[1]);
      if (o.lvl >= 3) { P(3, 18, 14, 1, C.gold[1]); P(15, 13, 1, 5, C.wood[0]); P(16, 13, 3, 2, C.red[1]); }
      P(2, 24, 16, 1, C.stone[1]);
    },
    mage(P, o) {
      const tall = o.lvl >= 2 ? 2 : 0;
      bricks(P, 5, 18, 10, 8, C.stone[2], C.stone[3], C.stone[1]);
      bricks(P, 6, 11 - tall, 8, 7 + tall, C.purple[2], C.purple[3], C.purple[1]);
      P(9, 14, 2, 3, C.dark); P(9, 22, 2, 4, C.purple[0]);
      P.tri(4, 2 - tall, 12, 9, C.purple[1]); P.tri(5, 3 - tall, 5, 7, C.purple[2]);
      P(5, 10 - tall, 10, 1, C.gold[1]);
      if (o.lvl >= 3) { P.dot(10, 1 - tall, C.gold[2]); P(4, 10 - tall, 1, 1, C.gold[2]); P(15, 10 - tall, 1, 1, C.gold[2]); }
      const orb = o.spec === 'foudre' ? C.gold : o.spec === 'arcane' ? C.ice : C.purple;
      P.disc(10, 0.5 - tall + (o.lvl >= 3 ? 0 : 1), 1.6, orb[2]);
      if (o.spec === 'foudre') { P(3, 15, 1, 3, C.gold[2]); P(16, 13, 1, 3, C.gold[2]); }
      if (o.spec === 'arcane') { P(7, 19, 1, 1, C.ice[2]); P(12, 21, 1, 1, C.ice[2]); P(9, 24, 2, 1, C.ice[2]); }
    },
    caserne(P, o) {
      planks(P, 2, 15, 16, 11, C.wood[2], C.wood[1]);
      P(2, 15, 16, 1, C.wood[3]);
      P.tri(1, 7, 18, 8, o.spec === 'chevaliers' ? C.blue[1] : C.red[1]); P.tri(2, 8, 8, 6, o.spec === 'chevaliers' ? C.blue[2] : C.red[2]);
      P(8, 19, 4, 7, C.wood[0]); P(9, 20, 2, 6, C.dark);
      // bouclier sur la façade
      P(4, 17, 3, 4, C.steel[1]); P(5, 18, 1, 2, C.red[1]); P(13, 17, 3, 4, C.steel[1]); P(14, 18, 1, 2, C.red[1]);
      if (o.lvl >= 2) flag(P, 16, 1, C.red, o.f || 0);
      if (o.lvl >= 3) { P(1, 15, 1, 11, C.stone[1]); P(18, 15, 1, 11, C.stone[1]); }
      if (o.spec === 'lanciers') for (let i = 0; i < 3; i++) { P(3 + i * 2, 4, 1, 4, C.wood[0]); P(3 + i * 2, 3, 1, 1, C.steel[2]); }
      if (o.spec === 'chevaliers') { P(3, 4, 4, 3, C.steel[1]); P(4, 5, 2, 1, C.dark); }
    },
    givre(P, o) {
      bricks(P, 6, 20, 8, 6, C.stone[2], C.stone[3], C.stone[1]);
      P(7, 12, 6, 8, C.stone[1]); P(7, 12, 1, 8, C.stone[2]); P(8, 15, 4, 1, C.ice[1]); P(8, 17, 4, 1, C.ice[1]);
      // cristal
      P(8, 4, 4, 8, C.ice[1]); P(9, 2, 2, 2, C.ice[2]); P(8, 4, 1, 7, C.ice[3]); P(11, 5, 1, 6, C.ice[0]);
      if (o.lvl >= 2) { P(5, 7, 2, 4, C.ice[2]); P(13, 7, 2, 4, C.ice[2]); }
      if (o.lvl >= 3) { P(4, 9, 1, 2, C.ice[3]); P(15, 9, 1, 2, C.ice[3]); P(9, 0, 2, 2, C.ice[3]); }
      if (o.spec === 'blizzard') { P(3, 1, 14, 2, C.cream); P(5, 0, 10, 1, C.cream); }
      if (o.spec === 'prison') { P(4, 21, 3, 4, C.ice[2]); P(13, 21, 3, 4, C.ice[2]); }
    },
    banniere(P, o) {
      P(4, 22, 12, 4, C.stone[1]); P(4, 22, 12, 1, C.stone[2]);
      P(9, 2, 2, 20, C.wood[1]); P(9, 2, 1, 20, C.wood[2]); P.disc(10, 1.5, 1.4, C.gold[2]);
      const col = o.spec === 'guerre' ? C.gold : C.red, len = 6 + o.lvl;
      for (let i = 0; i < len; i++) P(11 + Math.min(i, 7), 4 + ((i + (o.f || 0)) % 2), 1, 8 - (i > 5 ? 1 : 0), i % 3 === 2 ? col[0] : col[1]);
      P(12, 6, 3, 3, C.cream); P(13, 7, 1, 1, col[0]);
      if (o.lvl >= 3 || o.spec === 'guerre') P(11, 12, 7, 1, C.gold[1]);
      if (o.spec === 'tambours') { P(2, 18, 6, 5, C.red[1]); P(2, 18, 6, 1, C.cream); P(2, 22, 6, 1, C.cream); P(3, 16, 1, 2, C.wood[0]); P(6, 16, 1, 2, C.wood[0]); }
    },
    phare(P, o) {
      const tall = (o.lvl - 1) * 2;
      for (let j = 0; j < 14 + tall; j++) P(6 + (j > 10 + tall ? 0 : 1), 11 - tall + j, 8 - (j > 10 + tall ? 0 : 2), 1, Math.floor(j / 3) % 2 ? C.red[1] : C.cream);
      P(5, 23, 10, 3, C.stone[1]); P(5, 23, 10, 1, C.stone[2]);
      P(5, 9 - tall, 10, 2, C.dark);
      P(6, 5 - tall, 8, 4, C.gold[2]); P(7, 6 - tall, 6, 2, C.cream);
      P.tri(5, 1 - tall, 10, 4, C.red[1]);
      if (o.spec === 'vigie') { P(13, 6 - tall, 4, 2, C.blue[2]); P(16, 6 - tall, 1, 2, C.steel[2]); }
      if (o.spec === 'signal') { P(7, 2 - tall, 6, 3, C.fire[1]); P(8, 1 - tall, 4, 2, C.fire[2]); }
      P(9, 18, 2, 3, C.dark);
    },
    sanctuaire(P, o) {
      bricks(P, 3, 15, 14, 11, C.cream, '#ffffff', C.stone[2]);
      P.tri(2, 8, 16, 7, C.blue[1]); P.tri(3, 9, 7, 5, C.blue[2]);
      P(8, 19, 4, 7, C.blue[0]); P(9, 20, 2, 6, C.gold[1]);
      P(9, 1, 2, 7, C.gold[2]); P(7, 3, 6, 2, C.gold[2]);
      P(4, 17, 2, 3, C.ice[2]); P(14, 17, 2, 3, C.ice[2]);
      if (o.lvl >= 2) { P(1, 22, 2, 4, C.green[2]); P(17, 22, 2, 4, C.green[2]); }
      if (o.lvl >= 3) { P(7, 0, 6, 1, C.gold[3]); }
      if (o.spec === 'benediction') { P.disc(10, 4, 3, C.gold[3]); P(9, 1, 2, 7, C.gold[2]); P(7, 3, 6, 2, C.gold[2]); }
      if (o.spec === 'gardiens') { P(1, 13, 3, 4, C.steel[1]); P(16, 13, 3, 4, C.steel[1]); }
    },
    barricade(P, o) {
      const stone = o.spec === 'rempart' || o.lvl >= 3;
      if (stone) { bricks(P, 1, 13, 18, 12, C.stone[1], C.stone[2], C.stone[0]); crenel(P, 1, 11, 18, C.stone[2]); }
      else {
        planks(P, 1, 15, 18, 9, C.wood[2], C.wood[1]);
        P(1, 17, 18, 1, C.wood[0]); P(1, 21, 18, 1, C.wood[0]);
        for (let i = 2; i < 19; i += 4) P(i, 12, 2, 3, C.wood[3]);
        if (o.lvl >= 2) { P(0, 23, 20, 2, C.stone[1]); P(0, 23, 20, 1, C.stone[2]); }
      }
      if (o.spec === 'pieux') for (let i = 1; i < 19; i += 3) { P(i, 7, 1, 5, C.wood[1]); P(i, 6, 1, 1, C.steel[2]); }
    },
    scierie(P, o) {
      planks(P, 2, 14, 13, 12, C.wood[2], C.wood[1]);
      P.tri(1, 8, 15, 6, C.wood[0]); P.tri(2, 9, 6, 4, C.wood[1]);
      P(6, 19, 4, 7, C.dark);
      // lame circulaire (tourne)
      P.disc(15.5, 18.5, 3.2, C.steel[1]); P.disc(15.5, 18.5, 1.2, C.steel[0]);
      const f = o.f || 0; P.dot(f % 2 ? 13 : 18, 18, C.steel[2]); P.dot(15, f % 2 ? 16 : 21, C.steel[2]);
      // rondins
      P(0, 23, 6, 3, C.wood[1]); P.dot(0, 24, C.wood[3]); P.dot(3, 24, C.wood[3]); P(13, 23, 7, 3, C.wood[1]); P.dot(19, 24, C.wood[3]);
      if (o.lvl >= 2) P(1, 14, 15, 1, C.green[1]);
      if (o.lvl >= 3) P(11, 3, 2, 6, C.stone[1]);
      if (o.spec === 'bucherons') { P(16, 8, 1, 6, C.wood[0]); P(16, 7, 3, 2, C.steel[1]); }
      if (o.spec === 'negoce') { P.disc(4.5, 5, 2, C.gold[2]); }
    },
    carriere(P, o) {
      P(1, 18, 18, 8, C.stone[0]); P(3, 19, 14, 5, C.stone[1]); P(4, 20, 6, 2, C.stone[0]);
      P(2, 13, 6, 5, C.stone[2]); P(2, 13, 6, 1, C.stone[3]); P(11, 14, 7, 4, C.stone[2]); P(11, 14, 7, 1, C.stone[3]);
      P(7, 9, 5, 4, C.stone[1]); P(7, 9, 5, 1, C.stone[3]);
      // pioche
      P(13, 5, 1, 9, C.wood[1]); P(11, 5, 5, 1, C.steel[1]); P(10, 6, 1, 1, C.steel[1]); P(16, 6, 1, 1, C.steel[1]);
      if (o.lvl >= 2) { P(2, 22, 3, 3, C.wood[2]); P(15, 22, 3, 3, C.wood[2]); }
      if (o.lvl >= 3) { P(6, 3, 3, 6, C.wood[0]); P(5, 2, 5, 1, C.wood[1]); }
      if (o.spec === 'orpaillage' || o.spec === 'taille') P(8, 21, 4, 2, o.spec === 'orpaillage' ? C.gold[2] : C.cream);
    },
    ferme(P, o) {
      planks(P, 6, 13, 12, 10, C.red[1], C.red[0]);
      P(6, 13, 12, 1, C.red[2]); P(10, 17, 4, 6, C.cream); P(11, 18, 2, 5, C.wood[0]);
      P.tri(5, 7, 14, 6, C.wood[0]); P.tri(6, 8, 6, 4, C.wood[1]);
      // blé
      for (let i = 0; i < 6; i++) { P(i, 17 + (i % 2), 1, 7, C.straw[1]); P.dot(i, 16 + (i % 2), C.straw[2]); }
      P(0, 24, 20, 2, C.green[1]);
      if (o.lvl >= 2) { P(17, 18, 3, 6, C.straw[1]); P(17, 18, 3, 1, C.straw[2]); }
      if (o.lvl >= 3) flag(P, 16, 1, C.green, o.f || 0, 3);
      if (o.spec === 'grenier') { P(1, 8, 4, 8, C.wood[2]); P.tri(0, 5, 6, 3, C.red[1]); }
      if (o.spec === 'ecuries') { P(0, 20, 5, 4, C.wood[1]); P(1, 19, 3, 1, C.wood[3]); }
    },
    marche(P, o) {
      P(2, 15, 16, 9, C.wood[2]); P(2, 15, 16, 1, C.wood[3]);
      // auvent rayé
      const aw = o.spec === 'foire' ? C.purple : o.spec === 'guilde' ? C.gold : C.red;
      for (let i = 0; i < 18; i++) P(1 + i, 9, 1, 5, Math.floor(i / 2) % 2 ? aw[1] : C.cream);
      for (let i = 1; i < 19; i += 2) P.dot(i, 14, Math.floor(i / 2) % 2 ? aw[1] : C.cream);
      P(2, 8, 16, 1, aw[0]); P(2, 14, 1, 10, C.wood[0]); P(17, 14, 1, 10, C.wood[0]);
      // étal : fruits et sacs
      P.disc(6, 16.5, 1.5, C.red[2]); P.disc(9, 16.5, 1.5, C.green[2]); P.disc(12, 16.5, 1.5, C.gold[2]); P.disc(15, 16.5, 1.3, C.purple[2]);
      P(4, 19, 4, 5, C.straw[1]); P(12, 19, 4, 5, C.wood[1]); P(12, 19, 4, 1, C.wood[3]);
      P(1, 24, 18, 2, C.stone[1]);
      if (o.lvl >= 2) flag(P, 9, 1, aw, o.f || 0, 3);
      if (o.lvl >= 3) { P.disc(15.5, 5, 2, C.gold[2]); P.dot(15, 5, C.gold[0]); }
    },
    banque(P, o) {
      bricks(P, 2, 13, 16, 13, C.stone[3], '#ffffff', C.stone[2]);
      P.tri(1, 7, 18, 6, C.stone[2]); P(1, 12, 18, 1, C.stone[1]);
      for (const x of [3, 7, 12, 16]) P(x, 14, 1, 10, C.stone[1]);
      P(8, 18, 4, 8, C.wood[0]); P(9, 19, 2, 1, C.gold[2]);
      P.disc(10, 9.5, 2, C.gold[2]); P.dot(10, 9, C.gold[0]);
      P(1, 24, 18, 2, C.stone[2]);
      if (o.lvl >= 2) { P(2, 11, 16, 1, C.gold[1]); }
      if (o.lvl >= 3) { P.disc(4, 21, 1.6, C.gold[2]); P.disc(16, 21, 1.6, C.gold[2]); }
      if (o.spec === 'coffre') { P(13, 20, 5, 5, C.steel[1]); P(15, 22, 1, 1, C.gold[2]); }
      if (o.spec === 'usure') { P(14, 3, 1, 4, C.green[2]); P(15, 2, 1, 5, C.green[2]); P(16, 4, 1, 3, C.green[2]); }
    },
    taverne(P, o) {
      planks(P, 2, 14, 16, 12, C.wood[2], C.wood[1]);
      P(2, 19, 16, 1, C.wood[0]);
      P.tri(1, 6, 18, 8, C.green[1]); P.tri(2, 7, 8, 6, C.green[2]);
      P(8, 20, 4, 6, C.wood[0]); P(4, 16, 3, 3, C.gold[2]); P(13, 16, 3, 3, C.gold[2]);
      // enseigne : chope
      P(15, 4, 1, 5, C.wood[0]); P(15, 4, 4, 1, C.wood[0]); P(16, 6, 3, 4, C.gold[2]); P(16, 6, 3, 1, C.cream); P(19, 7, 1, 2, C.gold[1]);
      P(3, 3, 2, 4, C.stone[1]); P(3, 1, 2, 2, C.stone[2]);
      if (o.lvl >= 3) { P(2, 14, 16, 1, C.red[1]); }
      if (o.spec === 'fete') { for (let i = 2; i < 18; i += 3) P.dot(i, 13, [C.red[2], C.gold[2], C.blue[2]][i % 3]); }
      if (o.spec === 'chasseurs') { P(0, 18, 2, 6, C.wood[0]); P(0, 17, 3, 1, C.steel[2]); }
    },
    mine_or(P, o) {
      P.disc(10, 17, 9, C.stone[1]); P.disc(8, 14, 5, C.stone[2]); P(1, 20, 18, 6, C.stone[1]);
      P(6, 14, 8, 12, C.dark); P(5, 13, 10, 2, C.wood[1]); P(5, 13, 1, 13, C.wood[1]); P(14, 13, 1, 13, C.wood[1]);
      P(7, 21, 6, 1, C.steel[0]); P(7, 24, 6, 1, C.steel[0]);
      // pépites
      P(2, 18, 2, 2, C.gold[2]); P(16, 16, 2, 2, C.gold[2]); P(4, 12, 1, 1, C.gold[3]); P(15, 21, 2, 1, C.gold[2]);
      if (o.lvl >= 2) { P(8, 22, 4, 3, C.wood[2]); P(8, 21, 4, 1, C.gold[2]); }
      if (o.lvl >= 3) { P(9, 7, 2, 6, C.wood[0]); P(7, 7, 6, 1, C.wood[1]); }
      if (o.spec === 'joaillier') { P(16, 10, 2, 2, C.purple[2]); P(2, 9, 2, 2, C.ice[2]); }
      if (o.spec === 'profond') { P(9, 9, 2, 2, C.gold[3]); }
    }
  };
  // Bâtiment au niveau / à la spécialisation donnés ; frame : 0 ou 1 (drapeaux, lame)
  function buildingSprite(t, lvl, spec, frame) {
    const fr = ['caserne', 'banniere', 'scierie', 'ferme', 'marche'].includes(t) ? frame % 2 : 0;
    return sprite(`b:${t}:${lvl}:${spec || ''}:${fr}`, W, H, (P) => DRAW[t](P, { lvl, spec, f: fr }));
  }

  /* ------------------------------ tour principale (40 × 46 pixels : 2 × 2 cases) ------------------------------ */
  const ZCOL = { mine: C.blue, foret: C.green, champ: C.red };
  function castleSprite(lvl, zone, frame) {
    return sprite(`castle:${lvl}:${zone}:${frame % 2}`, 40, 46, (P) => {
      const col = ZCOL[zone] || C.red, f = frame % 2;
      // remparts et porte
      bricks(P, 2, 28, 36, 18, C.stone[2], C.stone[3], C.stone[1]);
      crenel(P, 2, 26, 36, C.stone[2]);
      P(15, 34, 10, 12, C.dark); P(16, 33, 8, 1, C.dark); P(17, 32, 6, 1, C.dark); P(16, 35, 8, 11, C.wood[0]); for (let x = 17; x < 24; x += 2) P(x, 35, 1, 11, C.wood[1]);
      // tours latérales
      bricks(P, 0, 18, 9, 28, C.stone[1], C.stone[2], C.stone[0]); bricks(P, 31, 18, 9, 28, C.stone[1], C.stone[2], C.stone[0]);
      crenel(P, 0, 16, 9, C.stone[1]); crenel(P, 31, 16, 9, C.stone[1]);
      P(3, 24, 3, 4, C.dark); P(34, 24, 3, 4, C.dark);
      if (lvl >= 2) { P.tri(-1, 9, 11, 7, col[1]); P.tri(30, 9, 11, 7, col[1]); P.tri(0, 10, 4, 5, col[2]); P.tri(31, 10, 4, 5, col[2]); }
      // donjon
      const top = lvl >= 3 ? 6 : 10;
      bricks(P, 11, top + 6, 18, 28 - top, C.stone[2], C.stone[3], C.stone[1]);
      crenel(P, 11, top + 4, 18, C.stone[2]);
      P(18, top + 10, 4, 6, C.dark); P(19, top + 10, 2, 1, C.gold[2]);
      P(13, top + 16, 2, 4, C.dark); P(25, top + 16, 2, 4, C.dark);
      if (lvl >= 3) { P.tri(12, top - 6, 16, 10, col[1]); P.tri(13, top - 5, 7, 8, col[2]); }
      // étendards
      P(20, top - (lvl >= 3 ? 12 : 3), 1, lvl >= 3 ? 7 : 7, C.wood[0]);
      for (let i = 0; i < 5; i++) P(21 + i, top - (lvl >= 3 ? 12 : 3) + ((i + f) % 2), 1, 3, i === 4 ? col[0] : col[1]);
      if (lvl >= 4) { P(4, 30, 3, 8, col[1]); P(4, 30, 3, 1, C.gold[2]); P(33, 30, 3, 8, col[1]); P(33, 30, 3, 1, C.gold[2]); P(12, 36, 2, 6, col[1]); P(26, 36, 2, 6, col[1]); }
      if (lvl >= 5) { P(18, top - 14 + (lvl >= 3 ? 0 : 9), 5, 2, C.gold[2]); P(18, top - 15 + (lvl >= 3 ? 0 : 9), 1, 1, C.gold[2]); P(20, top - 15 + (lvl >= 3 ? 0 : 9), 1, 1, C.gold[2]); P(22, top - 15 + (lvl >= 3 ? 0 : 9), 1, 1, C.gold[2]); P(2, 27, 36, 1, C.gold[1]); }
    });
  }

  /* ------------------------------ obstacles ------------------------------ */
  // arbre (selon la zone), rocher, filon d'or ; v : variante 0-2 (taille, couleur)
  function treeSprite(zone, v) {
    if (zone === 'mine') return mushroomSprite(v);
    return sprite(`tree:${zone}:${v}`, 20, 28, (P) => {
      const leaf = zone === 'mine' ? [ '#2f7a6e', '#43a594', '#7fd6c4', '#c8f4ea'] : zone === 'champ' ? ['#3f8f2a', '#5cb83c', '#8fdc5e', '#c9f59a'] : ['#1f5e2a', '#2f7d3a', '#4fa654', '#86d07a'];
      P(8, 18, 4, 9, zone === 'mine' ? '#d8d0c4' : C.wood[1]); P(8, 18, 1, 9, zone === 'mine' ? '#ffffff' : C.wood[2]);
      if (zone === 'foret' && v !== 1) {
        // sapin
        P.tri(2, 10, 16, 9, leaf[1]); P.tri(4, 4, 12, 8, leaf[1]); P.tri(6, 0, 8, 6, leaf[2]);
        P.tri(3, 11, 6, 7, leaf[2]); P(2, 18, 16, 1, leaf[0]);
      } else {
        P.disc(10, 10 - v, 7.5, leaf[1]); P.disc(7, 8 - v, 4, leaf[2]); P.disc(13, 13 - v, 4, leaf[0]); P.dot(6, 6 - v, leaf[3]); P.dot(8, 5 - v, leaf[3]);
        if (zone === 'champ' && v === 2) { P.dot(12, 9, C.red[2]); P.dot(9, 12, C.red[2]); P.dot(14, 7, C.red[2]); }
        if (zone === 'mine') { P.dot(12, 8, leaf[3]); P.dot(9, 13, leaf[3]); }
      }
    });
  }
  // caverne : champignon géant (la « forêt » des profondeurs)
  function mushroomSprite(v) {
    return sprite(`shroom:${v}`, 20, 26, (P) => {
      const cap = [['#2f8a7a', '#43b39e', '#8fe6d2'], ['#7a4fd6', '#a988ff', '#d8c8ff'], ['#c2552e', '#ec7a4a', '#ffc39a']][v];
      P(7, 13, 6, 12, '#efe6d6'); P(7, 13, 1, 12, '#ffffff'); P(12, 13, 1, 12, '#cfc3ae'); P(6, 23, 8, 2, '#e2d6c0');
      P.disc(10, 9, 8.6, cap[1]); P.clear(0, 13, 20, 13); P(2, 12, 16, 2, cap[0]);
      P(7, 13, 6, 2, '#d8cbb4');
      P.disc(7, 5, 2.4, cap[2]); P.dot(12, 4, '#fff8e8'); P.dot(14, 8, '#fff8e8'); P.dot(5, 9, '#fff8e8'); P(9, 7, 2, 2, '#fff8e8');
    });
  }
  function rockSprite(zone, v) {
    return sprite(`rock:${zone}:${v}`, 20, 18, (P) => {
      const s = zone === 'mine' ? ['#6e7a8a', '#93a0b2', '#bcc8d6', '#e6eef6'] : zone === 'foret' ? ['#5c6357', '#7d867a', '#a3ad9e', '#cfd8c8'] : ['#7a7470', '#a39d97', '#c9c3bc', '#ece7e0'];
      P.disc(9, 11, 7 - (v === 2 ? 1 : 0), s[1]); P.disc(7, 9, 4, s[2]); P.dot(5, 7, s[3]); P(2, 15, 15, 2, s[0]);
      if (v >= 1) { P.disc(15.5, 13, 3.5, s[1]); P.dot(14, 11, s[3]); }
      if (zone === 'foret') { P(4, 4, 6, 2, C.green[1]); P(3, 6, 3, 1, C.green[2]); }
      if (zone === 'mine' && v !== 1) { P(13, 3, 2, 6, C.purple[2]); P(15, 5, 1, 4, C.purple[3]); P(12, 6, 1, 3, C.purple[1]); }
    });
  }
  function filonSprite() {
    return sprite('filon', 20, 18, (P) => {
      P.disc(10, 11, 7.5, C.stone[1]); P.disc(8, 9, 4, C.stone[2]); P(2, 15, 16, 2, C.stone[0]);
      P(5, 9, 3, 2, C.gold[2]); P(11, 7, 2, 3, C.gold[2]); P(12, 12, 4, 2, C.gold[2]); P(7, 13, 2, 2, C.gold[1]); P.dot(11, 7, C.gold[3]); P.dot(5, 9, C.gold[3]);
    });
  }

  /* ------------------------------ sol (carte de fond, dessinée une fois) ------------------------------ */
  const GROUND = {
    mine: { base: '#c6ccd8', alt: '#bec5d2', dot: ['#a9b2c2', '#dfe4ec', '#b4a7e8'], path: '#f0d696', pathIn: '#f6e2ae', pathEdge: '#8f6a3e', pathDot: '#d9b871', fog: 'rgba(30,26,52,.30)' },
    foret: { base: '#6fbf4f', alt: '#66b548', dot: ['#5aa33f', '#86d067', '#4f9a3a'], path: '#d9ad6e', pathIn: '#e6c088', pathEdge: '#6e4a26', pathDot: '#c0905a', fog: 'rgba(16,40,20,.32)' },
    champ: { base: '#9fdc5e', alt: '#95d455', dot: ['#86c64a', '#c5ef8a', '#ffd34d'], path: '#f1d898', pathIn: '#f8e7bb', pathEdge: '#9c7444', pathDot: '#dcc184', fog: 'rgba(40,40,20,.26)' }
  };
  function hash2(a, b) { let h = (a * 374761393 + b * 668265263) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  // fond de la carte : sol, chemin, petits détails (fleurs, cailloux), obstacles et tour principale non comprise
  function drawGround(ctx, G) {
    const Z = GROUND[G.zone] || GROUND.mine, COLS = GD.BASTION.COLS, ROWS = GD.BASTION.ROWS;
    const isPath = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS && G.cells[r * COLS + c] === 1;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const x = c * CELL, y = r * CELL;
      ctx.fillStyle = (c + r) % 2 ? Z.base : Z.alt; ctx.fillRect(x, y, CELL, CELL);
      // pixels de détail (herbe, graviers)
      for (let k = 0; k < 10; k++) {
        const h = hash2(c * 31 + k, r * 17 + k * 7), px = Math.floor(h * 20), py = Math.floor(hash2(c + k * 13, r * 3 + k) * 20);
        ctx.fillStyle = Z.dot[k % 3 === 2 && hash2(c, r + k) > 0.8 ? 2 : k % 2]; ctx.fillRect(x + px * PX, y + py * PX, PX, PX);
        if (G.zone !== 'mine' && k < 3) ctx.fillRect(x + px * PX, y + py * PX - PX, PX, PX);
      }
      if (G.zone === 'champ' && hash2(c * 7, r * 11) > 0.72) { // fleurs
        const fx = x + 16 + Math.floor(hash2(c, r) * 12) * PX, fy = y + 16 + Math.floor(hash2(r, c) * 12) * PX, col = ['#ff8ad0', '#ffffff', '#ffd34d', '#9cc4ff'][Math.floor(hash2(c + 3, r) * 4)];
        ctx.fillStyle = col; ctx.fillRect(fx - PX, fy, PX * 3, PX); ctx.fillRect(fx, fy - PX, PX, PX * 3); ctx.fillStyle = '#ffd34d'; ctx.fillRect(fx, fy, PX, PX);
      }
      if (G.zone === 'mine' && hash2(c * 5, r * 13) > 0.8) { ctx.fillStyle = '#b4a7e8'; ctx.fillRect(x + 48, y + 52, PX * 2, PX * 3); ctx.fillStyle = '#e4dcff'; ctx.fillRect(x + 48, y + 52, PX, PX * 2); }
    }
    // chemin : bande claire bordée d'un trait sombre, bien visible
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (!isPath(c, r)) continue;
      const x = c * CELL, y = r * CELL;
      ctx.fillStyle = Z.pathEdge; ctx.fillRect(x, y, CELL, CELL);
      const l = isPath(c - 1, r) || c === 0, rr = isPath(c + 1, r), u = isPath(c, r - 1), d = isPath(c, r + 1);
      const x0 = x + (l ? 0 : PX * 2), x1 = x + CELL - (rr ? 0 : PX * 2), y0 = y + (u ? 0 : PX * 2), y1 = y + CELL - (d ? 0 : PX * 2);
      ctx.fillStyle = Z.path; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.fillStyle = Z.pathIn; ctx.fillRect(x0 + (l ? 0 : PX), y0 + (u ? 0 : PX), x1 - x0 - (l ? 0 : PX) - (rr ? 0 : PX), y1 - y0 - (u ? 0 : PX) - (d ? 0 : PX));
      for (let k = 0; k < 6; k++) { ctx.fillStyle = Z.pathDot; ctx.fillRect(x + 12 + Math.floor(hash2(c * 3 + k, r) * 13) * PX, y + 12 + Math.floor(hash2(c, r * 5 + k) * 13) * PX, PX * (k % 2 + 1), PX); }
    }
    // entrée du chemin (bord gauche)
    const [, r0] = G.path[0];
    ctx.fillStyle = Z.pathIn; ctx.fillRect(0, r0 * CELL + PX * 3, PX * 2, CELL - PX * 6);
  }
  // obstacles (dessinés avec les objets, triés par ligne)
  function drawObstacle(ctx, cell, c, r, zone) {
    const x = c * CELL + CELL / 2, y = (r + 1) * CELL - 6, v = Math.floor(hash2(c * 13, r * 29) * 3);
    if (cell === 2) put(ctx, treeSprite(zone, v), x, y + 2);
    else if (cell === 3) put(ctx, rockSprite(zone, v), x, y - 4);
    else if (cell === 4) put(ctx, filonSprite(), x, y - 4);
  }

  /* ------------------------------ objets animés ------------------------------ */
  function drawBuilding(ctx, b, t) {
    const x = b.c * CELL + CELL / 2, y = (b.r + 1) * CELL - 4;
    A.shadow(ctx, x, y - 2, 30, 8);
    put(ctx, buildingSprite(b.t, b.lvl, b.spec, Math.floor(t * 3)), x, y);
    // lueurs : orbe du mage, lampe du phare, cristal du givre
    const glowAt = (gx, gy, col, r) => { ctx.save(); ctx.translate(gx, gy); ctx.globalAlpha = 0.45 + 0.2 * Math.sin(t * 4 + b.id); A.glow(ctx, col, r); ctx.restore(); };
    if (b.t === 'mage') glowAt(x, y - 100 + (b.lvl >= 2 ? -8 : 0) + (b.lvl >= 3 ? 0 : 4), b.spec === 'foudre' ? '#ffd34d' : b.spec === 'arcane' ? '#9fd3ff' : '#c9a8ff', 12);
    if (b.t === 'phare') glowAt(x, y - 80 - (b.lvl - 1) * 8, '#ffd76a', 16);
    if (b.t === 'givre') glowAt(x, y - 72, '#9fd3ff', 12);
    if (b.t === 'mine_or' || b.spec === 'negoce' || b.spec === 'orpaillage') { const k = Math.floor(t * 2 + b.id) % 4; ctx.fillStyle = '#fff0a8'; ctx.fillRect(x - 28 + k * 14, y - 40 - k * 6, PX, PX); }
    // niveau : petites étoiles sous le bâtiment, couronne pour la spécialisation
    for (let i = 0; i < b.lvl; i++) star(ctx, x - (b.lvl - 1) * 7 + i * 14, y + 1, b.spec ? '#ffd34d' : '#fff8e8');
  }
  function star(ctx, x, y, col) { ctx.fillStyle = OL; ctx.fillRect(x - 4, y - 2, 8, 4); ctx.fillRect(x - 2, y - 4, 4, 8); ctx.fillStyle = col; ctx.fillRect(x - 2, y - 2, 4, 4); ctx.fillRect(x - 1, y - 3, 2, 6); ctx.fillRect(x - 3, y - 1, 6, 2); }
  function drawCastle(ctx, G, t, shake) {
    const x = (G.castle.c + 1) * CELL + (shake ? Math.sin(t * 70) * 3 * shake : 0), y = (G.castle.r + 2) * CELL - 4;
    A.shadow(ctx, x, y - 4, 74, 14);
    put(ctx, castleSprite(G.castle.lvl, G.zone, Math.floor(t * 3)), x, y);
    // dégâts : fumée et flammes selon les PV
    const hp = G.castle.hp / Math.max(1, GD.BASTION.CASTLE.hp[G.castle.lvl - 1]);
    if (hp < 0.6) for (let i = 0; i < (hp < 0.3 ? 3 : 1); i++) {
      const fx = x - 40 + i * 36, fy = y - 110 + i * 12, k = (t * 1.2 + i * 0.37) % 1;
      ctx.fillStyle = `rgba(70,60,60,${0.45 * (1 - k)})`; ctx.fillRect(fx - 8 + k * 6, fy - k * 40, 16 + k * 10, 12 + k * 8);
      if (hp < 0.3) { ctx.fillStyle = k < 0.5 ? '#ff7a1a' : '#ffd76a'; ctx.fillRect(fx - 4, fy + 6, 8, 8); }
    }
  }
  // soldat de la caserne (un petit chevalier)
  function drawSoldier(ctx, x, y, o) {
    A.drawHero(ctx, x, y, { cls: o.knight ? 'chevalier' : 'soldat', look: GD.DEFAULT_LOOK, gear: {}, t: o.t, scale: 0.95, facing: o.facing || 0, moving: !!o.moving, attack: o.attack || 0, seed: o.seed || 0 });
  }
  // icône d'un bâtiment (menus) : le sprite réduit
  function iconCanvas(t, lvl, spec, size) {
    const s = size || 48, c = document.createElement('canvas');
    c.width = s; c.height = s;
    const x = c.getContext('2d'), sp = buildingSprite(t, lvl || 1, spec || null, 0);
    x.imageSmoothingEnabled = false;
    const k = Math.min(s / sp.width, s / sp.height);
    x.drawImage(sp, (s - sp.width * k) / 2, s - sp.height * k, sp.width * k, sp.height * k);
    return c;
  }

  window.BastionArt = { CELL, PX, C, sprite, put, buildingSprite, castleSprite, treeSprite, rockSprite, filonSprite, drawGround, drawObstacle, drawBuilding, drawCastle, drawSoldier, iconCanvas, star, hash2 };
})();
