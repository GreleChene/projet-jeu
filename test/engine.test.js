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

test('la tour a 200 PV ; le vote a lieu pendant une manche sur deux et s’applique à sa fin', () => {
  const g = makeGame();
  g.startRun(1);
  assert.strictEqual(g.run.tower.max, 200);
  assert.strictEqual(g.run.vote, null, 'pas de vote avant la manche 1');
  g.setWave(1);
  assert.strictEqual(g.run.vote, null, 'pas de vote pendant la manche 1');
  g.setWave(2);
  assert.ok(g.run.vote, 'vote ouvert pendant la manche 2');
  assert.ok(g.castVote('chat:x', 'save', true), 'on peut voter pendant la manche');
  g.mobs = []; g.run.queue = []; g.run.bossPending = []; g.tick(0.05);
  assert.strictEqual(g.phase, 'intermission');
  assert.strictEqual(g.run.vote, null, 'vote appliqué à la fin de la manche');
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
  for (let w = 1; w <= 3; w++) { g.setWave(w); g.mobs = []; g.run.queue = []; g.run.bossPending = []; h.alive = false; h.respawnT = 999; g.tick(0.05); }
  assert.strictEqual(h.runGlacons, 3, 'un glaçon par manche même mort');
  assert.ok(u.pending && u.pending.glacons === 3, 'récompenses en attente enregistrées dans le profil');
  g.stopRun();
  assert.strictEqual(u.glacons, 3);
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
  g.run.treasury = 1000;
  g.applyUpgrade('revive');
  assert.strictEqual(a.alive, true);
  assert.strictEqual(a.hp, Math.round(a.maxHp * 0.6));
});

test('Infirmerie au niveau requis : un héros mort réanimé par manche', () => {
  const GD = require('../shared/constants');
  const g = makeGame();
  for (let i = 0; i < 3; i++) g.addBot({ cls: 'soldat', level: 10 });
  g.startRun(1);
  g.run.upgrades.infirmary = GD.BALANCE.INFIRMARY_REVIVE_LEVEL;
  g.setWave(3);
  for (const h of g.heroes.values()) g.heroDie(h);
  g.mobs = []; g.run.queue = []; g.run.bossPending = []; g.tick(0.05);
  assert.strictEqual([...g.heroes.values()].filter((h) => h.alive).length, 1, 'un seul héros réanimé');
  g.run.upgrades.infirmary = GD.BALANCE.INFIRMARY_REVIVE_LEVEL - 1;
  for (const h of g.heroes.values()) g.heroDie(h);
  g.setWave(4); g.closeVote(true); g.mobs = []; g.run.queue = []; g.run.bossPending = []; g.tick(0.05);
  assert.strictEqual([...g.heroes.values()].filter((h) => h.alive).length, 0, 'pas de réanimation sous le niveau requis');
});

test('Infirmerie niveau 6 : deux héros réanimés par manche', () => {
  const GD = require('../shared/constants');
  const g = makeGame();
  for (let i = 0; i < 4; i++) g.addBot({ cls: 'soldat', level: 10 });
  g.startRun(1);
  g.run.upgrades.infirmary = GD.BALANCE.INFIRMARY_REVIVE2_LEVEL;
  g.setWave(3);
  for (const h of g.heroes.values()) g.heroDie(h);
  g.mobs = []; g.run.queue = []; g.run.bossPending = []; g.tick(0.05);
  assert.strictEqual([...g.heroes.values()].filter((h) => h.alive).length, 2);
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
