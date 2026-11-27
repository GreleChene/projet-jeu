'use strict';
const test = require('node:test');
const assert = require('node:assert');
const GD = require('../shared/constants');
const ach = require('../server/achievements');
const mini = require('../server/mini');
const pets = require('../server/pets');
const X = require('../shared/expedition');

const user = () => ({ id: 'u1', pseudo: 'Testeur', cls: 'paladin', level: 1, attrs: GD.emptyAttrs(), skills: {}, gold: 0, xp: 0, inventory: [], equip: {},
  stats: { kills: 0, runs: 0, bestWave: 0, deaths: 0, bossKills: 0 }, mini: { energy: 9, energyAt: Date.now(), res: { pierre: 0, bois: 0, baies: 0 }, up: {} } });

test('succès : liste cohérente (identifiants et titres uniques, catégories connues)', () => {
  const A = GD.ACHIEVEMENTS;
  assert.ok(A.length >= 60);
  assert.strictEqual(new Set(A.map((a) => a.id)).size, A.length, 'identifiants uniques');
  assert.strictEqual(new Set(A.map((a) => a.title)).size, A.length, 'titres uniques');
  for (const a of A) {
    assert.ok(GD.ACH_CATS[a.cat], `${a.id} : catégorie`);
    assert.ok(a.name && a.title && a.desc && a.goal > 0, `${a.id} : textes et objectif`);
  }
  for (const cat of Object.keys(GD.ACH_CATS)) assert.ok(A.some((a) => a.cat === cat), `${cat} : au moins un succès`);
  const g = A.find((a) => a.id === 'glacons_500');
  assert.strictEqual(g.title, 'Mangeur de glaçons');
});

test('succès : débloqués quand l’objectif est atteint, notification, titre équipable seulement une fois débloqué', () => {
  const u = user(), got = [];
  const prev = ach.onUnlock;
  ach.onUnlock = (pu, a) => got.push(a.id);
  try {
    u.glaconsOpened = 499;
    ach.check(u);
    assert.ok(!u.ach.done.glacons_500);
    assert.throws(() => ach.setTitle(u, 'glacons_500'), /pas encore débloqué/);
    u.glaconsOpened = 500;
    const fresh = ach.check(u).map((a) => a.id);
    assert.deepStrictEqual(fresh, ['glacons_500'], 'les paliers 10 et 100 étaient déjà débloqués à 499');
    assert.ok(u.ach.done.glacons_10 && u.ach.done.glacons_100);
    assert.ok(got.includes('glacons_500'), 'le joueur est prévenu');
    assert.deepStrictEqual(ach.check(u), [], 'une seule fois');
    assert.strictEqual(ach.setTitle(u, 'glacons_500'), 'Mangeur de glaçons');
    assert.strictEqual(ach.titleOf(u), 'Mangeur de glaçons');
    ach.setTitle(u, null);
    assert.strictEqual(ach.titleOf(u), null);
    assert.throws(() => ach.setTitle(u, 'n_existe_pas'), /inconnu/);
  } finally { ach.onUnlock = prev; }
});

test('succès : compteurs (victoires, marché…), records gardés, migration silencieuse, succès de succès', () => {
  const u = user();
  // migration : un ancien compte avec de l'avance débloque ses succès sans notification
  u.level = 31; u.stats.kills = 1500; u.glaconsOpened = 120;
  let notified = 0;
  const prev = ach.onUnlock;
  ach.onUnlock = () => { notified++; };
  try {
    const first = ach.check(u, { silent: true });
    assert.ok(first.length >= 6 && notified === 0);
    assert.ok(u.ach.done.level_30 && u.ach.done.kills_1000 && u.ach.done.glacons_100);
    ach.add(u, 'wins'); ach.add(u, 'sold', 1); ach.add(u, 'trades', 1);
    ach.check(u);
    assert.ok(u.ach.done.wins_1 && u.ach.done.sold_1 && u.ach.done.trades_1);
    assert.strictEqual(notified, 3);
    // record de Grêlons : gardé même après dépense
    u.gold = 12000; ach.check(u); u.gold = 10;
    assert.ok(u.ach.done.goldMax_10000);
    assert.strictEqual(ach.value(u, 'goldMax'), 12000);
    // « Débloque 10 succès » se débloque dans la même vérification
    assert.ok(Object.keys(u.ach.done).length >= 10 && u.ach.done.achCount_10);
    // tenue complète : toutes les pièces d'un même set portées
    const sid = Object.keys(GD.SETS).find((k) => GD.setSize(k) > 0);
    const pieces = Object.entries(GD.TEMPLATES).filter(([, t]) => t.set === sid);
    u.inventory = pieces.map(([t], i) => ({ uid: 'x' + i, t, r: 0 }));
    u.equip = Object.fromEntries(pieces.map(([, t], i) => [t.slot, 'x' + i]));
    ach.check(u);
    assert.ok(u.ach.done.fullSet_1);
    // état envoyé à la page
    const pub = ach.publicState(u);
    assert.strictEqual(pub.v.glacons, 120);
    assert.ok(pub.done.wins_1);
  } finally { ach.onUnlock = prev; }
});

test('succès : mini-jeux (expéditions, élites, parades, roulades, ressources à l’abri) et œufs', () => {
  const u = user(), T0 = 1e12;
  const run = mini.start(u, 'mine', {}, { now: T0, rnd: () => 0.3 });
  // élite de la salle 5 vaincue, parades et roulades rapportées par la page (plafonnées)
  run.room = 4; run.roomAt = 0; run.cur.reward = 'done';
  mini.act(u, { action: 'exit' }, { now: T0 + 1e9 });
  mini.act(u, { action: 'sync', report: { k: [0], pa: 3, ro: 9999 } }, { now: T0 + 1e9 + 120e3, rnd: () => 0.5 });
  assert.strictEqual(ach.value(u, 'elites'), 1);
  assert.strictEqual(ach.value(u, 'miniKills'), 1);
  assert.strictEqual(ach.value(u, 'parries'), 3);
  assert.strictEqual(ach.value(u, 'rolls'), 60, 'plafonné par rapport');
  assert.ok(u.cheat.log.some((l) => l.kind === 'compteurs'), 'roulades impossibles signalées');
  mini.act(u, { action: 'reward', id: run.rewards[0] }, { now: T0 + 1e9 + 120e3 });
  // retour à la base : expédition terminée, ressources et butins mis à l'abri
  run.bag = [{ r: 'pierre', n: 15 }, { t: 'os' }];
  const R = X.genRoom('mine', run.seed, run.room, run.gen);
  mini.act(u, { action: 'sync', report: { k: R.mobs.map((m) => m.i) } }, { now: T0 + 1e9 + 240e3 });
  mini.act(u, { action: 'home' }, { now: T0 + 1e9 + 240e3 });
  assert.strictEqual(ach.value(u, 'expeditions'), 1);
  assert.strictEqual(ach.value(u, 'banked'), 15);
  assert.strictEqual(ach.value(u, 'trophies'), 1);
  ach.check(u);
  assert.ok(u.ach.done.expeditions_1);
  // œuf éclos
  u.mini.run = null;
  const egg = pets.addEgg(u, 'mine', 0, T0, 0);
  pets.hatchEgg(u, egg.id, () => 0.5, T0 + 1);
  assert.strictEqual(ach.value(u, 'eggs'), 1);
  ach.check(u);
  assert.ok(u.ach.done.eggs_1 && u.ach.done.pets_1);
});
