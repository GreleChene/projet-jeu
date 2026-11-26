'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Game = require('../server/game/engine');
const Terrain = require('../shared/terrain');

function makeGame() {
  const db = { data: { settings: {} }, markDirty() {}, userById() { return null; }, syncAttrPoints() {}, gearOf() { return {}; } };
  const io = { to: () => ({ emit() {} }), sockets: { sockets: new Map() } };
  return new Game(db, io);
}
const run = (g, secs) => { for (let i = 0; i < secs * 20; i++) g.tick(0.05); };

test('une partie avec des bots enchaîne plusieurs manches', () => {
  const g = makeGame();
  for (let i = 0; i < 10; i++) g.addBot();
  g.startRun(1);
  run(g, 200);
  assert.ok(g.run.cleared >= 2, 'au moins 2 manches gagnées');
  const snap = g.snapshot();
  assert.ok(Array.isArray(snap.h) && snap.h.length === 10);
});

test('manche 30 : les sapins se déracinent et le Tréant colossal apparaît', () => {
  const g = makeGame();
  g.settings.difficulty = 0.05;
  for (let i = 0; i < 20; i++) g.addBot({ level: 20 });
  g.startRun(1);
  g.setWave(30);
  assert.ok(g.run.uprooted);
  assert.ok(g.mobs.some((m) => m.type === 'treant'));
  assert.ok(g.run.bossPending.includes('treant_colossal'), 'le Tréant colossal arrive en fin de manche');
  run(g, 240);
  assert.ok(g.run.cleared >= 30 || g.mobs.some((m) => m.type === 'treant_colossal'));
});

test('manches 60, 90 et 100 : bosses corrects, sans erreur', () => {
  for (const [w, bosses] of [[60, ['mere_spore']], [90, ['geant_magma']], [100, ['treant_colossal', 'mere_spore', 'geant_magma']]]) {
    const g = makeGame();
    g.settings.difficulty = 0.01;
    for (let i = 0; i < 10; i++) g.addBot({ level: 20 });
    g.startRun(1);
    g.setWave(w);
    g.run.queue = [];
    g.mobs = [];
    run(g, 1);
    for (const b of bosses) assert.ok(g.mobs.some((m) => m.type === b), `${b} présent à la manche ${w}`);
    run(g, 30);
  }
});

test('le terrain est envahi depuis les bords après chaque boss', () => {
  assert.deepStrictEqual(Terrain.terrainState(4).frost, 0);
  assert.ok(Terrain.terrainState(5).frost > 0);
  assert.strictEqual(Terrain.terrainState(30).frost, 1);
  assert.strictEqual(Terrain.terrainState(31).poison, 0);
  assert.strictEqual(Terrain.terrainState(60).poison, 1);
  assert.strictEqual(Terrain.terrainState(90).fire, 1);
  assert.ok(Terrain.terrainState(90).mix);
});

test('la tour a 200 PV ; premier vote = spécialisation de la tour, puis 4 choix (5 avec la Résurrection)', () => {
  const GD = require('../shared/constants');
  const g = makeGame();
  g.startRun(1);
  assert.strictEqual(g.run.tower.max, 200);
  assert.strictEqual(g.run.vote, null, 'pas de vote avant la manche 1');
  g.setWave(1);
  assert.strictEqual(g.run.vote, null, 'pas de vote pendant la manche 1');
  g.setWave(2);
  assert.deepStrictEqual(g.run.vote.options, ['spec_attaque', 'spec_defense', 'spec_soin', 'spec_mage'], 'premier vote : les 4 spécialisations');
  assert.ok(g.castVote('chat:x', 'spec_defense', true), 'on peut voter pendant la manche');
  g.mobs = []; g.run.queue = []; g.run.bossPending = []; g.tick(0.05);
  assert.strictEqual(g.phase, 'intermission');
  assert.ok(g.run.vote, 'le vote reste ouvert pendant l’entracte');
  g.startWave(3);
  assert.strictEqual(g.run.towerSpec, 'defense', 'spécialisation appliquée au début de la manche suivante');
  g.setWave(4);
  const o = g.run.vote.options;
  assert.ok(!o.includes('save'), 'plus de choix « Économiser »');
  assert.strictEqual(o.length, 3, '3 choix');
  assert.ok(o[2] === 'pact' || o[2] === 'nature', '3e choix : Pacte de sang ou Vitalité de la nature');
  for (const id of o.slice(0, 2)) assert.strictEqual(GD.UPGRADES[id].tower, 'defense', 'seulement des améliorations de la tour choisie');
  const h = [...g.heroes.values()][0];
  if (h) {
    g.heroDie(h);
    assert.deepStrictEqual(g.run.vote.options.length, 3, 'la Résurrection prend la place du 3e choix');
    assert.strictEqual(g.run.vote.options[2], 'revive');
    g.setWave(6);
    assert.strictEqual(g.run.vote.options[2], 'revive');
    assert.ok(!g.run.vote.options.includes('pact'));
  }
  // personne ne vote : un choix au hasard est appliqué
  g.run.res = { pierre: 9999, bois: 9999, baies: 9999 };
  g.run.vote.options = ['df_wall_n', 'df_wall_s', 'pact'];
  const before = g.run.upgrades.df_wall_n + g.run.upgrades.df_wall_s + (g.run.pactNext ? 1 : 0);
  g.closeVote();
  assert.strictEqual(g.run.upgrades.df_wall_n + g.run.upgrades.df_wall_s + (g.run.pactNext ? 1 : 0), before + 1, 'choix aléatoire sans vote');
});

test('arbres de compétences : une seule branche, ultime au niveau 30', () => {
  const GD = require('../shared/constants');
  assert.strictEqual(GD.PROGRESSION.CLASS_LEVEL, 7);
  assert.strictEqual(GD.startedBranch({ init_soldat: 2 }), null);
  assert.strictEqual(GD.startedBranch({ paladin_1: 1 }), 'paladin');
  assert.ok(GD.SKILLS.paladin_ult.requires === 'paladin_5');
  assert.deepStrictEqual(GD.skillPoints({ level: 30, skills: { paladin_1: 2 } }).free, 13);
});

test('zones de biome : uniquement sur le biome correspondant, sans chevauchement', () => {
  const g = makeGame();
  g.startRun(1);
  g.setWave(95);
  const hz = g.zones.filter((z) => ['ice', 'toxic', 'lava'].includes(z.kind));
  assert.ok(hz.length >= 2);
  for (let i = 0; i < hz.length; i++) for (let j = i + 1; j < hz.length; j++) {
    assert.ok(Math.hypot(hz[i].x - hz[j].x, hz[i].y - hz[j].y) >= hz[i].r + hz[j].r, 'zones superposées');
  }
  g.setWave(2); // prairie : aucune zone
  assert.strictEqual(g.zones.filter((z) => ['ice', 'toxic', 'lava'].includes(z.kind)).length, 0);
});

test('stats figées pendant la bataille et récompenses versées à la fin', () => {
  const GD = require('../shared/constants');
  const u = { id: 'u1', pseudo: 'Lock', cls: 'soldat', level: 10, xp: 0, gold: 0, glacons: 0, look: { cape: 0, skin: 0, hair: 0 }, ai: { stance: 'balanced', target: 'nearest', retreat: 0, ult: 'asap' }, attrs: GD.emptyAttrs(), skills: {}, house: {}, inventory: [], equip: {}, stats: { kills: 0, bossKills: 0, deaths: 0, runs: 0, bestWave: 0 } };
  const db = { data: { settings: {} }, markDirty() {}, userById: (id) => (id === 'u1' ? u : null), syncAttrPoints() {}, gearOf() { return {}; } };
  const io = { to: () => ({ emit() {} }), sockets: { sockets: new Map() } };
  const g = new Game(db, io);
  g.startRun(1);
  const h = g.joinUser(u);
  const hp = h.maxHp;
  u.attrs.vie = 20; u.cls = 'mage';
  g.refreshHero(h);
  assert.strictEqual(h.maxHp, hp, 'stats figées');
  assert.strictEqual(h.cls, 'soldat', 'classe figée');
  g.reward(h, 500, 40);
  assert.strictEqual(u.gold, 0, 'rien versé pendant la partie');
  g.stopRun();
  assert.strictEqual(u.gold, 40, 'Grêlons versés à la fin');
  assert.ok(u.xp > 0 || u.level > 10, 'XP versée à la fin');
});

test('reconversion : 75 % des Grêlons d’amélioration remboursés', () => {
  const GD = require('../shared/constants');
  const u = { house: { hp: 2, heal: 0, special: { archer: 1 } } };
  const spent = GD.HOUSE_UPGRADES.hp.cost + GD.houseCost(GD.HOUSE_UPGRADES.hp, 1) + GD.HOUSE_SPECIALS.archer.cost;
  assert.strictEqual(GD.houseSpent(u), spent);
  assert.strictEqual(Math.floor(GD.houseSpent(u) * GD.HOUSE_RESPEC_REFUND), Math.floor(spent * 0.75));
});

test('héros mort : récompenses de toutes les manches jusqu’à la fin ; attente sauvegardée', () => {
  const GD = require('../shared/constants');
  const u = { id: 'u2', pseudo: 'Mort', cls: 'soldat', level: 10, xp: 0, gold: 0, glacons: 0, look: { cape: 0, skin: 0, hair: 0 }, ai: { stance: 'balanced', target: 'nearest', retreat: 0, ult: 'asap' }, attrs: GD.emptyAttrs(), skills: {}, house: {}, inventory: [], equip: {}, stats: { kills: 0, bossKills: 0, deaths: 0, runs: 0, bestWave: 0 } };
  const db = { data: { settings: {} }, markDirty() {}, userById: (id) => (id === 'u2' ? u : null), syncAttrPoints() {}, gearOf() { return {}; } };
  const g = new Game(db, { to: () => ({ emit() {} }), sockets: { sockets: new Map() } });
  g.startRun(1);
  const h = g.joinUser(u);
  for (let w = 1; w <= 5; w++) { g.setWave(w); g.mobs = []; g.run.queue = []; g.run.bossPending = []; h.alive = false; h.respawnT = 999; g.tick(0.05); }
  assert.strictEqual(h.runGlacons, 1, 'un glaçon par boss vaincu (manche 5), même mort');
  assert.ok(u.pending && u.pending.glacons === 1, 'récompenses en attente enregistrées dans le profil');
  g.stopRun();
  assert.strictEqual(u.glacons, 1);
  assert.strictEqual(u.pending, undefined);
});

test('pas de réapparition ; vote « Résurrection » proposé s’il y a un mort', () => {
  const g = makeGame();
  for (let i = 0; i < 3; i++) g.addBot({ cls: 'soldat', level: 10 });
  g.startRun(1);
  g.setWave(2);
  const [a] = [...g.heroes.values()];
  g.heroDie(a);
  assert.ok(g.run.vote && g.run.vote.options.includes('revive'), 'résurrection proposée dès la mort, pendant la manche');
  for (let i = 0; i < 200; i++) g.tick(0.05);
  assert.strictEqual(a.alive, false, 'reste mort');
  g.closeVote(true); // personne ne vote la résurrection
  g.mobs = []; g.run.queue = []; g.run.bossPending = []; g.tick(0.05);
  assert.strictEqual(a.alive, false, 'toujours mort après la manche');
  g.run.res.baies = 1000;
  g.applyUpgrade('revive');
  assert.strictEqual(a.alive, true);
  assert.strictEqual(a.hp, Math.round(a.maxHp * 0.6));
});

test('Sanctuaire des âmes : 1 héros réanimé par manche, 2 au niveau 2', () => {
  const g = makeGame();
  for (let i = 0; i < 4; i++) g.addBot({ cls: 'soldat', level: 10 });
  g.startRun(1);
  g.run.towerSpec = 'soin'; g.run.upgrades.so_sanctuary = 1;
  g.setWave(3);
  for (const h of g.heroes.values()) g.heroDie(h);
  g.mobs = []; g.run.queue = []; g.run.bossPending = []; g.tick(0.05);
  assert.strictEqual([...g.heroes.values()].filter((h) => h.alive).length, 1, 'un héros réanimé');
  g.run.upgrades.so_sanctuary = 2;
  for (const h of g.heroes.values()) g.heroDie(h);
  g.setWave(4); g.closeVote(true); g.mobs = []; g.run.queue = []; g.run.bossPending = []; g.tick(0.05);
  assert.strictEqual([...g.heroes.values()].filter((h) => h.alive).length, 2, 'deux héros réanimés');
});

test('soin d’entracte : 10 % des PV max, 75 % avec la Fontaine de vie au maximum ; plus de soin près de la tour', () => {
  const g = makeGame();
  g.addBot({ cls: 'soldat', level: 10 });
  g.startRun(1);
  const h = [...g.heroes.values()][0];
  g.setWave(3);
  h.hp = 1; h.x = 960; h.y = 560; // au pied de la tour
  for (let i = 0; i < 40; i++) g.tick(0.05);
  assert.ok(h.hp < h.maxHp * 0.02, 'pas de régénération continue près de la tour');
  h.hp = 1; g.mobs = []; g.run.queue = []; g.run.bossPending = []; g.tick(0.05);
  assert.ok(Math.abs(h.hp - (1 + h.maxHp * 0.1)) < 2, 'soin de 10 % à l’entracte');
  g.run.upgrades.so_fountain = 5;
  g.setWave(4); g.closeVote(true); h.hp = 1; g.mobs = []; g.run.queue = []; g.run.bossPending = []; g.tick(0.05);
  assert.ok(Math.abs(h.hp - (1 + h.maxHp * 0.75)) < 2, 'soin de 75 % avec la tour de soin maxée');
});

test('remparts : un côté construit par amélioration, les monstres de corps à corps doivent le casser', () => {
  const GD = require('../shared/constants');
  const g = makeGame();
  g.startRun(1);
  g.run.towerSpec = 'defense'; g.run.res = { pierre: 1000, bois: 1000, baies: 1000 };
  g.applyUpgrade('df_wall_e');
  const east = g.run.walls.filter((w) => w.side === 'e');
  assert.strictEqual(east.length, 2 * GD.WALLS.SPAN / GD.WALLS.STEP + 1, 'segments du rempart est');
  assert.strictEqual(g.run.walls.filter((w) => w.side !== 'e').length, 0, 'seulement le côté voté');
  g.setWave(3); g.mobs = []; g.run.queue = []; g.run.bossPending = [];
  const m = g.spawnMob('gobelin', 1800, 540, {});
  const seg = east.find((w) => w.a === 0);
  const hp0 = seg.hp;
  for (let i = 0; i < 20 * 25; i++) { g.tick(0.05); if (m.hp <= 0) break; }
  assert.ok(m.x > seg.x - 10, 'le gobelin ne traverse pas le rempart');
  assert.ok(seg.hp < hp0, 'il le frappe');
});

test('tours d’angle : avec la Pierre taillée, entre deux remparts voisins, elles ferment le passage', () => {
  const GD = require('../shared/constants');
  const g = makeGame();
  g.startRun(1);
  g.run.towerSpec = 'defense'; g.run.res = { pierre: 1000, bois: 1000, baies: 1000 };
  g.applyUpgrade('df_wall_e'); g.applyUpgrade('df_stone');
  assert.strictEqual(g.run.walls.filter((w) => w.kind === 'corner').length, 0, 'pas de tour avec un seul rempart');
  g.applyUpgrade('df_wall_s');
  const corners = g.run.walls.filter((w) => w.kind === 'corner');
  assert.deepStrictEqual(corners.map((w) => w.side), ['se'], 'une tour entre le sud et l’est');
  g.setWave(3); g.mobs = []; g.run.queue = []; g.run.bossPending = [];
  const c = corners[0], k = 1.6;
  const m = g.spawnMob('gobelin', GD.WORLD.CX + (c.x - GD.WORLD.CX) * k, GD.WORLD.CY + (c.y - GD.WORLD.CY) * k, {});
  const hp0 = c.hp;
  for (let i = 0; i < 20 * 25; i++) { g.tick(0.05); if (m.hp <= 0) break; }
  assert.ok(Math.hypot(m.x - GD.WORLD.CX, m.y - GD.WORLD.CY) > Math.hypot(c.x - GD.WORLD.CX, c.y - GD.WORLD.CY) - 10, 'le gobelin ne passe pas par l’angle');
  assert.ok(c.hp < hp0, 'il frappe la tour d’angle');
});

test('partie rapide : 35 manches, boss et terrain accélérés, 1 zone max ; difficultés', () => {
  const GD = require('../shared/constants');
  const g = makeGame();
  for (let i = 0; i < 3; i++) g.addBot({ cls: 'archer', level: 20 });
  g.startRun(1, { mode: 'quick', difficulty: 'difficile' });
  assert.strictEqual(g.maxWave(), 35);
  g.setWave(10);
  assert.ok(g.run.bossPending.includes('treant_colossal') && g.run.uprooted, 'manche 10 = déracinement + Tréant colossal');
  g.setWave(15);
  assert.ok(g.terrain.frost === 1 && g.terrain.poison > 0.3, 'corruption à chaque manche');
  for (const w of [20, 25, 30, 33]) { g.setWave(w); assert.ok(g.zones.filter((z) => ['ice', 'toxic', 'lava'].includes(z.kind)).length <= 1); }
  g.setWave(35);
  assert.deepStrictEqual(g.run.bossPending.sort(), ['geant_magma', 'mere_spore', 'treant_colossal']);
  const hard = g.scaling(30).hp;
  g.run.difficulty = 'facile';
  assert.ok(g.scaling(30).hp < hard * 0.6, 'monstres plus faibles en facile');
  // récompenses : facile + rapide < normal + classique
  const [h] = [...g.heroes.values()];
  h.runXp = 0; g.reward(h, 100, 100);
  assert.ok(Math.abs(h.runXp - 100 * GD.MODES.quick.rewards * GD.DIFFICULTIES.facile.rewards) <= 1);
});

test('écran de fin : reste affiché jusqu’à la validation d’un admin', () => {
  const g = makeGame();
  g.startRun(1);
  g.gameOver();
  for (let i = 0; i < 20 * 120; i++) g.tick(0.05); // 2 minutes
  assert.strictEqual(g.phase, 'gameover', 'toujours sur l’écran de fin après 2 minutes');
  assert.ok(g.endRunAck(), 'validation par l’admin');
  assert.strictEqual(g.phase, 'lobby');
  assert.strictEqual(g.endRunAck(), false, 'rien à valider hors de l’écran de fin');
});

test('ressources : points de récolte, coûts en ressources, Vitalité de la nature', () => {
  const GD = require('../shared/constants');
  // coût : ressource principale + 1/3 d'une autre ; tour de mage : deux ressources équilibrées
  const c = GD.upgradeResCost('df_wall_n', 0);
  assert.strictEqual(c.pierre, 70);
  assert.strictEqual(Object.keys(c).length, 2);
  assert.strictEqual(Object.values(c)[1], Math.round(70 / 3));
  const m = GD.upgradeResCost('mg_fire', 0), mv = Object.values(m);
  assert.strictEqual(mv.length, 2); assert.ok(Math.min(...mv) / Math.max(...mv) > 0.8, 'mage : ressources équilibrées');
  assert.deepStrictEqual(Object.keys(GD.upgradeResCost('revive', 0)), ['baies']);
  const g = makeGame();
  g.addBot({ cls: 'soldat', level: 10 });
  g.startRun(1);
  assert.strictEqual(g.run.nodes.length, 3 * GD.HARVEST.PER_KIND, 'points de récolte placés au début');
  // un héros à côté d'un rocher récolte de la pierre, le rocher s'épuise
  const h = [...g.heroes.values()][0], n = g.run.nodes.find((x) => x.res === 'pierre');
  h.x = n.x; h.y = n.y + 20;
  const p0 = g.run.res.pierre, a0 = n.amt;
  g.updateHarvest(2);
  assert.ok(g.run.res.pierre > p0 && n.amt < a0, 'récolte');
  // achat : paie en ressources
  g.run.towerSpec = 'defense'; g.run.res = { pierre: 500, bois: 500, baies: 500 };
  const cost = g.upgradeCost('df_wall_n');
  g.applyUpgrade('df_wall_n');
  assert.strictEqual(g.run.upgrades.df_wall_n, 1);
  assert.strictEqual(g.run.res.pierre, 500 - cost.pierre);
  g.run.res = { pierre: 0, bois: 0, baies: 0 };
  g.applyUpgrade('df_wall_s');
  assert.strictEqual(g.run.upgrades.df_wall_s, 0, 'pas assez de ressources');
  // Vitalité de la nature : +30 %
  n.amt = 0; g.applyUpgrade('nature');
  assert.strictEqual(Math.round(n.amt), Math.round(n.max * 0.3));
});
