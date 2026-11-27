'use strict';
const test = require('node:test');
const assert = require('node:assert');
const GD = require('../shared/constants');
const BS = require('../shared/bastion');
const bastion = require('../server/bastion');
const B = GD.BASTION;

const user = (gold = 200) => ({ id: 'u1', pseudo: 'Testeur', cls: 'paladin', level: 5, xp: 0, gold, attrs: GD.emptyAttrs(), skills: {}, inventory: [], equip: {},
  stats: { kills: 0, runs: 0, bestWave: 0, deaths: 0, bossKills: 0 }, mini: { res: { pierre: 0, bois: 0, baies: 0 }, up: {} } });
const grant = (u, xp) => { u.xp += xp; return 0; };
// cases libres (herbe, dans le territoire) qui touchent le chemin
function spotsNearPath(G) {
  const out = [];
  for (const [c, r] of G.path) for (const [dc, dr] of [[0, -1], [0, 1], [1, 0], [-1, 0]]) {
    const cc = c + dc, rr = r + dr;
    if (!BS.canBuild(G, 'archers', cc, rr) && !out.some(([a, b]) => a === cc && b === rr)) out.push([cc, rr]);
  }
  return out;
}
// une partie riche, pour tester les règles sans se soucier du coût
const rich = (zone = 'mine', seed = 1234, unlocked = []) => { const G = BS.newGame(zone, seed, unlocked); G.res = { or: 99999, bois: 9999, pierre: 9999 }; return G; };

test('bastion : cartes aléatoires valides et reproductibles (chemin continu qui ne se touche pas, tour principale, place pour construire)', () => {
  for (const zone of Object.keys(B.ZONES)) for (let s = 1; s <= 60; s++) {
    const seed = s * 104729;
    const m = BS.genMap(zone, seed);
    assert.deepStrictEqual(BS.genMap(zone, seed), m, 'même graine, même carte');
    const p = m.path;
    for (let i = 1; i < p.length; i++) assert.strictEqual(Math.abs(p[i][0] - p[i - 1][0]) + Math.abs(p[i][1] - p[i - 1][1]), 1, 'chemin continu');
    for (let i = 0; i < p.length; i++) for (let j = i + 2; j < p.length; j++) assert.ok(Math.abs(p[i][0] - p[j][0]) + Math.abs(p[i][1] - p[j][1]) > 1, `${zone} ${seed} : le chemin ne se touche pas`);
    assert.strictEqual(p[0][0], 0, 'entrée à gauche');
    const last = p[p.length - 1];
    assert.strictEqual(last[0], m.castle.c - 1, 'le chemin arrive à la tour principale');
    assert.ok(last[1] === m.castle.r || last[1] === m.castle.r + 1);
    const G = BS.newGame(zone, seed, []);
    assert.ok(spotsNearPath(G).length >= 4, 'de la place près du chemin dès le début');
    assert.ok(G.cells.filter((v) => v === BS.FILON).length >= 1, 'au moins un filon d’or');
  }
  assert.notDeepStrictEqual(BS.genMap('mine', 1).path, BS.genMap('mine', 2).path, 'cartes différentes d’une partie à l’autre');
});

test('bastion : construction (territoire, chemin, filon, coût), défrichage contre de l’or, vente remboursée', () => {
  const G = BS.newGame('foret', 777, []);
  const [c, r] = spotsNearPath(G)[0];
  const or0 = G.res.or;
  assert.strictEqual(BS.act(G, ['b', 'archers', c, r]), null);
  assert.strictEqual(G.res.or, or0 - GD.bastionCost('archers', 1).or);
  assert.match(BS.act(G, ['b', 'archers', c, r]), /occupée/);
  assert.match(BS.canBuild(G, 'catapulte', c, r), /débloqué/, 'catapulte à débloquer dans l’atelier');
  const [pc, pr] = G.path[G.path.length - 2];
  assert.match(BS.act(G, ['b', 'archers', pc, pr]), /barricade/, 'sur le chemin : seulement une barricade');
  // hors du territoire
  let far = null;
  for (let rr = 0; rr < B.ROWS && !far; rr++) for (let cc = 0; cc < B.COLS && !far; cc++) if (BS.cellAt(G, cc, rr) === BS.HERBE && !BS.inTerritory(G, cc, rr)) far = [cc, rr];
  assert.match(BS.act(G, ['b', 'archers', far[0], far[1]]), /territoire/);
  // filon : seulement une mine d'or (à débloquer)
  const fi = G.cells.indexOf(BS.FILON), fc = fi % B.COLS, fr = Math.floor(fi / B.COLS);
  if (BS.inTerritory(G, fc, fr)) assert.match(BS.act(G, ['b', 'archers', fc, fr]), /filon/);
  // défricher : coûte de l'or, rapporte du bois, libère la case
  const ti = G.cells.findIndex((v, i) => v === BS.ARBRE && BS.inTerritory(G, i % B.COLS, Math.floor(i / B.COLS)));
  if (ti >= 0) {
    const tc = ti % B.COLS, tr = Math.floor(ti / B.COLS), before = { ...G.res };
    G.res.or = 1;
    assert.match(BS.act(G, ['d', tc, tr]), /or/, 'il faut de l’or');
    G.res.or = before.or;
    assert.strictEqual(BS.act(G, ['d', tc, tr]), null);
    assert.strictEqual(G.res.or, before.or - B.CLEAR.arbre.cost);
    assert.strictEqual(G.res.bois, before.bois + B.CLEAR.arbre.gain.bois);
    assert.strictEqual(BS.cellAt(G, tc, tr), BS.HERBE);
  }
  // vente : tout est rendu tant que la vague n'a pas commencé, 70 % ensuite
  const b = BS.bAt(G, c, r), cost = GD.bastionCost('archers', 1);
  assert.deepStrictEqual(BS.sellValue(b), cost);
  BS.launch(G);
  while (G.phase === 'wave') BS.step(G);
  if (G.phase === 'build') assert.deepStrictEqual(BS.sellValue(BS.bAt(G, c, r)), { or: Math.floor(cost.or * B.SELL), bois: Math.floor(cost.bois * B.SELL) });
});

test('bastion : niveaux plafonnés par la tour principale, spécialisation débloquée par un plan, tour principale (PV, territoire)', () => {
  const G = rich('mine', 99, ['archers/elite']);
  const [c, r] = spotsNearPath(G)[0];
  BS.act(G, ['b', 'archers', c, r]);
  const b = BS.bAt(G, c, r);
  assert.strictEqual(BS.act(G, ['u', b.id]), null, 'niveau 2');
  assert.match(BS.act(G, ['u', b.id]), /tour principale/, 'niveau 3 : il faut la tour principale niveau 2');
  const terr = BS.territory(G), max = BS.castleMax(G);
  assert.strictEqual(BS.act(G, ['c']), null);
  assert.ok(BS.territory(G) > terr && BS.castleMax(G) > max && G.castle.hp === BS.castleMax(G), 'tour principale : plus de PV et de territoire');
  assert.strictEqual(BS.act(G, ['u', b.id]), null, 'niveau 3');
  assert.match(BS.act(G, ['s', b.id, 'elite']), /niveau 3/, 'spécialisation : tour principale niveau 3');
  BS.act(G, ['c']);
  assert.match(BS.act(G, ['s', b.id, 'arbaletes']), /atelier/, 'spécialisation non débloquée');
  const before = BS.stats(G, b).range;
  assert.strictEqual(BS.act(G, ['s', b.id, 'elite']), null);
  assert.ok(BS.stats(G, b).range > before && BS.stats(G, b).crit > 0);
  // réparation
  G.castle.hp = 10;
  assert.strictEqual(BS.act(G, ['r']), null);
  assert.strictEqual(G.castle.hp, 10 + B.CASTLE.repair.hp);
});

test('bastion : synergies entre bâtiments qui se touchent (côté commun seulement)', () => {
  const G = rich('foret', 4242, ['banniere']);
  // trois cases en L : (c, r), (c + 1, r) et (c + 1, r + 1) — on cherche de l'herbe libre dans le territoire
  let spot = null;
  for (let r = 0; r < B.ROWS - 1 && !spot; r++) for (let c = 0; c < B.COLS - 1 && !spot; c++) {
    if ([[c, r], [c + 1, r], [c + 1, r + 1], [c, r + 1]].every(([x, y]) => !BS.canBuild(G, 'archers', x, y))) spot = [c, r];
  }
  assert.ok(spot, 'un carré libre');
  const [c, r] = spot;
  BS.act(G, ['b', 'archers', c, r]);
  const a = BS.bAt(G, c, r), base = BS.stats(G, a).dmg;
  BS.act(G, ['b', 'banniere', c + 1, r + 1]); // en diagonale : pas de synergie
  assert.strictEqual(BS.stats(G, a).dmg, base, 'la diagonale ne compte pas');
  BS.act(G, ['b', 'banniere', c, r + 1]); // côté commun
  assert.ok(BS.stats(G, a).syn.some((x) => x.name === 'Bannière') && BS.stats(G, a).dmg > base, 'bannière : plus de dégâts');
  BS.act(G, ['b', 'archers', c + 1, r]);
  const s = BS.stats(G, a);
  assert.ok(s.syn.some((x) => x.name === 'Garnison') && s.cd < GD.BASTION.BUILDINGS.archers.lv[0].cd, 'deux tours d’archers : garnison');
  assert.ok(BS.synLinks(G).length >= 3);
  // scierie : plus de bois pour chaque arbre qui la touche ; marché entouré de production
  const G2 = rich('foret', 31337);
  let best = null, bn = -1;
  for (let rr = 0; rr < B.ROWS; rr++) for (let cc = 0; cc < B.COLS; cc++) {
    if (BS.canBuild(G2, 'scierie', cc, rr)) continue;
    const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dc, dr]) => BS.cellAt(G2, cc + dc, rr + dr) === BS.ARBRE).length;
    if (n > bn) { bn = n; best = [cc, rr]; }
  }
  const pv = BS.preview(G2, 'scierie', best[0], best[1]).stats.prod.bois;
  assert.strictEqual(pv, B.BUILDINGS.scierie.lv[0].prod.bois + bn * B.BUILDINGS.scierie.lv[0].perObstacle);
});

// joue une partie avec un petit bot ; vérifie à chaque vague que le rejeu (serveur) donne exactement le même état
function botGame(zone, seed, waves) {
  const G = rich(zone, seed, GD.bastionPlanKeys());
  let diverged = 0;
  for (let w = 0; w < waves && G.phase === 'build'; w++) {
    for (const [c, r] of spotsNearPath(G).slice(0, 2)) BS.act(G, ['b', ['archers', 'mage', 'catapulte'][(c + r) % 3], c, r]);
    for (const b of G.b) BS.act(G, ['u', b.id]);
    if (w === 3) BS.act(G, ['c']);
    BS.launch(G);
    const pre = BS.clone(G), used = [];
    while (G.phase === 'wave') {
      if (G.W.tick === 60 && G.castle.lvl >= 2) { const m = G.W.mobs[0]; if (m && !BS.useAbility(G, 'pluie', Math.floor(Math.max(0, m.x)), Math.floor(m.y))) used.push(['pluie', Math.floor(Math.max(0, m.x)), Math.floor(m.y), 60]); }
      BS.step(G);
    }
    BS.runWave(pre, used);
    if (JSON.stringify(pre) !== JSON.stringify(G)) diverged++;
  }
  return { G, diverged };
}

test('bastion : simulation déterministe — la vague rejouée (capacités comprises) donne exactement le même résultat', () => {
  for (const zone of Object.keys(B.ZONES)) {
    const { G, diverged } = botGame(zone, 5000 + zone.length, 12);
    assert.strictEqual(diverged, 0, `${zone} : aucune différence`);
    assert.ok(G.wave >= 5, `${zone} : la partie avance (${G.wave})`);
    assert.ok(G.st.kills > 0);
  }
});

test('bastion : composition des vagues (gardien toutes les 10 manches, types qui arrivent avec les manches)', () => {
  const w1 = BS.waveSpec('mine', 1, 9);
  assert.ok(w1.every((s) => s.role === 'normal'), 'manche 1 : monstres normaux');
  const w10 = BS.waveSpec('mine', 10, 9);
  assert.strictEqual(w10.filter((s) => s.role === 'boss').length, 1);
  assert.strictEqual(w10.find((s) => s.role === 'boss').k, B.ZONES.mine.bosses[0]);
  assert.strictEqual(BS.waveSpec('champ', 30, 9).find((s) => s.role === 'boss').k, B.ZONES.champ.bosses[2]);
  assert.ok(BS.waveSpec('foret', 25, 9).length > w1.length * 3, 'plus de monstres plus tard');
  for (let w = 1; w <= 40; w++) for (const s of BS.waveSpec('foret', w, 3)) assert.ok(s.role === 'boss' || B.ROLES[s.role].from <= w);
  assert.ok(!BS.waveSpec('foret', 30, 3).some((s) => s.role === 'volant'), 'pas de volant dans la forêt');
});

test('bastion (serveur) : 50 Grêlons, actions renvoyées sans doublon, vague rejouée, fin trop rapide refusée, capacité impossible signalée', () => {
  const u = user(120), T = 1e12;
  assert.throws(() => bastion.start(u, 'foret', { now: T }), /Caverne/, 'forêt verrouillée');
  const run = bastion.start(u, 'mine', { now: T, rnd: () => 0.25 });
  assert.strictEqual(u.gold, 70);
  assert.throws(() => bastion.start(u, 'mine', { now: T }), /déjà en cours/);
  const page = BS.clone(run.G);
  const ops = spotsNearPath(page).slice(0, 2).map(([c, r]) => ['b', 'archers', c, r]);
  for (const op of ops) assert.strictEqual(BS.act(page, op), null);
  bastion.applyOps(u, 0, ops.slice(0, 1), T);
  bastion.applyOps(u, 0, ops, T); // la page renvoie tout : la première n'est pas rejouée
  assert.strictEqual(run.nops, 2);
  assert.strictEqual(run.G.b.length, 2);
  assert.throws(() => bastion.applyOps(u, 5, [], T), /désynchronisée/);
  assert.throws(() => bastion.applyOps(u, 2, [['b', 'archers', -1, 0]], T), /hors de la carte/);
  bastion.launch(u, T); BS.launch(page);
  assert.throws(() => bastion.ability(u, ['pluie', 3, 3, 999999], T + 1000), /refusée/, 'instant impossible');
  assert.ok(u.cheat.log.some((l) => l.kind === 'bastion'));
  while (page.phase === 'wave') BS.step(page);
  const r1 = bastion.endWave(u, { now: T + 1000 });
  assert.ok(r1.wait > 0, 'trop tôt : attendre');
  const r2 = bastion.endWave(u, { now: T + 600e3, grantXp: grant });
  assert.ok(r2.ok);
  assert.deepStrictEqual(run.G, page, 'le serveur trouve le même résultat que la page');
  assert.strictEqual(run.xp, GD.bastionXp('mine', 1));
});

test('bastion (serveur) : remboursement à la manche 30, plans et œuf aux gardiens, victoire (zone suivante, plans), mode infini, fin de partie', () => {
  const u = user(100), T = 1e12;
  const run = bastion.start(u, 'mine', { now: T, rnd: () => 0.5 });
  // gardien de la manche 10 vaincu (le serveur rejoue la vague : on rend la tour principale solide)
  run.G.wave = 9; run.G.castle.hp = 1e9;
  bastion.launch(u, T);
  bastion.endWave(u, { now: T + 3600e3, rnd: () => 0 }); // œuf garanti (rnd = 0)
  assert.strictEqual(run.G.wave, 10);
  assert.strictEqual(u.bastion.plans, B.PLANS.boss.mine);
  assert.strictEqual(u.pets.eggs.length, 1, 'œuf de familier');
  assert.strictEqual(u.pets.eggs[0].mode, 'mine');
  // manche 29 gagnée : la manche 30 est atteinte, les Grêlons sont remboursés
  run.G.wave = 28; run.G.castle.hp = 1e9;
  const gold = u.gold;
  bastion.launch(u, T); bastion.endWave(u, { now: T + 7200e3, rnd: () => 0.9 });
  assert.strictEqual(u.gold, gold + B.PRICE);
  assert.ok(run.refunded);
  // manche 30 : victoire
  run.G.castle.hp = 1e9;
  bastion.launch(u, T); bastion.endWave(u, { now: T + 9000e3, rnd: () => 0.9 });
  assert.strictEqual(run.G.phase, 'won');
  assert.strictEqual(u.bastion.wins.mine, 1);
  assert.ok(bastion.zoneOpen(u.bastion, 'foret'), 'la forêt est débloquée');
  assert.strictEqual(u.bastion.plans, 2 * B.PLANS.boss.mine + B.PLANS.firstWin, 'plans : gardiens des manches 10 et 30 + première victoire');
  assert.strictEqual(u.gold, gold + B.PRICE, 'remboursé une seule fois');
  // mode infini puis fin : XP versée, record, succès
  bastion.act(u, 'continue');
  assert.strictEqual(run.G.phase, 'build');
  assert.ok(run.G.infinite);
  const xp = run.xp;
  bastion.act(u, 'victory', { grantXp: grant });
  assert.ok(run.over && run.over.won);
  assert.strictEqual(u.xp, xp);
  assert.strictEqual(u.bastion.best.mine, 30);
  bastion.act(u, 'close');
  assert.strictEqual(u.bastion.run, null);
});

test('bastion (serveur) : atelier des plans (bâtiment puis spécialisation), débloqué aussi dans la partie en cours, classement', () => {
  const u = user(500);
  u.bastion = { plans: 3 };
  bastion.ensure(u);
  assert.throws(() => bastion.unlock(u, 'archers'), /inconnu/, 'bâtiment de base : rien à débloquer');
  assert.throws(() => bastion.unlock(u, 'mage/foudre'), /bâtiment/, 'la spécialisation demande le bâtiment');
  const run = bastion.start(u, 'mine', { now: 1e12 });
  bastion.unlock(u, 'mage');
  assert.strictEqual(u.bastion.plans, 1);
  assert.ok(run.G.unlocked.includes('mage') && BS.isUnlocked(run.G, 'mage'), 'utilisable tout de suite');
  bastion.unlock(u, 'archers/elite');
  assert.strictEqual(u.bastion.plans, 0);
  assert.throws(() => bastion.unlock(u, 'mage/foudre'), /plan/);
  // abandon : les manches gagnées comptent
  bastion.act(u, 'abandon', { grantXp: grant });
  assert.strictEqual(run.over.reason, 'abandon');
  const v = user(); v.id = 'v'; v.pseudo = 'Autre'; v.bastion = { best: { mine: 12 } };
  const w = user(); w.id = 'w'; w.pseudo = 'Meilleur'; w.bastion = { best: { mine: 25 }, wins: {} };
  const L = bastion.ladder([u, v, w]);
  assert.deepStrictEqual(L.mine.map((x) => x.pseudo), ['Meilleur', 'Autre']);
});
