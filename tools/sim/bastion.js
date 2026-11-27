'use strict';
/*
 * Bastion : un bot joue des parties complètes (moteur shared/bastion.js) et mesure la manche atteinte, les victoires,
 * la durée des vagues et les ressources restantes. Chaque vague est aussi rejouée comme le fait le serveur
 * (même état de départ) pour vérifier que le résultat est identique.
 *   node tools/sim/bastion.js [--zone=champ|foret|mine|tous] [--n=20] [--plans=aucun|zone|tous|catapulte,archers/elite…] [--infini=40] [--detail]
 * Le bot (joueur moyen) : scieries et carrières près des arbres et des rochers, marchés collés à la production,
 * tours sur les cases qui couvrent le plus de chemin, améliorations régulières, tour principale aux manches 4, 9, 15 et 22,
 * phare dès que les camouflés arrivent, quelques barricades, spécialisations dès que possible.
 * Repères : sans plan, la clairière (1re zone) ne se gagne pas ; avec les plans des zones déjà jouées (--plans=zone), chaque
 * zone se gagne parfois, la suivante étant plus difficile que la précédente.
 */
const GD = require('../../shared/constants');
const BS = require('../../shared/bastion');
const { args } = require('./lib');
const A = args();
const B = GD.BASTION;
const ZONES = !A.zone || A.zone === 'tous' ? Object.keys(B.ZONES) : [A.zone];
const N = Number(A.n || 20), UNTIL = Number(A.infini || 0);
// plans : aucun · zone (ceux de la zone et des zones précédentes, une progression normale) · tous · liste (catapulte,archers/elite…)
const ZORDER = Object.keys(B.ZONES);
const unlockedFor = (zone) => (A.plans === 'tous' ? GD.bastionPlanKeys() : A.plans === 'zone' ? ZORDER.slice(0, ZORDER.indexOf(zone) + 1).flatMap((z) => GD.bastionPlanKeys(z)) : A.plans && A.plans !== 'aucun' ? String(A.plans).split(',') : []);

const act = (G, op) => !BS.act(G, op);
const cellsWhere = (G, fn) => { const out = []; for (let r = 0; r < B.ROWS; r++) for (let c = 0; c < B.COLS; c++) if (fn(c, r)) out.push([c, r]); return out; };
const near = (G, c, r, range) => G.path.reduce((n, [pc, pr]) => n + ((pc - c) ** 2 + (pr - r) ** 2 <= range * range ? 1 : 0), 0);
const count = (G, t) => G.b.filter((b) => b.t === t).length;
const adjObst = (G, c, r, cell) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dc, dr]) => BS.cellAt(G, c + dc, r + dr) === cell).length;

// case libre qui maximise score(c, r) (constructible pour ce type)
function bestCell(G, t, score) {
  let best = null, bs = -Infinity;
  for (const [c, r] of cellsWhere(G, (c, r) => !BS.canBuild(G, t, c, r))) { const s = score(c, r); if (s > bs) { bs = s; best = [c, r]; } }
  return best;
}
function build(G, t, score) { const at = bestCell(G, t, score); return at ? act(G, ['b', t, at[0], at[1]]) : false; }

const CASTLE_AT = [0, 4, 9, 15, 22];
const ATK = ['archers', 'catapulte', 'mage'];
function decide(G) {
  const w = G.wave, max = BS.castleMax(G);
  const towers = G.b.filter((b) => ATK.includes(b.t));
  // type de la prochaine tour : catapultes limitées (elles ne touchent pas les volants), mages dès qu'ils sont là
  const fliers = !!B.ZONES[G.zone].roster.volant;
  const nCat = towers.filter((b) => b.t === 'catapulte').length, nMage = towers.filter((b) => b.t === 'mage').length;
  const nextKind = () => (BS.isUnlocked(G, 'mage') && nMage < towers.length / 3 ? 'mage' : BS.isUnlocked(G, 'catapulte') && nCat < towers.length / (fliers ? 5 : 3) ? 'catapulte' : 'archers');
  const kinds = [nextKind()];
  const leaking = G.last ? G.last.leaked : 0;
  const tower = (extraScore) => {
    const t = kinds[0], range = B.BUILDINGS[t].lv[0].range;
    return build(G, t, (c, r) => near(G, c, r, range) + (extraScore ? extraScore(t, c, r) : 0));
  };
  if (G.castle.hp < max * 0.5 && act(G, ['r'])) return true;
  // tour principale aux manches prévues
  const due = G.castle.lvl < 5 && w >= CASTLE_AT[G.castle.lvl];
  if (due && act(G, ['c'])) return true;
  if (towers.length < 2 && tower()) return true;
  // des monstres sont passés : la défense d'abord (tours, puis améliorations), l'économie attendra
  if (leaking >= 3) {
    if (towers.length < 4 + w * 0.6 && tower()) return true;
    const upA = G.b.filter((b) => ATK.includes(b.t) && !BS.upgradeError(G, b)).sort((a, b) => a.lvl - b.lvl);
    if (upA.length && act(G, ['u', upA[0].id])) return true;
  }
  // économie : scieries et carrières près des obstacles, marchés collés à la production
  const farFromPath = (c, r) => -near(G, c, r, 1.6) * 2;
  const wantSaw = (w >= 1) + (w >= 8) + (w >= 16), wantQuarry = (w >= 2) + (w >= 9) + (w >= 17), wantMarket = Math.min(3, (w >= 3) + (w >= 8) + (w >= 14));
  if (count(G, 'scierie') < wantSaw && build(G, 'scierie', (c, r) => adjObst(G, c, r, BS.ARBRE) * 3 + farFromPath(c, r))) return true;
  if (count(G, 'carriere') < wantQuarry && build(G, 'carriere', (c, r) => adjObst(G, c, r, BS.ROCHER) * 3 + farFromPath(c, r))) return true;
  if (count(G, 'marche') < wantMarket && build(G, 'marche', (c, r) => BS.preview(G, 'marche', c, r).stats.prod.or + farFromPath(c, r))) return true;
  if (BS.isUnlocked(G, 'mine_or') && w >= 10 && !leaking && count(G, 'mine_or') < 1 && build(G, 'mine_or', () => 0)) return true;
  if (BS.isUnlocked(G, 'ferme') && count(G, 'ferme') < (w >= 12) + (w >= 20) && build(G, 'ferme', farFromPath)) return true;
  // économiser pour la tour principale pendant 2 manches au plus (sauf si la dernière vague a fait beaucoup de dégâts)
  if (due && leaking <= 3 && w <= CASTLE_AT[G.castle.lvl] + 2 && !BS.canPay(G.res, B.CASTLE.cost[G.castle.lvl])) return false;
  // phare quand les camouflés arrivent
  if (w >= 11 && !count(G, 'phare') && build(G, 'phare', (c, r) => near(G, c, r, 2.6) + BS.preview(G, 'phare', c, r).given.length * 3)) return true;
  if (towers.length < 2 + w * 0.5 && tower((t, c, r) => BS.preview(G, t, c, r).stats.syn.length * 2)) return true;
  if (BS.isUnlocked(G, 'givre') && count(G, 'givre') < Math.floor(towers.length / 6) && build(G, 'givre', (c, r) => near(G, c, r, 1.6))) return true;
  if (BS.isUnlocked(G, 'banniere') && count(G, 'banniere') < Math.floor(towers.length / 5) && build(G, 'banniere', (c, r) => BS.preview(G, 'banniere', c, r).given.length * 10 - near(G, c, r, 1))) return true;
  const ups = G.b.filter((b) => !BS.upgradeError(G, b)).sort((a, b) => (ATK.includes(b.t) - ATK.includes(a.t)) || a.lvl - b.lvl);
  if (ups.length && act(G, ['u', ups[0].id])) return true;
  for (const b of G.b) if (b.lvl === 3 && !b.spec) for (const s of Object.keys(B.BUILDINGS[b.t].specs)) if (act(G, ['s', b.id, s])) return true;
  if (w >= 7 && count(G, 'barricade') < 2 && build(G, 'barricade', (c, r) => G.b.filter((b) => ATK.includes(b.t) && (b.c - c) ** 2 + (b.r - r) ** 2 <= 9).length)) return true;
  if (towers.length < 6 + w * 0.8 && tower()) return true;
  // défricher pour faire de la place près du chemin
  const clear = cellsWhere(G, (c, r) => [BS.ARBRE, BS.ROCHER].includes(BS.cellAt(G, c, r)) && BS.inTerritory(G, c, r) && near(G, c, r, 1.5) >= 3);
  if (clear.length && (G.res.or || 0) > 250 && act(G, ['d', clear[0][0], clear[0][1]])) return true;
  return false;
}

// Capacités de la tour principale (comme un joueur) : sur le gardien ou sur le plus gros groupe, réparation sous 45 % de PV
function abilities(G, used) {
  const W = G.W;
  if (!W || W.tick % 10) return;
  const ready = (id) => G.castle.lvl >= B.ABILITIES[id].level && (W.abil[id] || 0) <= W.tick;
  const use = (id, c, r) => { if (!BS.useAbility(G, id, c, r)) used.push([id, c, r, W.tick]); };
  if (ready('reparation') && G.castle.hp < BS.castleMax(G) * 0.45) use('reparation', 0, 0);
  const vis = W.mobs.filter((m) => m.x >= 0 && m.x < B.COLS && m.y >= 0 && m.y < B.ROWS);
  if (!vis.length) return;
  const boss = vis.find((m) => m.boss);
  // le point le plus chargé (ou le gardien)
  let at = boss, bn = 0;
  if (!at) for (const m of vis) { const n = vis.filter((o) => (o.x - m.x) ** 2 + (o.y - m.y) ** 2 <= 2).length; if (n > bn) { bn = n; at = m; } }
  if (!boss && bn < 5) return;
  const c = Math.floor(at.x), r = Math.floor(at.y);
  for (const id of ['colere', 'pluie', 'gel']) if (ready(id)) { use(id, c, r); break; }
}

function play(zone, seed) {
  const G = BS.newGame(zone, seed, unlockedFor(zone));
  let simTime = 0, diverged = 0;
  const per = [];
  for (;;) {
    for (let g = 0; g < 300 && decide(G); g++);
    if (G.phase === 'won') { if (!UNTIL) break; BS.continueInfinite(G); continue; }
    if (G.phase !== 'build') break;
    if (UNTIL && G.wave >= UNTIL) break;
    BS.launch(G);
    const pre = BS.clone(G), used = [];
    while (G.phase === 'wave') { abilities(G, used); BS.step(G); }
    BS.runWave(pre, used);
    if (JSON.stringify(pre) !== JSON.stringify(G)) diverged++;
    simTime += G.last.ticks * B.TICK;
    per.push(G.last);
  }
  return { G, simTime, diverged, per };
}

if (require.main !== module) { module.exports = { play, decide }; return; }
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
for (const zone of ZONES) {
  const res = [];
  const t0 = Date.now();
  for (let i = 0; i < N; i++) res.push(play(zone, 1000 + i * 7919));
  const reached = res.map((r) => (r.G.phase === 'over' ? r.G.lostAt : r.G.wave + (r.G.phase === 'won' ? 0 : 1)));
  const wins = res.filter((r) => r.G.wave >= B.WIN_WAVE).length;
  const left = res.map((r) => r.G.res.or);
  console.log(`\n${B.ZONES[zone].icon} ${B.ZONES[zone].name} (${N} parties, plans : ${A.plans === 'tous' ? 'tous' : A.plans === 'zone' ? `ceux des zones jusqu’ici (${unlockedFor(zone).length})` : unlockedFor(zone).length ? unlockedFor(zone).join(', ') : 'aucun'})`);
  console.log(`  manche atteinte : min ${Math.min(...reached)} · médiane ${med(reached)} · max ${Math.max(...reached)} · victoires ${wins}/${N} · tombés au 1er gardien (manche 10) : ${reached.filter((w) => w === 10).length}/${N}`);
  console.log(`  durée des vagues (×1) : ${(res.reduce((a, r) => a + r.simTime, 0) / N / 60).toFixed(1)} min en moyenne (×2 : ${(res.reduce((a, r) => a + r.simTime, 0) / N / 120).toFixed(1)} min)`);
  console.log(`  or restant à la fin : médiane ${med(left)} · bâtiments : médiane ${med(res.map((r) => r.G.b.length))} · tour principale niv. ${med(res.map((r) => r.G.castle.lvl))}`);
  console.log(`  rejeu serveur différent : ${res.reduce((a, r) => a + r.diverged, 0)} vague(s) · calcul : ${Date.now() - t0} ms`);
  if (A.detail) for (const r of res.slice(0, 3)) {
    console.log('    vagues (tués/fuites) :', r.per.map((l) => `${l.w}:${l.kills}/${l.leaked}`).join(' '));
    console.log('    bâtiments :', r.G.b.map((b) => `${b.t}${b.lvl}${b.spec ? '*' : ''}`).join(' '), '· reste', JSON.stringify(r.G.res));
  }
}
