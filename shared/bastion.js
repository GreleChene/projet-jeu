/*
 * Bastion — défense de tour solo sur une carte en cases (onglet « Bastion ») — partagé serveur / page / outils.
 * Tout est déterministe : même graine + mêmes actions = même partie. La page joue la vague en direct, le serveur
 * la rejoue entièrement à partir du même état (et des capacités utilisées, avec leur instant) : c'est lui qui décide.
 *
 * État G (JSON) : carte (cells, path, castle), ressources (res), bâtiments (b), manche gagnée (wave), phase
 *   'build' (construction, sans limite de temps) · 'wave' (vague en cours : G.W) · 'won' (manche 30 gagnée) · 'over' (tour détruite).
 * Cases : 0 herbe · 1 chemin · 2 arbre · 3 rocher · 4 filon d'or · 5 tour principale. Distances en cases, temps en secondes.
 * Actions (phase de construction) : ['b', type, c, r] construire · ['u', id] améliorer · ['s', id, spé] spécialiser
 *   · ['x', id] vendre · ['d', c, r] défricher · ['c'] améliorer la tour principale · ['r'] réparer la tour principale.
 * Capacités (pendant une vague) : [id, c, r, tick] — appliquées au début du pas de simulation « tick ».
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./constants'));
  else root.Bastion = factory(root.GameData);
})(typeof self !== 'undefined' ? self : this, function (GD) {
  'use strict';
  const B = GD.BASTION, COLS = B.COLS, ROWS = B.ROWS, DT = B.TICK;
  const HERBE = 0, CHEMIN = 1, ARBRE = 2, ROCHER = 3, FILON = 4, TOUR = 5;
  const RES = ['or', 'bois', 'pierre'];
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  /* ------------------------------ hasard déterministe ------------------------------ */
  // mulberry32 : l'état (o.rng, entier 32 bits) est gardé dans l'objet, donc dans l'état JSON
  function rand(o) {
    o.rng = (o.rng + 0x6D2B79F5) >>> 0;
    let t = o.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* ------------------------------ carte ------------------------------ */
  const idx = (c, r) => r * COLS + c;
  const inside = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS;
  // distance (en cases, de Tchebychev) à la tour principale (bloc de 2 × 2 cases)
  function castleDist(castle, c, r) {
    const dx = c < castle.c ? castle.c - c : c > castle.c + 1 ? c - castle.c - 1 : 0;
    const dy = r < castle.r ? castle.r - r : r > castle.r + 1 ? r - castle.r - 1 : 0;
    return Math.max(dx, dy);
  }

  /* Carte aléatoire : un chemin sinueux de l'entrée (bord gauche) à la tour principale (2 × 2 cases à droite), qui ne se
   * touche jamais lui-même ; arbres et rochers (en bosquets) selon la zone ; filons d'or (un près de la tour). */
  function genMap(zone, seed) {
    const Z = B.ZONES[zone] || B.ZONES.mine;
    const R = { rng: (hash('carte:' + zone) ^ (seed >>> 0)) >>> 0 };
    const rnd = () => rand(R), ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    let best = null;
    for (let attempt = 0; attempt < 120; attempt++) {
      const cells = new Array(COLS * ROWS).fill(HERBE);
      const castle = { c: COLS - 2, r: ri(1, ROWS - 3) };
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) cells[idx(castle.c + dx, castle.r + dy)] = TOUR;
      const doorC = COLS - 3, doorR = castle.r + ri(0, 1);
      // colonnes des virages, à 2 colonnes d'écart au moins : le chemin ne se touche jamais lui-même
      const turns = [];
      for (let x = ri(1, 3); x <= doorC - 2; x += ri(2, 4)) turns.push(x);
      let c = 0, r = ri(1, ROWS - 2);
      const path = [[0, r]];
      const go = (tc, tr) => { while (c !== tc || r !== tr) { if (c !== tc) c += c < tc ? 1 : -1; else r += r < tr ? 1 : -1; path.push([c, r]); } };
      for (const x of turns) {
        go(x, r);
        let tr = r;
        for (let k = 0; k < 30 && Math.abs(tr - r) < 2; k++) tr = ri(0, ROWS - 1);
        if (Math.abs(tr - r) < 2) tr = r < ROWS / 2 ? r + 2 : r - 2;
        go(x, tr);
      }
      go(doorC, r); go(doorC, doorR);
      if (path.length < 26 || path.length > 46) continue;
      for (const [pc, pr] of path) cells[idx(pc, pr)] = CHEMIN;
      // obstacles (jamais juste autour de la tour, pour pouvoir construire dès le début)
      const free = (cc, rr) => cells[idx(cc, rr)] === HERBE && castleDist(castle, cc, rr) > 1;
      for (let rr = 0; rr < ROWS; rr++) for (let cc = 0; cc < COLS; cc++) {
        if (!free(cc, rr)) continue;
        const p = rnd();
        if (p < Z.obst.arbre) cells[idx(cc, rr)] = ARBRE;
        else if (p < Z.obst.arbre + Z.obst.rocher) cells[idx(cc, rr)] = ROCHER;
      }
      // bosquets et amas de rochers
      for (let pass = 0; pass < 2; pass++) for (let rr = 0; rr < ROWS; rr++) for (let cc = 0; cc < COLS; cc++) {
        if (!free(cc, rr)) continue;
        let tr = 0, ro = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!inside(cc + dx, rr + dy)) continue;
          const v = cells[idx(cc + dx, rr + dy)];
          if (v === ARBRE) tr++; else if (v === ROCHER) ro++;
        }
        if (tr + ro >= 2 && rnd() < 0.3) cells[idx(cc, rr)] = tr >= ro ? ARBRE : ROCHER;
      }
      // filons d'or : le premier dans le territoire de départ, les autres plus loin
      const spots = (lo, hi) => { const out = []; for (let rr = 0; rr < ROWS; rr++) for (let cc = 0; cc < COLS; cc++) { const d = castleDist(castle, cc, rr); if (free(cc, rr) && d >= lo && d <= hi) out.push([cc, rr]); } return out; };
      for (let f = 0; f < Z.obst.filons; f++) {
        const list = f === 0 ? spots(2, B.CASTLE.territory[0]) : spots(B.CASTLE.territory[0] - 1, 99);
        if (!list.length) break;
        const [fc, fr] = list[Math.floor(rnd() * list.length)];
        cells[idx(fc, fr)] = FILON;
      }
      // il faut de la place pour construire près du chemin dans le territoire de départ
      let room = 0;
      const onPath = (cc, rr) => cells[idx(cc, rr)] === CHEMIN;
      for (let rr = 0; rr < ROWS; rr++) for (let cc = 0; cc < COLS; cc++) {
        if (cells[idx(cc, rr)] !== HERBE || castleDist(castle, cc, rr) > B.CASTLE.territory[0]) continue;
        let near = false;
        for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2 && !near; dx++) if (inside(cc + dx, rr + dy) && onPath(cc + dx, rr + dy)) near = true;
        if (near) room++;
      }
      const map = { cells, path, castle };
      if (room >= 10) return map;
      if (!best || room > best.room) best = { ...map, room };
    }
    return { cells: best.cells, path: best.path, castle: best.castle };
  }

  // Géométrie du chemin (mise en cache, jamais enregistrée) : points, longueurs cumulées, ligne de vol
  const GEO = new WeakMap();
  function geo(G) {
    let g = GEO.get(G.path);
    if (g) return g;
    const pts = [[-0.6, G.path[0][1] + 0.5], ...G.path.map(([c, r]) => [c + 0.5, r + 0.5])];
    const last = G.path[G.path.length - 1];
    pts.push([G.castle.c, last[1] + 0.5]); // bord de la tour principale
    const L = [0];
    for (let i = 1; i < pts.length; i++) { const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1]; L.push(L[i - 1] + Math.sqrt(dx * dx + dy * dy)); }
    const fx0 = pts[0][0], fy0 = pts[0][1], fx1 = G.castle.c, fy1 = G.castle.r + 1;
    const fdx = fx1 - fx0, fdy = fy1 - fy0;
    g = { pts, L, total: L[L.length - 1], fly: { x0: fx0, y0: fy0, x1: fx1, y1: fy1, len: Math.sqrt(fdx * fdx + fdy * fdy) } };
    GEO.set(G.path, g);
    return g;
  }
  // position d'un monstre d'après la distance parcourue (sur le chemin, ou en vol direct)
  function place(g, m) {
    if (m.fly) {
      const f = Math.min(1, Math.max(0, m.d / g.fly.len));
      m.x = g.fly.x0 + (g.fly.x1 - g.fly.x0) * f; m.y = g.fly.y0 + (g.fly.y1 - g.fly.y0) * f;
      return;
    }
    const L = g.L, P = g.pts;
    let i = m.seg || 0;
    while (i < L.length - 2 && L[i + 1] < m.d) i++;
    while (i > 0 && L[i] > m.d) i--;
    m.seg = i;
    const a = P[i], b = P[i + 1], f = Math.min(1, Math.max(0, (m.d - L[i]) / (L[i + 1] - L[i] || 1)));
    m.x = a[0] + (b[0] - a[0]) * f; m.y = a[1] + (b[1] - a[1]) * f;
  }
  const progress = (g, m) => m.d / (m.fly ? g.fly.len : g.total);
  // distance parcourue au centre de la case n° i du chemin
  const pathD = (g, i) => g.L[i + 1];

  /* ------------------------------ partie ------------------------------ */
  function newGame(zone, seed, unlocked) {
    if (!B.ZONES[zone]) zone = 'mine';
    const map = genMap(zone, seed);
    return {
      v: 1, zone, seed: seed >>> 0, wave: 0, phase: 'build', infinite: false,
      res: { ...B.START }, cells: map.cells, path: map.path,
      castle: { c: map.castle.c, r: map.castle.r, lvl: 1, hp: B.CASTLE.hp[0] },
      b: [], nid: 1, rng: (hash('vagues') ^ (seed >>> 0)) >>> 0,
      unlocked: (unlocked || []).filter((k) => typeof k === 'string'),
      st: { kills: 0, built: 0, cleared: 0, leaked: 0, gold: 0, syn: 0 }, last: null
    };
  }

  const cellAt = (G, c, r) => (inside(c, r) ? G.cells[idx(c, r)] : -1);
  const bAt = (G, c, r) => G.b.find((b) => b.c === c && b.r === r) || null;
  const byId = (G, id) => G.b.find((b) => b.id === id) || null;
  const castleMax = (G) => B.CASTLE.hp[G.castle.lvl - 1];
  const territory = (G) => B.CASTLE.territory[G.castle.lvl - 1];
  const inTerritory = (G, c, r) => castleDist(G.castle, c, r) <= territory(G);
  const bldgMax = (G) => B.CASTLE.bldgMax[G.castle.lvl - 1];
  const castleCenter = (G) => [G.castle.c + 1, G.castle.r + 1];
  // bâtiment ou spécialisation disponible (de base, ou débloqué avec des plans dans l'atelier)
  function isUnlocked(G, key) {
    const [t, s] = String(key).split('/');
    const T = B.BUILDINGS[t];
    if (!T) return false;
    if (s) return !!T.specs[s] && G.unlocked.includes(key);
    return !T.plan || G.unlocked.includes(t);
  }
  const canPay = (res, cost) => Object.entries(cost || {}).every(([k, n]) => (res[k] || 0) >= n);
  function pay(G, b, cost) {
    for (const [k, n] of Object.entries(cost)) {
      G.res[k] -= n;
      if (b) { b.spent[k] = (b.spent[k] || 0) + n; b.fresh[k] = (b.fresh[k] || 0) + n; }
    }
  }
  function gain(G, add) { for (const [k, n] of Object.entries(add || {})) G.res[k] = (G.res[k] || 0) + n; }

  /* ------------------------------ synergies (bâtiments qui se touchent) ------------------------------ */
  function neighbors(G, b) {
    const out = [];
    for (const [dc, dr] of DIRS) {
      const c = b.c + dc, r = b.r + dr;
      if (!inside(c, r)) continue;
      const nb = bAt(G, c, r);
      out.push(nb ? { b: nb, c, r } : { cell: cellAt(G, c, r), c, r });
    }
    return out;
  }
  function matchA(spec, nb) {
    if (spec[0] === '#') return !nb.b && nb.cell === (spec === '#arbre' ? ARBRE : spec === '#rocher' ? ROCHER : TOUR);
    if (!nb.b) return false;
    if (spec[0] === '@') return B.BUILDINGS[nb.b.t].cat === spec.slice(1);
    const [t, s] = spec.split('/');
    return nb.b.t === t && (!s || nb.b.spec === s);
  }
  const matchB = (spec, b) => (spec[0] === '@' ? B.BUILDINGS[b.t].cat === spec.slice(1) : b.t === spec);
  // bonus reçus par b de ses voisins : [{ name, fx, v, c, r }]
  function synergiesOf(G, b) {
    const out = [], count = {};
    for (const nb of neighbors(G, b)) {
      for (let si = 0; si < B.SYNERGIES.length; si++) {
        const S = B.SYNERGIES[si];
        if (!matchB(S.b, b) || !matchA(S.a, nb)) continue;
        const n = count[si] || 0;
        if (S.max && n >= S.max) continue;
        count[si] = n + 1;
        let v = S.v === undefined ? 1 : S.v;
        if (Array.isArray(v)) v = v[Math.min(v.length, nb.b ? nb.b.lvl : 1) - 1];
        if (nb.b && nb.b.spec && !S.a.includes('/')) { const fx = B.BUILDINGS[nb.b.t].specs[nb.b.spec].fx; if (fx.synMul) v *= fx.synMul; }
        out.push({ name: S.name, fx: S.fx, v, c: nb.c, r: nb.r });
      }
    }
    return out;
  }
  // bonus que b donne à ses voisins (pour l'aperçu de construction) : [{ name, fx, v, c, r }]
  function synergiesGiven(G, b) {
    const out = [];
    for (const nb of neighbors(G, b)) if (nb.b && nb.b !== b) for (const s of synergiesOf(G, nb.b)) if (s.c === b.c && s.r === b.r) out.push({ ...s, c: nb.c, r: nb.r });
    return out;
  }
  // liens actifs entre voisins (dessinés sur la carte) et leur nombre (succès)
  function synLinks(G) {
    const out = [];
    for (const b of G.b) for (const s of synergiesOf(G, b)) out.push({ to: b.id, c: s.c, r: s.r, name: s.name, fx: s.fx });
    return out;
  }

  /* ------------------------------ statistiques réelles d'un bâtiment ------------------------------ */
  function stats(G, b) {
    const T = B.BUILDINGS[b.t], L = T.lv[b.lvl - 1], fx = b.spec ? T.specs[b.spec].fx : {};
    const syn = synergiesOf(G, b);
    const sum = (k) => syn.reduce((a, s) => (s.fx === k ? a + s.v : a), 0);
    const s = { t: b.t, cat: T.cat, lvl: b.lvl, spec: b.spec, syn };
    if (T.cat === 'attaque' && !T.atk.soldiers) {
      s.dmg = L.dmg * (fx.dmgMul || 1) * (1 + sum('dmg'));
      s.cd = (L.cd * (fx.cdMul || 1)) / (1 + sum('rate'));
      s.range = L.range + (fx.range || 0) + sum('range');
      s.splash = L.splash || 0;
      s.air = !!T.atk.air; s.ground = !!T.atk.ground; s.magic = !!T.atk.magic; s.pierce = !!fx.pierce;
      s.crit = fx.crit || 0; s.critMul = fx.critMul || 1;
      s.burn = fx.burn || 0; s.burnDur = fx.burnDur || 0; s.stun = fx.stun || 0;
      s.chain = fx.chain || 0; s.chainMul = fx.chainMul || 0; s.mark = fx.mark || 0; s.markDur = fx.markDur || 0;
      s.proj = T.atk.proj; s.pspd = T.atk.speed;
    } else if (T.atk && T.atk.soldiers) {
      s.soldiers = L.soldiers + (fx.soldiers || 0);
      s.shp = Math.round(L.hp * (fx.hpMul || 1) * (1 + sum('soldierHp')));
      s.sdmg = L.dmg * (fx.dmgMul || 1) * (1 + sum('soldierDmg'));
      s.sarmor = fx.armor || 0; s.range = L.range;
      s.respawn = T.atk.respawn * (1 - Math.min(0.7, sum('respawn'))); s.scd = T.atk.cd;
    }
    if (b.t === 'givre') { s.slow = Math.min(0.75, L.slow + (fx.slow || 0)); s.range = L.range; s.dps = fx.dps || 0; s.freezeEvery = fx.freezeEvery || 0; s.freeze = fx.freeze || 0; }
    if (b.t === 'phare') { s.reveal = L.reveal + (fx.reveal || 0); s.range = s.reveal; s.vuln = fx.vuln || 0; }
    if (b.t === 'sanctuaire') { s.heal = L.heal * (fx.healMul || 1); s.range = L.range; s.castleHeal = Math.round(L.castleHeal * (fx.healMul || 1)); s.castleRegen = fx.castleRegen || 0; s.soldierDmg = fx.soldierDmg || 0; }
    if (b.t === 'barricade') { s.hp = Math.round(L.hp * (fx.hpMul || 1)); s.thorns = fx.thorns || 0; }
    if (b.t === 'ferme') s.castleHeal = Math.round(L.castleHeal * (fx.healMul || 1) * (1 + sum('heal')));
    if (b.t === 'taverne') { s.bounty = L.bounty + (fx.bounty || 0); s.range = L.range + (fx.range || 0); }
    if (b.t === 'banque') { s.rate = L.rate + (fx.rate || 0); s.cap = Math.round(L.cap * (fx.capMul || 1) * (1 + sum('cap'))); }
    if (L.prod) {
      const mul = (fx.prodMul || 1) * (1 + sum('prod'));
      s.prod = {};
      for (const [k, n] of Object.entries(L.prod)) s.prod[k] = n * mul;
      if (T.obstacle) { const k = Object.keys(L.prod)[0]; s.prod[k] += L.perObstacle * sum('obst') * (fx.prodMul || 1); }
      if (fx.perAdj) s.prod.or = (s.prod.or || 0) + fx.perAdj * neighbors(G, b).filter((n) => n.b).length;
      for (const [k, n] of Object.entries(fx.prodAdd || {})) s.prod[k] = (s.prod[k] || 0) + n;
      for (const k of Object.keys(s.prod)) s.prod[k] = Math.round(s.prod[k]);
    }
    return s;
  }
  const castleStats = (G) => ({ dmg: B.CASTLE.dmg[G.castle.lvl - 1], cd: B.CASTLE.cd, range: B.CASTLE.range[G.castle.lvl - 1] });
  // un bâtiment provisoire (aperçu avant construction)
  const ghost = (t, c, r, lvl, spec) => ({ id: -1, t, c, r, lvl: lvl || 1, spec: spec || null, spent: {}, fresh: {} });
  // statistiques d'un bâtiment t s'il était construit en (c, r) (synergies comprises), et ce qu'il donnerait à ses voisins
  function preview(G, t, c, r) {
    const g = ghost(t, c, r);
    G.b.push(g);
    try { return { stats: stats(G, g), given: synergiesGiven(G, g) }; } finally { G.b.pop(); }
  }
  // case du chemin où se postent les soldats d'une caserne (la plus proche, dans sa zone)
  function rallyCell(G, b, range) {
    let best = -1, bd = Infinity;
    G.path.forEach(([c, r], i) => {
      const dx = c - b.c, dy = r - b.r, d = dx * dx + dy * dy;
      if (d <= range * range && d < bd) { bd = d; best = i; }
    });
    return best;
  }

  /* ------------------------------ actions de la phase de construction ------------------------------ */
  function canBuild(G, t, c, r) {
    const T = B.BUILDINGS[t];
    if (!T) return 'Bâtiment inconnu';
    if (!isUnlocked(G, t)) return 'Ce bâtiment n’est pas encore débloqué (atelier des plans)';
    if (!Number.isInteger(c) || !Number.isInteger(r) || !inside(c, r)) return 'Case hors de la carte';
    if (bAt(G, c, r)) return 'Case déjà occupée';
    const cell = cellAt(G, c, r);
    if (cell === TOUR) return 'C’est la tour principale';
    if (!inTerritory(G, c, r)) return 'Hors du territoire : améliore la tour principale pour l’agrandir';
    if (T.path) {
      if (cell !== CHEMIN) return 'Une barricade se construit sur le chemin';
      if (G.b.filter((b) => b.t === 'barricade').length >= B.MAX_BARRICADES) return `${B.MAX_BARRICADES} barricades au plus`;
    } else if (T.filon) {
      if (cell !== FILON) return 'Une mine d’or se construit sur un filon d’or';
    } else if (cell !== HERBE) {
      return cell === CHEMIN ? 'Sur le chemin, seule une barricade peut être construite' : cell === FILON ? 'Ce filon d’or est réservé à une mine d’or' : 'Défriche d’abord cette case';
    }
    if (!canPay(G.res, GD.bastionCost(t, 1))) return 'Pas assez de ressources';
    return null;
  }
  function upgradeError(G, b) {
    if (!b) return 'Bâtiment introuvable';
    if (b.lvl >= 3) return b.spec ? 'Déjà au maximum' : 'Choisis une spécialisation';
    if (b.lvl + 1 > bldgMax(G)) return `Améliore la tour principale pour monter au niveau ${b.lvl + 1}`;
    if (!canPay(G.res, GD.bastionCost(b.t, b.lvl + 1))) return 'Pas assez de ressources';
    return null;
  }
  function specError(G, b, s) {
    if (!b) return 'Bâtiment introuvable';
    const T = B.BUILDINGS[b.t];
    if (!T.specs[s]) return 'Spécialisation inconnue';
    if (b.spec) return 'Déjà spécialisé';
    if (b.lvl < 3) return 'Il faut d’abord le niveau 3';
    if (bldgMax(G) < 4) return 'La tour principale doit être au niveau 3';
    if (!isUnlocked(G, `${b.t}/${s}`)) return 'Spécialisation à débloquer dans l’atelier des plans';
    if (!canPay(G.res, GD.bastionCost(b.t, 4))) return 'Pas assez de ressources';
    return null;
  }
  // remboursement d'une vente : tout ce qui a été payé depuis la dernière vague, 70 % du reste
  function sellValue(b) {
    const out = {};
    for (const k of RES) {
      const all = b.spent[k] || 0, fresh = Math.min(all, b.fresh[k] || 0);
      const v = fresh + Math.floor((all - fresh) * B.SELL);
      if (v > 0) out[k] = v;
    }
    return out;
  }
  function castleUpError(G) {
    if (G.castle.lvl >= B.CASTLE.hp.length) return 'La tour principale est au maximum';
    if (!canPay(G.res, B.CASTLE.cost[G.castle.lvl])) return 'Pas assez de ressources';
    return null;
  }

  function act(G, op) {
    if (!G || G.phase !== 'build') return 'Pas pendant une vague';
    if (!Array.isArray(op)) return 'Action invalide';
    const [a, p1, p2, p3] = op;
    if (a === 'b') {
      const err = canBuild(G, p1, p2, p3);
      if (err) return err;
      const b = { id: G.nid++, t: p1, c: p2, r: p3, lvl: 1, spec: null, spent: {}, fresh: {} };
      pay(G, b, GD.bastionCost(p1, 1));
      if (p1 === 'barricade') b.hp = B.BUILDINGS.barricade.lv[0].hp;
      G.b.push(b);
      G.st.built++;
      return null;
    }
    if (a === 'u') {
      const b = byId(G, p1), err = upgradeError(G, b);
      if (err) return err;
      const before = b.t === 'barricade' ? stats(G, b).hp : 0;
      pay(G, b, GD.bastionCost(b.t, b.lvl + 1));
      b.lvl++;
      if (b.t === 'barricade') b.hp = Math.max(0, b.hp) + stats(G, b).hp - before;
      return null;
    }
    if (a === 's') {
      const b = byId(G, p1), err = specError(G, b, p2);
      if (err) return err;
      const before = b.t === 'barricade' ? stats(G, b).hp : 0;
      pay(G, b, GD.bastionCost(b.t, 4));
      b.spec = p2;
      if (b.t === 'barricade') b.hp = Math.max(0, b.hp) + stats(G, b).hp - before;
      return null;
    }
    if (a === 'x') {
      const b = byId(G, p1);
      if (!b) return 'Bâtiment introuvable';
      gain(G, sellValue(b));
      G.b.splice(G.b.indexOf(b), 1);
      return null;
    }
    if (a === 'd') {
      if (!Number.isInteger(p1) || !Number.isInteger(p2) || !inside(p1, p2)) return 'Case hors de la carte';
      const cell = cellAt(G, p1, p2), C = cell === ARBRE ? B.CLEAR.arbre : cell === ROCHER ? B.CLEAR.rocher : null;
      if (!C) return 'Rien à défricher ici';
      if (!inTerritory(G, p1, p2)) return 'Hors du territoire : améliore la tour principale pour l’agrandir';
      if ((G.res.or || 0) < C.cost) return 'Pas assez d’or';
      G.res.or -= C.cost;
      gain(G, C.gain);
      G.cells[idx(p1, p2)] = HERBE;
      G.st.cleared++;
      return null;
    }
    if (a === 'c') {
      const err = castleUpError(G);
      if (err) return err;
      const before = castleMax(G);
      pay(G, null, B.CASTLE.cost[G.castle.lvl]);
      G.castle.lvl++;
      G.castle.hp += castleMax(G) - before;
      return null;
    }
    if (a === 'r') {
      if (G.castle.hp >= castleMax(G)) return 'La tour principale est intacte';
      if (!canPay(G.res, B.CASTLE.repair.cost)) return 'Pas assez de pierre';
      pay(G, null, B.CASTLE.repair.cost);
      G.castle.hp = Math.min(castleMax(G), G.castle.hp + B.CASTLE.repair.hp);
      return null;
    }
    return 'Action inconnue';
  }
  // Manche 30 gagnée : continuer en mode infini
  function continueInfinite(G) {
    if (G.phase !== 'won') return 'La partie n’est pas gagnée';
    G.phase = 'build'; G.infinite = true;
    return null;
  }

  /* ------------------------------ vagues ------------------------------ */
  // Composition d'une vague : groupes de monstres normaux et de 1 ou 2 types spéciaux ; gardien toutes les 10 manches
  function waveSpec(zone, w, seed) {
    const Z = B.ZONES[zone] || B.ZONES.mine, W = B.WAVES;
    const R = { rng: (hash('vague:' + w) ^ (seed >>> 0)) >>> 0 };
    const rnd = () => rand(R);
    const tier = w <= 10 ? 0 : w <= 20 ? 1 : 2;
    const kindOf = (role) => { const list = Z.roster[role]; return list[Math.min(tier, list.length - 1)]; };
    const pool = Object.keys(Z.roster).filter((k) => k !== 'normal' && B.ROLES[k].from <= w);
    const boss = w % 10 === 0;
    let count = Math.round(W.base + W.per * w + W.quad * w * w);
    if (boss) count = Math.round(count * W.bossShare);
    const special = [];
    const nSpec = Math.min(pool.length, w < 4 ? 1 : rnd() < 0.5 ? 1 : 2);
    for (let i = 0; i < nSpec; i++) special.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    const gap = Math.max(W.gapMin, W.gap - W.gapPer * w);
    const out = [];
    let t = 2, gi = 0;
    while (out.length < count) {
      const role = special.length && gi % 2 === 1 ? special[(gi >> 1) % special.length] : 'normal';
      const n = Math.min(count - out.length, 3 + Math.floor(rnd() * 4));
      for (let i = 0; i < n; i++) {
        out.push({ k: kindOf(role), role, t: Math.round(t / DT) });
        t += gap * (role === 'rapide' ? 0.6 : role === 'blinde' ? 1.4 : 1);
      }
      t += W.groupGap; gi++;
    }
    if (boss) {
      const bk = Z.bosses[(w / 10 - 1) % Z.bosses.length];
      const bt = out.length ? out[Math.floor(out.length * 0.55)].t + 1 : 40;
      out.push({ k: bk, role: 'boss', t: bt });
      out.sort((a, b) => a.t - b.t);
    }
    return out;
  }
  // Aperçu de la prochaine vague : [{ k, role, n }]
  function wavePreview(G, w) {
    const out = [];
    for (const s of waveSpec(G.zone, w || G.wave + 1, G.seed)) {
      const e = out.find((x) => x.k === s.k && x.role === s.role);
      if (e) e.n++; else out.push({ k: s.k, role: s.role, n: 1 });
    }
    return out;
  }
  function hpMul(G, w) { const S = B.SCALE, x = w - 1; return (1 + S.hpLin * x + S.hpQuad * x * x) * (B.ZONES[G.zone] || B.ZONES.mine).hp; }
  function makeMob(G, k, role, o) {
    const W = G.W, S = B.SCALE, x = W.w - 1, opt = o || {};
    const R = role === 'boss' ? B.BOSSES[k] : B.ROLES[role];
    const max = Math.max(1, Math.round(opt.child ? opt.parentMax * B.SPLIT.hp : R.hp * hpMul(G, W.w)));
    const m = {
      id: W.mid++, k, role, boss: role === 'boss', child: !!opt.child, fly: !!(opt.fly !== undefined ? opt.fly : R.fly), stealth: !!R.stealth,
      d: opt.d || 0, x: 0, y: 0, seg: 0, hp: max, max, spd: R.spd * (opt.child ? B.SPLIT.spd : 1), armor: R.armor || 0,
      leak: opt.child ? B.SPLIT.leak : Math.max(1, Math.round(R.leak * (1 + S.leak * x))),
      gold: opt.child || opt.minion ? B.SPLIT.gold : Math.max(1, Math.round(R.gold * (1 + S.gold * x))),
      atk: R.atk * (1 + S.atk * x), split: opt.child ? 0 : R.split || 0, heal: R.heal || 0,
      cd: 0, slowT: 0, slowP: 0, stunT: 0, markT: 0, markP: 0, burnT: 0, burnD: 0, blk: '', aSlow: 0, vuln: 0, seen: !R.stealth, ab: {}, reborn: false
    };
    if (m.boss) for (const [a, v] of Object.entries(R.abil || {})) if (v && v.every) m.ab[a] = v.every;
    if (m.heal) m.ab.heal = 2;
    return m;
  }

  function launch(G) {
    if (!G || G.phase !== 'build') return 'La vague ne peut pas commencer maintenant';
    const g = geo(G), w = G.wave + 1;
    const W = G.W = {
      w, tick: 0, q: waveSpec(G.zone, w, G.seed), qi: 0, mobs: [], proj: [], sol: [],
      bs: G.b.map((b) => stats(G, b)), bcd: G.b.map(() => 0), bst: G.b.map(() => 0), btm: G.b.map(() => 0), bar: G.b.map(() => -1),
      ccd: 0, mid: 1, pid: 1, sid: 1, kills: 0, leaked: 0, gold: 0, abil: {}, enr: false
    };
    for (const b of G.b) b.fresh = {};
    G.b.forEach((b, i) => {
      const s = W.bs[i];
      if (b.t === 'barricade') { const pi = G.path.findIndex(([c, r]) => c === b.c && r === b.r); W.bar[i] = pi >= 0 ? pathD(g, pi) - 0.55 : -1; }
      if (s.soldiers) {
        const pi = rallyCell(G, b, s.range);
        if (pi < 0) return;
        // bonus des sanctuaires « Gardiens » dont la zone couvre le poste des soldats
        let bonus = 0;
        G.b.forEach((o, j) => { const os = W.bs[j]; if (os.soldierDmg && sq(G.path[pi][0] - o.c, G.path[pi][1] - o.r) <= os.range * os.range) bonus = Math.max(bonus, os.soldierDmg); });
        for (let k = 0; k < s.soldiers; k++) W.sol.push({ id: W.sid++, bi: i, k, hp: s.shp, max: s.shp, dmg: s.sdmg * (1 + bonus), armor: s.sarmor, cd: 0, eng: 0, dead: 0, pi, rally: pathD(g, pi) });
      }
    });
    G.phase = 'wave';
    return null;
  }
  const sq = (dx, dy) => dx * dx + dy * dy;
  const d2 = (m, x, y) => sq(m.x - x, m.y - y);

  // Dégâts subis par un monstre (armure, marque, vulnérabilité) ; magic / pierce ignorent l'armure
  function hurt(m, dmg, magic, pierce) {
    if (m.hp <= 0 || dmg <= 0) return 0;
    let d = dmg * (1 + (m.markT > 0 ? m.markP : 0) + (m.vuln || 0));
    if (!magic && !pierce) d *= 1 - m.armor;
    m.hp -= d;
    return d;
  }
  // Capacité de la tour principale (au début du pas « tick ») ; renvoie une erreur ou null
  function useAbility(G, id, c, r, ev) {
    const W = G.W, A = B.ABILITIES[id];
    if (!W || G.phase !== 'wave') return 'Aucune vague en cours';
    if (!A) return 'Capacité inconnue';
    if (G.castle.lvl < A.level) return `Il faut la tour principale niveau ${A.level}`;
    if ((W.abil[id] || 0) > W.tick) return 'Capacité en recharge';
    if (A.target && !(Number.isInteger(c) && Number.isInteger(r) && inside(c, r))) return 'Cible hors de la carte';
    W.abil[id] = W.tick + Math.round(A.cd / DT);
    const x = c + 0.5, y = r + 0.5, cd = B.CASTLE.dmg[G.castle.lvl - 1], rr = (A.radius || 0) * (A.radius || 0);
    if (id === 'pluie' || id === 'colere') { for (const m of W.mobs) if (d2(m, x, y) <= rr) hurt(m, cd * A.dmg, id === 'colere', false); }
    else if (id === 'gel') { for (const m of W.mobs) if (d2(m, x, y) <= rr) m.stunT = Math.max(m.stunT, m.boss ? A.freeze / 2 : A.freeze); }
    else if (id === 'reparation') G.castle.hp = Math.min(castleMax(G), G.castle.hp + Math.round(castleMax(G) * A.heal));
    if (ev) ev.push(['abil', id, A.target ? x : G.castle.c + 1, A.target ? y : G.castle.r + 1, A.radius || 0]);
    return null;
  }

  function pickTarget(W, s, x, y, g) {
    let best = null, bp = -1;
    const r2 = s.range * s.range;
    for (const m of W.mobs) {
      if (m.hp <= 0 || !(m.fly ? s.air : s.ground) || !m.seen) continue;
      if (d2(m, x, y) > r2) continue;
      const p = progress(g, m);
      if (p > bp) { bp = p; best = m; }
    }
    return best;
  }

  // Un pas de simulation (DT) de la vague en cours ; ev (facultatif) reçoit les événements pour l'affichage et les sons
  function step(G, ev) {
    const W = G.W;
    if (!W || G.phase !== 'wave') return;
    const g = geo(G), T = W.tick, mobs = W.mobs;
    // 1. apparitions
    while (W.qi < W.q.length && W.q[W.qi].t <= T) {
      const s = W.q[W.qi++];
      const m = makeMob(G, s.k, s.role);
      place(g, m); mobs.push(m);
      if (ev) ev.push(['spawn', m.id, m.boss ? 1 : 0]);
    }
    if (!W.enr && T * DT >= B.ENRAGE) { W.enr = true; for (const m of mobs) m.blk = ''; if (ev) ev.push(['enrage']); }
    // 2. zones des bâtiments : givre, phare (révélation, vulnérabilité) ; la tour principale révèle aussi
    for (const m of mobs) { m.aSlow = 0; m.vuln = 0; m.seen = !m.stealth; }
    const [ccx, ccy] = castleCenter(G), cs = castleStats(G);
    for (const m of mobs) if (m.stealth && d2(m, ccx, ccy) <= cs.range * cs.range) m.seen = true;
    for (let i = 0; i < G.b.length; i++) {
      const b = G.b[i], s = W.bs[i], x = b.c + 0.5, y = b.r + 0.5;
      if (W.bst[i] > 0) { W.bst[i] -= DT; continue; } // étourdi par un gardien
      if (b.t === 'givre') {
        const r2 = s.range * s.range;
        let target = null, bp = -1;
        for (const m of mobs) {
          if (m.hp <= 0 || d2(m, x, y) > r2) continue;
          m.aSlow = Math.max(m.aSlow, s.slow);
          if (s.dps) hurt(m, s.dps * DT, true, false);
          const p = progress(g, m);
          if (p > bp) { bp = p; target = m; }
        }
        if (s.freezeEvery) {
          W.btm[i] -= DT;
          if (W.btm[i] <= 0 && target) { target.stunT = Math.max(target.stunT, target.boss ? s.freeze / 2 : s.freeze); W.btm[i] = s.freezeEvery; if (ev) ev.push(['freeze', target.id]); }
        }
      } else if (b.t === 'phare') {
        const r2 = s.reveal * s.reveal;
        for (const m of mobs) if (d2(m, x, y) <= r2) { m.seen = true; if (s.vuln) m.vuln = Math.max(m.vuln, s.vuln); }
      } else if (b.t === 'sanctuaire') {
        const r2 = s.range * s.range;
        for (const so of W.sol) { if (so.dead > 0 || so.hp >= so.max) continue; const [pc, pr] = G.path[so.pi]; if (sq(pc - b.c, pr - b.r) <= r2) so.hp = Math.min(so.max, so.hp + s.heal * DT); }
        G.b.forEach((o, j) => { if (o.t === 'barricade' && o.hp > 0 && sq(o.c - b.c, o.r - b.r) <= r2) o.hp = Math.min(W.bs[j].hp, o.hp + s.heal * DT); });
        if (s.castleRegen) G.castle.hp = Math.min(castleMax(G), G.castle.hp + s.castleRegen * DT);
      }
    }
    // 3. monstres : états, capacités, déplacement, attaques des barricades et des soldats
    for (const m of mobs) {
      if (m.hp <= 0) continue;
      if (m.slowT > 0) m.slowT -= DT;
      if (m.markT > 0) m.markT -= DT;
      if (m.burnT > 0) { m.burnT -= DT; hurt(m, m.burnD * DT, true, false); }
      const stunned = m.stunT > 0;
      if (stunned) m.stunT -= DT;
      if (m.heal) { // soigneur : 8 % des PV des monstres proches toutes les 2 s
        m.ab.heal -= DT;
        if (m.ab.heal <= 0) { m.ab.heal = 2; for (const o of mobs) if (o.hp > 0 && d2(o, m.x, m.y) <= 2.25) o.hp = Math.min(o.max, o.hp + o.max * m.heal); if (ev) ev.push(['heal', m.x, m.y]); }
      }
      if (m.boss) bossAbilities(G, m, g, ev);
      if (stunned) continue;
      // bloqué par une barricade ou un soldat : il l'attaque
      if (m.blk) {
        const blocker = blockerOf(G, m.blk);
        if (!blocker) m.blk = '';
        else {
          m.cd -= DT;
          if (blocker.kind === 'b') {
            const s = W.bs[blocker.i];
            if (s.thorns) hurt(m, s.thorns * DT, false, true);
            if (m.cd <= 0) {
              m.cd = 1; blocker.o.hp -= m.atk;
              if (blocker.o.hp <= 0) { blocker.o.hp = 0; for (const o of mobs) if (o.blk === m.blk) o.blk = ''; if (ev) ev.push(['bar', blocker.o.id]); }
            }
          } else if (m.cd <= 0) {
            m.cd = 1; const so = blocker.o;
            so.hp -= m.atk * (1 - so.armor);
            if (so.hp <= 0) { so.hp = 0; so.dead = W.bs[so.bi].respawn; so.eng = 0; m.blk = ''; if (ev) ev.push(['sol', so.id]); }
          }
          if (m.blk) continue;
        }
      }
      let sp = m.spd * (1 - Math.max(m.aSlow, m.slowT > 0 ? m.slowP : 0));
      if (m.ab.chargeT > 0) { m.ab.chargeT -= DT; sp *= B.BOSSES[m.k].abil.charge.mult; }
      if (W.enr) sp *= 2;
      let nd = m.d + sp * DT;
      if (!m.fly && !W.enr) {
        for (let i = 0; i < W.bar.length; i++) {
          const bd = W.bar[i];
          if (bd < 0 || G.b[i].hp <= 0) continue;
          if (m.d <= bd + 1e-9 && nd > bd) { nd = bd; m.blk = 'b' + G.b[i].id; m.cd = Math.min(m.cd, 0.5); break; }
        }
      }
      m.d = nd;
      place(g, m);
      if (m.d >= (m.fly ? g.fly.len : g.total)) { // arrivé à la tour principale
        G.castle.hp -= m.leak; W.leaked++; m.hp = 0; m.leaked = true;
        if (ev) ev.push(['leak', m.id, m.leak, m.x, m.y]);
      }
    }
    // 4. soldats : interceptent les monstres au sol qui passent à leur poste, puis se battent
    for (const so of W.sol) {
      if (so.dead > 0) { so.dead -= DT; if (so.dead <= 0) { so.dead = 0; so.hp = so.max; } continue; }
      if (so.eng) {
        const m = mobs.find((o) => o.id === so.eng);
        if (!m || m.hp <= 0 || m.blk !== 's' + so.id) { so.eng = 0; continue; }
        so.cd -= DT;
        if (so.cd <= 0) { so.cd = 1; hurt(m, so.dmg, false, false); }
        continue;
      }
      if (W.enr) continue;
      for (const m of mobs) {
        if (m.hp <= 0 || m.fly || m.blk || Math.abs(m.d - so.rally) > 0.35) continue;
        so.eng = m.id; m.blk = 's' + so.id; m.cd = Math.min(m.cd, 0.6); so.cd = Math.min(so.cd, 0.3);
        break;
      }
    }
    // 5. tirs des bâtiments d'attaque et de la tour principale
    for (let i = 0; i < G.b.length; i++) {
      const s = W.bs[i];
      if (!s.dmg || W.bst[i] > 0) continue;
      W.bcd[i] -= DT;
      if (W.bcd[i] > 0) continue;
      const b = G.b[i], x = b.c + 0.5, y = b.r + 0.5;
      const m = pickTarget(W, s, x, y, g);
      if (!m) { W.bcd[i] = 0; continue; }
      const crit = s.crit > 0 && rand(G) < s.crit;
      W.proj.push({ id: W.pid++, k: s.proj, x, y, tx: m.id, ex: m.x, ey: m.y, spd: s.pspd, dmg: s.dmg * (crit ? s.critMul : 1), crit, si: i });
      W.bcd[i] = s.cd;
      if (ev) ev.push(['shot', i, s.proj]);
    }
    W.ccd -= DT;
    if (W.ccd <= 0) {
      const m = pickTarget(W, { ...cs, air: true, ground: true }, ccx, ccy, g);
      if (m) { W.proj.push({ id: W.pid++, k: 'bolt', x: ccx, y: ccy - 0.6, tx: m.id, ex: m.x, ey: m.y, spd: 11, dmg: cs.dmg, crit: false, si: -1 }); W.ccd = cs.cd; if (ev) ev.push(['shot', -1, 'bolt']); }
      else W.ccd = 0;
    }
    // 6. projectiles
    for (let pi = W.proj.length - 1; pi >= 0; pi--) {
      const p = W.proj[pi];
      const m = mobs.find((o) => o.id === p.tx && o.hp > 0);
      if (m) { p.ex = m.x; p.ey = m.y; }
      const dx = p.ex - p.x, dy = p.ey - p.y, dist = Math.sqrt(dx * dx + dy * dy), stepLen = p.spd * DT;
      if (dist > stepLen) { p.x += (dx / dist) * stepLen; p.y += (dy / dist) * stepLen; continue; }
      p.x = p.ex; p.y = p.ey;
      W.proj.splice(pi, 1);
      impact(G, p, m, ev);
    }
    // 7. monstres vaincus (or, primes des tavernes, division) et monstres arrivés à la tour
    const born = [];
    for (const m of mobs) {
      if (m.hp > 0 || m.leaked || m.gone) continue;
      const BB = m.boss ? B.BOSSES[m.k] : null;
      if (BB && BB.abil && BB.abil.rebirth && !m.reborn) { m.reborn = true; m.hp = m.max * BB.abil.rebirth; if (ev) ev.push(['rebirth', m.x, m.y]); continue; }
      m.gone = true;
      let gold = m.gold;
      G.b.forEach((b, i) => { const s = W.bs[i]; if (s.bounty && d2(m, b.c + 0.5, b.r + 0.5) <= s.range * s.range) gold += s.bounty; });
      G.res.or += gold; W.gold += gold; W.kills++;
      if (ev) ev.push(['kill', m.id, m.x, m.y, gold, m.k, m.boss ? 1 : 0]);
      for (let k = 0; k < m.split; k++) {
        const c = makeMob(G, m.k, m.role, { child: true, parentMax: m.max, d: Math.max(0, m.d - 0.18 * k), fly: m.fly });
        place(g, c); born.push(c);
      }
      if (m.split && ev) ev.push(['split', m.x, m.y]);
    }
    W.mobs = mobs.filter((m) => m.hp > 0 && !m.leaked).concat(born);
    W.tick++;
    // 8. fin de la vague (ou de la partie)
    if (G.castle.hp <= 0) { lose(G, ev); return; }
    if (T * DT >= B.ENRAGE * 2) { for (const m of W.mobs) { G.castle.hp -= m.leak; W.leaked++; } W.mobs = []; if (G.castle.hp <= 0) { lose(G, ev); return; } }
    if (W.qi >= W.q.length && !W.mobs.length) endWave(G, ev);
  }

  function blockerOf(G, key) {
    const W = G.W, id = Number(key.slice(1));
    if (key[0] === 'b') { const i = G.b.findIndex((b) => b.id === id); return i >= 0 && G.b[i].hp > 0 ? { kind: 'b', i, o: G.b[i] } : null; }
    const so = W.sol.find((s) => s.id === id);
    return so && so.dead <= 0 && so.hp > 0 ? { kind: 's', o: so } : null;
  }

  function impact(G, p, target, ev) {
    const W = G.W;
    if (p.si < 0) { if (target) hurt(target, p.dmg, false, false); if (ev) ev.push(['hit', p.ex, p.ey, p.k, 0]); return; }
    const s = W.bs[p.si];
    const apply = (m, dmg) => {
      hurt(m, dmg, s.magic, s.pierce);
      if (s.burn) { if (m.burnT <= 0) m.burnD = 0; m.burnT = s.burnDur; m.burnD = Math.max(m.burnD, (dmg * s.burn) / s.burnDur); }
      if (s.stun) m.stunT = Math.max(m.stunT, m.boss ? s.stun / 2 : s.stun);
      if (s.mark) { m.markP = Math.max(m.markT > 0 ? m.markP : 0, s.mark); m.markT = s.markDur; }
    };
    if (s.splash) {
      const r2 = s.splash * s.splash;
      for (const m of W.mobs) if (m.hp > 0 && (m.fly ? s.air : s.ground) && d2(m, p.ex, p.ey) <= r2) apply(m, p.dmg);
      if (ev) ev.push(['boom', p.ex, p.ey, s.splash, p.k]);
      return;
    }
    if (!target) return;
    apply(target, p.dmg);
    if (ev) ev.push(['hit', p.ex, p.ey, p.k, p.crit ? 1 : 0]);
    if (s.chain) {
      const hit = [target.id];
      let from = target;
      for (let n = 0; n < s.chain; n++) {
        let next = null, bd = 3.24; // 1,8 case
        for (const m of W.mobs) {
          if (m.hp <= 0 || hit.includes(m.id) || !m.seen || !(m.fly ? s.air : s.ground)) continue;
          const dd = d2(m, from.x, from.y);
          if (dd < bd) { bd = dd; next = m; }
        }
        if (!next) break;
        hurt(next, p.dmg * s.chainMul, true, false);
        if (ev) ev.push(['chain', from.x, from.y, next.x, next.y]);
        hit.push(next.id); from = next;
      }
    }
  }

  function bossAbilities(G, m, g, ev) {
    const A = B.BOSSES[m.k].abil || {}, W = G.W;
    if (A.aura) for (const o of W.mobs) if (o.hp > 0 && d2(o, m.x, m.y) <= A.aura.radius * A.aura.radius) o.hp = Math.min(o.max, o.hp + o.max * A.aura.heal * DT);
    if (A.summon) {
      m.ab.summon -= DT;
      if (m.ab.summon <= 0) {
        m.ab.summon = A.summon.every;
        for (let k = 0; k < A.summon.n; k++) {
          const c = makeMob(G, A.summon.k, A.summon.role, { minion: true, d: Math.max(0, m.d - 0.25 - 0.2 * k), fly: m.fly || !!B.ROLES[A.summon.role].fly });
          if (c.fly && !m.fly) c.d = Math.max(0, progress(g, m) * g.fly.len - 0.2 * k); // un volant invoqué au sol part de là où il est
          place(g, c); W.mobs.push(c);
        }
        if (ev) ev.push(['summon', m.x, m.y]);
      }
    }
    if (A.stomp) {
      m.ab.stomp -= DT;
      if (m.ab.stomp <= 0) {
        m.ab.stomp = A.stomp.every;
        const r2 = A.stomp.radius * A.stomp.radius;
        G.b.forEach((b, i) => { if (W.bs[i].dmg || W.bs[i].slow || W.bs[i].reveal) if (sq(b.c + 0.5 - m.x, b.r + 0.5 - m.y) <= r2) W.bst[i] = Math.max(W.bst[i], A.stomp.stun); });
        if (ev) ev.push(['stomp', m.x, m.y, A.stomp.radius]);
      }
    }
    if (A.charge) {
      m.ab.charge -= DT;
      if (m.ab.charge <= 0) { m.ab.charge = A.charge.every; m.ab.chargeT = A.charge.dur; if (ev) ev.push(['charge', m.id]); }
    }
  }

  // Revenus de fin de vague (or, production, intérêts) et soins de la tour : { inc, heal }
  function income(G, w) {
    const inc = { or: B.WAVE_GOLD[0] + B.WAVE_GOLD[1] * w, bois: 0, pierre: 0 };
    let heal = 0, interest = 0;
    for (const b of G.b) {
      const s = stats(G, b);
      if (s.prod) for (const [k, n] of Object.entries(s.prod)) inc[k] = (inc[k] || 0) + n;
      if (s.castleHeal) heal += s.castleHeal;
      if (s.rate) interest += Math.min(s.cap, Math.floor((G.res.or || 0) * s.rate));
    }
    inc.or += interest;
    return { inc, heal, interest };
  }
  function endWave(G, ev) {
    const W = G.W, w = W.w;
    const { inc, heal, interest } = income(G, w);
    for (const k of RES) G.res[k] = (G.res[k] || 0) + (inc[k] || 0);
    const hp0 = G.castle.hp;
    G.castle.hp = Math.min(castleMax(G), Math.round(G.castle.hp + heal));
    G.b.forEach((b) => { if (b.t === 'barricade') { const mx = stats(G, b).hp; b.hp = Math.min(mx, Math.round(Math.max(0, b.hp) + mx * 0.3)); } });
    G.wave = w;
    G.st.kills += W.kills; G.st.leaked += W.leaked; G.st.gold += W.gold + inc.or;
    G.st.syn = Math.max(G.st.syn || 0, synLinks(G).length);
    G.last = { w, kills: W.kills, leaked: W.leaked, gold: W.gold, inc, interest, heal: G.castle.hp - hp0, ticks: W.tick };
    delete G.W;
    G.phase = !G.infinite && w >= B.WIN_WAVE ? 'won' : 'build';
    if (ev) ev.push(['end', w]);
  }
  function lose(G, ev) {
    const W = G.W;
    G.castle.hp = 0;
    G.st.kills += W.kills; G.st.leaked += W.leaked; G.st.gold += W.gold;
    G.last = { w: W.w, kills: W.kills, leaked: W.leaked, gold: W.gold, inc: null, ticks: W.tick, lost: true };
    G.lostAt = W.w;
    delete G.W;
    G.phase = 'over';
    if (ev) ev.push(['over', G.lostAt]);
  }

  /* Rejoue toute la vague en cours (serveur, outils) avec les capacités [id, c, r, tick] utilisées, dans l'ordre.
   * Renvoie { ticks, used, refused } ; une capacité impossible (recharge, niveau, instant passé) est ignorée. */
  function runWave(G, abil, maxTicks) {
    const list = Array.isArray(abil) ? abil : [];
    let ai = 0, used = 0, refused = 0, ticks = 0;
    const cap = maxTicks || Math.ceil((B.ENRAGE * 2 + 600) / DT);
    while (G.phase === 'wave' && ticks < cap) {
      const T = G.W.tick;
      while (ai < list.length && list[ai][3] <= T) {
        const a = list[ai++];
        if (a[3] === T && !useAbility(G, a[0], a[1], a[2])) used++; else refused++;
      }
      step(G);
      ticks++;
    }
    return { ticks, used, refused: refused + (list.length - ai) };
  }

  // Lecture pour l'interface
  const info = (G) => ({ territory: territory(G), bldgMax: bldgMax(G), castleMax: castleMax(G), castle: castleStats(G), links: synLinks(G) });

  return {
    HERBE, CHEMIN, ARBRE, ROCHER, FILON, TOUR, COLS, ROWS, DT,
    rand, hash, clone, genMap, geo, place, newGame, cellAt, bAt, byId, inside, inTerritory, castleDist, castleMax, territory, bldgMax,
    isUnlocked, canPay, canBuild, upgradeError, specError, sellValue, castleUpError, act, continueInfinite,
    stats, castleStats, synergiesOf, synergiesGiven, synLinks, preview, rallyCell, neighbors,
    waveSpec, wavePreview, hpMul, launch, step, useAbility, runWave, income, info
  };
});
