'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Game = require('../server/game/engine');
const Terrain = require('../shared/terrain');

function makeGame() {
  const db = { data: { settings: {} }, markDirty() {}, userById() { return null; }, syncAttrPoints() {} };
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
  run(g, 120);
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

test('la tour a 200 PV et le vote a lieu toutes les deux manches', () => {
  const g = makeGame();
  g.startRun(1);
  assert.strictEqual(g.run.tower.max, 200);
  assert.strictEqual(g.run.vote, null, 'pas de vote avant la manche 1');
  g.setWave(1); g.mobs = []; g.run.queue = []; g.run.bossPending = []; g.tick(0.05);
  assert.strictEqual(g.phase, 'intermission');
  assert.strictEqual(g.run.vote, null, 'pas de vote après la manche 1');
  g.setWave(2); g.mobs = []; g.run.queue = []; g.run.bossPending = []; g.tick(0.05);
  assert.ok(g.run.vote, 'vote après la manche 2');
});
