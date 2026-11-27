'use strict';
const test = require('node:test');
const assert = require('node:assert');
const GD = require('../shared/constants');
const X = require('../shared/expedition');
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
  // le familier est K.-O. pendant l’expédition (rapport de la page), puis le héros tombe
  mini.act(u, { action: 'sync', report: { pets: [999] } });
  assert.strictEqual(run.pets[0].hp, GD.petMaxHp('k_loup', 0), 'les PV rapportés ne peuvent pas remonter');
  mini.act(u, { action: 'die', report: { hp: 0, pets: [0] } });
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

// petite salle de simulation : un monstre à côté du héros et des familiers
function duel(mobType, petKind, mx = 560, my = 300) {
  const room = { mode: 'mine', room: 1, type: 'normal', tier: 0, seed: 1, decor: 0, sub: 0, entry: { x: 480, y: 300, side: null }, exit: { kind: 'hole', x: 860, y: 520, r: 30 },
    fountain: null, nodes: [], mobs: [{ i: 0, ...X.mobStats(mobType, 1, ''), hp: 9999, max: 9999, x: mx, y: my, drops: [], abil: null }], exitDelay: 10, boss: -1 };
  const max = GD.petMaxHp(petKind, 0);
  return X.createSim({ room, cls: 'paladin', hp: 100, max: 100, dmg: 10, crit: 0, armor: 0, shield: 20, potions: 0, bag: [], bagCap: 5, cart: null,
    pets: [{ id: 'a', kind: petKind, rarity: 0, name: GD.petName(petKind), hp: max, max }] });
}
// Math.random fixé le temps d'une simulation (choix des cibles)
function withRandom(v, fn) { const r = Math.random; Math.random = () => v; try { return fn(); } finally { Math.random = r; } }

test('familiers : 20 % des coups visent un familier ; morsure ; principal seulement niveau 10+', () => {
  assert.strictEqual(GD.PETS.HIT_CHANCE, 0.2);
  withRandom(0.1, () => { // 0,1 < 20 % : le monstre vise le familier
    const s = duel('sanglier', 'k_loup'), max = s.pets[0].max;
    for (let i = 0; i < 100; i++) X.stepSim(s, 0.05, {});
    assert.ok(s.pets[0].hp < max, 'le familier est touché');
    assert.strictEqual(s.hero.hp, 100, 'pas le héros');
    assert.ok(s.mobs[0].hp < 9999, 'le loup a mordu');
  });
  withRandom(0.5, () => { // 0,5 ≥ 20 % : le monstre vise le héros
    const s = duel('sanglier', 'k_loup'), max = s.pets[0].max;
    for (let i = 0; i < 100; i++) X.stepSim(s, 0.05, {});
    assert.strictEqual(s.pets[0].hp, max);
    assert.ok(s.hero.hp < 100);
  });
  const u = user();
  pets.buy(u, 'k_loup');
  assert.throws(() => pets.setMain(u, u.pets.list[0].id), /niveau 10/);
  u.pets.list[0].level = 10;
  pets.setMain(u, u.pets.list[0].id);
  assert.deepStrictEqual(pets.streamLook(u), ['ally_wolf', 1]);
});

test('familiers : l’œuf éclot après 30 min d’incubation', () => {
  const u = user(), t0 = 1e12;
  const egg = pets.addEgg(u, 'champ', 1, t0);
  assert.strictEqual(egg.hatchAt - t0, 30 * 60e3);
  assert.throws(() => pets.hatchEgg(u, egg.id, Math.random, t0 + 29 * 60e3), /pas encore prêt/);
  const h = pets.hatchEgg(u, egg.id, () => 0.5, t0 + 30 * 60e3);
  assert.ok(GD.MINI.MODES.champ.mobs[1].includes(h.kind), 'monstre de la zone de l’œuf');
  assert.strictEqual(u.pets.eggs.length, 0);
  assert.throws(() => pets.hatchEgg(u, egg.id), /introuvable/);
});

test('mini-jeux : chaque monstre n’existe que dans une seule zone, et chacun peut sortir d’un œuf', () => {
  const seen = {};
  for (const [m, M] of Object.entries(GD.MINI.MODES)) M.mobs.forEach((tier, i) => {
    assert.ok(tier.length >= 2, `${m} décor ${i} : au moins 2 monstres`);
    for (const k of tier) { assert.ok(!seen[k], `${k} en double (${seen[k]} et ${m}${i})`); seen[k] = m + i; assert.ok(GD.PETS.KINDS[k], `${k} : familier défini`); assert.ok(GD.MOBS[k], `${k} : monstre défini`); }
  });
  assert.ok(!GD.MOBS.corbeau.w, 'le corbeau n’apparaît pas en défense de tour');
});

test('mini-jeux : les monstres qui tirent peuvent toucher les familiers à distance ; les autres non', () => {
  withRandom(0.1, () => {
    // corps à corps : ne peut pas viser l’archer (familier à distance)
    const s = duel('sanglier', 'gobelin_archer'), max = s.pets[0].max;
    for (let i = 0; i < 100; i++) X.stepSim(s, 0.05, {});
    assert.strictEqual(s.pets[0].hp, max, 'un monstre de corps à corps ne touche pas un familier à distance');
    assert.ok(s.hero.hp < 100, 'il frappe le héros');
    // tireur (placé pour que le héros ne soit pas sur la trajectoire) : peut le viser
    const t = duel('gobelin_archer', 'gobelin_archer', 470, 120);
    for (let i = 0; i < 160; i++) X.stepSim(t, 0.05, {});
    assert.ok(t.pets[0].hp < max, 'un monstre qui tire le touche');
  });
  // l’écureuil et le mulot récoltent seuls les points proches
  const s = duel('sanglier', 'k_ecureuil');
  s.mobs[0].dead = true;
  s.nodes.push({ i: 0, x: 420, y: 330, k: 0, r: 24, gold: 0, amt: 20, left: 20, shake: 0 });
  for (let i = 0; i < 200; i++) X.stepSim(s, 0.05, {});
  assert.ok(s.ops.some((o) => o[0] === 'h') && s.bag.length === 1, 'récolte automatique');
});
