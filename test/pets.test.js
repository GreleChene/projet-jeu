'use strict';
const test = require('node:test');
const assert = require('node:assert');
const GD = require('../shared/constants');
const mini = require('../server/mini');
const pets = require('../server/pets');

const user = () => ({ cls: 'paladin', level: 30, attrs: GD.emptyAttrs(), skills: {}, gold: 5000, xp: 0, mini: { energy: 9, energyAt: Date.now(), res: { pierre: 0, bois: 0, baies: 0 }, up: {} } });
const fixed = (v) => () => v;

test('familiers : chenil à 10 glaçons, une fois par animal, 2 actifs au plus', () => {
  const u = user();
  assert.strictEqual(GD.PETS.KENNEL_PRICE, GD.GLACONS.PRICE * 10);
  pets.buy(u, 'k_loup'); pets.buy(u, 'k_lapin'); pets.buy(u, 'k_tortue');
  assert.strictEqual(u.gold, 5000 - 3 * GD.PETS.KENNEL_PRICE);
  assert.throws(() => pets.buy(u, 'k_loup'), /déjà/);
  assert.throws(() => pets.buy(u, 'araignee'), /inconnu/, 'les monstres ne s’achètent pas');
  assert.strictEqual(u.pets.active.length, 2, 'les 2 premiers achetés deviennent actifs');
  const ids = u.pets.list.map((p) => p.id);
  pets.setActive(u, ids);
  assert.strictEqual(u.pets.active.length, 2, '2 actifs au plus');
});

test('familiers : œuf (monstre de la zone, rareté), doublon converti (30 au plus) ou rareté améliorée', () => {
  const u = user();
  const h1 = pets.hatch(u, 'mine', 0, fixed(0.99)); // rareté commune
  assert.ok(GD.MINI.MODES.mine.mobs[0].includes(h1.kind));
  assert.strictEqual(h1.result, 'new');
  const h2 = pets.hatch(u, 'mine', 0, fixed(0.99));
  assert.strictEqual(h2.result, 'duplicate');
  assert.strictEqual(u.mini.res.pierre, GD.PETS.DUP_RES[0]);
  assert.strictEqual(Math.max(...GD.PETS.DUP_RES), 30);
  const seq = [0.99, 0.0005]; // même espèce, puis rareté mystique
  const h3 = pets.hatch(u, 'mine', 0, () => seq.shift());
  assert.strictEqual(h3.result, 'upgrade', 'meilleure rareté : le familier est amélioré');
  assert.strictEqual(u.pets.list[0].rarity, 5);
  // puissance : rareté commune = chenil, rareté supérieure = plus fort
  assert.ok(GD.petPower('araignee', 4).poison > GD.petPower('araignee', 0).poison);
  assert.ok(GD.petMaxHp('k_ours', 0) > GD.petMaxHp('k_ecureuil', 0), 'l’ours a plus de PV que l’écureuil');
});

test('familiers : PV gardés après l’expédition, repos jusqu’à 50 %, régénération avec le temps, XP', () => {
  const u = user();
  pets.buy(u, 'k_loup');
  const run = mini.start(u, 'mine', {}, { rnd: fixed(0.99) });
  assert.strictEqual(run.pets.length, 1);
  run.pets[0].hp = 0; // K.-O. pendant l’expédition
  // fin de l’expédition (mort du héros)
  run.mobs.forEach((m) => { m.hp = 9999; m.dmg = 9999; }); run.hp = 1;
  mini.act(u, { action: 'attack' }, { rnd: fixed(0.99) });
  assert.strictEqual(run.state, 'over');
  const p = u.pets.list[0];
  assert.ok(p.ko && p.hp === 0, 'K.-O. : se repose');
  assert.ok(p.xp > 0 || p.level > 1, 'XP gagnée');
  assert.throws(() => pets.setActive(u, [p.id]), /repose/);
  // 4 h plus tard : 40 % → toujours au repos ; 6 h : 60 % → de nouveau disponible
  pets.ensure(u, p.at + 4 * 3.6e6);
  assert.ok(p.ko);
  pets.ensure(u, p.at + 2 * 3.6e6);
  assert.ok(!p.ko && p.hp >= GD.petMaxHp('k_loup', 0) * 0.5);
  u.mini.run = null;
  pets.setActive(u, [p.id]);
  assert.deepStrictEqual(u.pets.active, [p.id]);
});

test('familiers : 20 % des coups visent un familier ; morsure ; principal seulement niveau 10+', () => {
  const u = user();
  pets.buy(u, 'k_loup');
  const run = mini.start(u, 'mine', {}, { rnd: fixed(0.99) });
  const mob = run.mobs[0]; mob.hp = 9999;
  // rnd = 0,1 : < 20 % → le monstre frappe le familier
  const hp0 = run.hp, php0 = run.pets[0].hp;
  mini.act(u, { action: 'defend' }, { rnd: fixed(0.1) });
  assert.ok(run.pets[0].hp < php0, 'le familier est touché');
  assert.strictEqual(run.hp, hp0, 'pas le héros');
  assert.ok(mob.hp < 9999, 'le loup a mordu');
  assert.throws(() => pets.setMain(u, u.pets.list[0].id), /niveau 10/);
  u.pets.list[0].level = 10;
  pets.setMain(u, u.pets.list[0].id);
  assert.deepStrictEqual(pets.streamLook(u), ['ally_wolf', 1]);
});
