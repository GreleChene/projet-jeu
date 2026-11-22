/*
 * Génération déterministe du terrain (partagée serveur / navigateur).
 * Le terrain est une grille de tuiles. Chaque « couche » de biome (givre, corruption, feu)
 * envahit l'écran depuis les bords vers la tour au fil des boss vaincus.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./constants'));
  else root.Terrain = factory(root.GameData);
})(typeof self !== 'undefined' ? self : this, function (GameData) {
  'use strict';
  const { WORLD } = GameData;
  const COLS = Math.ceil(WORLD.W / WORLD.TILE);
  const ROWS = Math.ceil(WORLD.H / WORLD.TILE);

  function hash2(x, y, seed) {
    let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function valueNoise(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = smooth(x - xi), yf = smooth(y - yi);
    const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
    const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * État visuel du terrain d'après la dernière manche terminée.
   * Chaque ère compte 6 boss (manches 5,10,…,30) : chaque boss vaincu fait avancer la couche d'1/6.
   */
  // Partie rapide : le terrain avance à chaque manche (ères de 10 manches, puis chaos à partir de la 30e)
  function terrainStateQuick(cleared, uprooted) {
    const p = (from) => Math.max(0, Math.min(1, (cleared - (from - 1)) / 10));
    return { frost: p(1), poison: p(11), fire: p(21), mix: cleared >= 30, uprooted: !!uprooted };
  }

  function terrainState(cleared, uprooted) {
    const step = (from) => Math.max(0, Math.min(6, Math.floor((Math.min(cleared, from + 29) - (from - 1)) / 5))) / 6;
    return {
      frost: step(1),
      poison: cleared > 30 ? step(31) : 0,
      fire: cleared > 60 ? step(61) : 0,
      mix: cleared >= 90,
      uprooted: !!uprooted
    };
  }

  // Distance « elliptique » normalisée du centre : 0 = tour, ~1 = milieu des bords, ~1.41 = coins
  function tileDepth(tx, ty, seed) {
    const x = (tx + 0.5) * WORLD.TILE, y = (ty + 0.5) * WORLD.TILE;
    const dx = (x - WORLD.CX) / WORLD.CX, dy = (y - WORLD.CY) / WORLD.CY;
    const n = (valueNoise(tx / 4, ty / 4, seed) - 0.5) * 0.3 + (valueNoise(tx / 1.5, ty / 1.5, seed + 99) - 0.5) * 0.08;
    return Math.sqrt(dx * dx + dy * dy) + n;
  }
  function covered(p, d) { return p > 0 && d > 1.08 - p * 1.25; }

  function tileBiome(tx, ty, st, seed) {
    if (st.mix) {
      const n = valueNoise(tx / 7, ty / 7, seed + 555);
      return n < 0.36 ? 'frost' : n < 0.64 ? 'poison' : 'fire';
    }
    if (covered(st.fire, tileDepth(tx, ty, seed + 3000))) return 'fire';
    if (covered(st.poison, tileDepth(tx, ty, seed + 2000))) return 'poison';
    if (covered(st.frost, tileDepth(tx, ty, seed + 1000))) return 'frost';
    return 'prairie';
  }

  function nearTower(tx, ty, r) {
    const x = (tx + 0.5) * WORLD.TILE - WORLD.CX, y = (ty + 0.5) * WORLD.TILE - WORLD.CY;
    return x * x + y * y < r * r;
  }

  // Décor d'une tuile : type « tree » (sapin / chêne / arbre mort / roche brûlée) ou petits détails
  function tileDecor(tx, ty, seed) {
    if (nearTower(tx, ty, 150)) return null;
    // zone des habitations autour de la tour : pas d'arbres ni de rochers (seulement de petits détails)
    const ex = ((tx + 0.5) * WORLD.TILE - WORLD.CX) / 1.35, ey = ((ty + 0.5) * WORLD.TILE - WORLD.CY) / 0.85;
    const inVillage = ex * ex + ey * ey < 420 * 420;
    const h = hash2(tx, ty, seed + 7);
    if (inVillage && h < 0.05) return null;
    if (h < 0.028) return { kind: 'tree', v: hash2(tx, ty, seed + 8), ox: (hash2(tx, ty, seed + 9) - 0.5) * 18, oy: (hash2(tx, ty, seed + 10) - 0.5) * 18 };
    if (h < 0.05) return { kind: 'rock', v: hash2(tx, ty, seed + 8), ox: (hash2(tx, ty, seed + 9) - 0.5) * 20, oy: (hash2(tx, ty, seed + 10) - 0.5) * 20 };
    if (h < 0.4) return { kind: 'small', v: hash2(tx, ty, seed + 8), ox: (hash2(tx, ty, seed + 9) - 0.5) * 24, oy: (hash2(tx, ty, seed + 10) - 0.5) * 24 };
    return null;
  }

  // Positions des sapins (pour la vague « déracinement » de la manche 30)
  function frostTrees(st, seed) {
    const out = [];
    for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
      const d = tileDecor(tx, ty, seed);
      if (d && d.kind === 'tree' && tileBiome(tx, ty, st, seed) === 'frost') {
        out.push({ x: (tx + 0.5) * WORLD.TILE + d.ox, y: (ty + 0.5) * WORLD.TILE + d.oy });
      }
    }
    return out;
  }

  // Points de récolte des paysans (champs, arbres, rochers) autour de la tour
  function resourceNodes(seed) {
    const rnd = mulberry32(seed + 42);
    const types = ['field', 'tree', 'rock'];
    const nodes = [];
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.3;
      // entre les bâtiments et la limite des paysans (500 px de la tour)
      const r = 330 + rnd() * 130;
      nodes.push({ id: i, type: types[i % 3], x: WORLD.CX + Math.cos(a) * r, y: WORLD.CY + Math.sin(a) * r * 0.8 });
    }
    return nodes;
  }

  // Rivières de lave (purement esthétiques)
  function lavaRivers(seed) {
    const rnd = mulberry32(seed + 77);
    const rivers = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + rnd() * 0.8;
      let x = WORLD.CX + Math.cos(a) * 1150, y = WORLD.CY + Math.sin(a) * 700;
      const pts = [[x, y]];
      let dir = a + Math.PI;
      for (let s = 0; s < 26; s++) {
        dir += (rnd() - 0.5) * 0.7;
        x += Math.cos(dir) * 30; y += Math.sin(dir) * 30;
        const dx = x - WORLD.CX, dy = y - WORLD.CY;
        if (dx * dx + dy * dy < 200 * 200) break;
        pts.push([x, y]);
      }
      rivers.push({ w: 8 + rnd() * 8, pts });
    }
    return rivers;
  }

  return { COLS, ROWS, hash2, valueNoise, mulberry32, terrainState, terrainStateQuick, tileDepth, tileBiome, tileDecor, frostTrees, resourceNodes, lavaRivers };
});
