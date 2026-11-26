'use strict';
const test = require('node:test');
const assert = require('node:assert');
const GD = require('../shared/constants');
const mini = require('../server/mini');

const H6 = GD.MINI.ENERGY_HOURS * 3600e3;
const user = () => ({ cls: 'paladin', level: 30, attrs: GD.emptyAttrs(), skills: {}, gold: 0, xp: 0 });
// tirages fixes : rnd() renvoie toujours v
const fixed = (v) => () => v;

test('mini-jeux : énergie (1 toutes les 6 h, 3 au plus), une expédition coûte 1 énergie', () => {
  const u = user(), t0 = 1e12;
  mini.ensure(u, t0);
  assert.strictEqual(u.mini.energy, 3);
  mini.start(u, 'mine', {}, { now: t0 });
  assert.strictEqual(u.mini.energy, 2);
  assert.throws(() => mini.start(u, 'mine', {}, { now: t0 }), /déjà en cours/);
  u.mini.run = null;
  mini.start(u, 'foret', {}, { now: t0 }); u.mini.run = null;
  mini.start(u, 'champ', {}, { now: t0 }); u.mini.run = null;
  assert.strictEqual(u.mini.energy, 0);
  assert.throws(() => mini.start(u, 'mine', {}, { now: t0 }), /énergie/);
  mini.ensure(u, t0 + H6 + 1000);
  assert.strictEqual(u.mini.energy, 1, '1 énergie après 6 h');
  mini.ensure(u, t0 + 10 * H6);
  assert.strictEqual(u.mini.energy, 3, 'plafond de 3');
});

test('mini-jeux : remonter toutes les 3 salles, élite toutes les 5 salles, mort = 75 % perdus', () => {
  const u = user();
  // rnd élevé : salles de monstres, pas de critiques ; on vide les salles en tuant les monstres
  const run = mini.start(u, 'mine', {}, { rnd: fixed(0.99) });
  const clear = () => { for (const m of run.mobs) m.hp = 1; return mini.act(u, { action: 'attack' }, { rnd: fixed(0.99) }); };
  clear(); assert.strictEqual(run.state, 'cleared');
  mini.act(u, { action: 'next' }, { rnd: fixed(0.99) }); clear();
  mini.act(u, { action: 'next' }, { rnd: fixed(0.99) }); clear();
  assert.strictEqual(run.room, 3);
  assert.strictEqual(run.state, 'choice', 'point de remontée à la salle 3');
  mini.act(u, { action: 'continue' }, { rnd: fixed(0.99) }); clear();
  mini.act(u, { action: 'next' }, { rnd: fixed(0.99) });
  assert.strictEqual(run.room, 5);
  assert.ok(run.mobs.length === 1 && run.mobs[0].elite, 'élite en salle 5');
  clear();
  assert.strictEqual(run.state, 'reward');
  assert.strictEqual(run.rewards.length, 3);
  const got = run.got;
  mini.act(u, { action: 'reward', id: run.rewards[0] });
  assert.strictEqual(run.state, 'cleared');
  // mort : 75 % des ressources perdues, XP gardée
  mini.act(u, { action: 'next' }, { rnd: fixed(0.99) });
  run.got = 40; run.hp = 1; run.mobs.forEach((m) => { m.hp = 9999; m.dmg = 9999; });
  let xpGiven = 0;
  mini.act(u, { action: 'attack' }, { rnd: fixed(0.99), grantXp: (p, xp) => { xpGiven = xp; return 0; } });
  assert.strictEqual(run.state, 'over');
  assert.ok(run.over.dead);
  assert.strictEqual(run.over.banked, 10);
  assert.strictEqual(u.mini.res.pierre, 10);
  assert.ok(xpGiven > 0 && got >= 0);
});

test('mini-jeux : remonter garde tout ; améliorations payées avec les ressources du compte', () => {
  const u = user();
  const run = mini.start(u, 'champ', {}, { rnd: fixed(0.99) });
  for (let i = 0; i < 3; i++) { for (const m of run.mobs) m.hp = 1; mini.act(u, { action: 'attack' }, { rnd: fixed(0.99) }); if (run.state === 'cleared') mini.act(u, { action: 'next' }, { rnd: fixed(0.99) }); }
  assert.strictEqual(run.state, 'choice');
  const got = run.got;
  mini.act(u, { action: 'leave' });
  assert.strictEqual(u.mini.res.baies, got, 'tout est gardé en remontant');
  u.mini.res = { pierre: 100, bois: 100, baies: 100 };
  mini.buyUpgrade(u, 'harvest_bois');
  assert.strictEqual(u.mini.up.harvest_bois, 1);
  assert.deepStrictEqual(u.mini.res, { pierre: 100, bois: 70, baies: 100 }, 'récolte du bois : payée en bois');
  mini.buyUpgrade(u, 'luck_mine');
  assert.strictEqual(u.mini.res.pierre, 85);
  assert.throws(() => mini.buyUpgrade(u, 'harvest'), /inconnue/);
  assert.throws(() => mini.act(u, { action: 'flee' }), /inconnue|Aucune|impossible/i);
  assert.strictEqual(GD.miniJackpotMul({}, 'mine'), 1.5);
  assert.strictEqual(GD.miniJackpotMul({ fortune_mine: 3 }, 'mine'), 3);
  assert.throws(() => mini.buyUpgrade(u, 'potion_x'), /inconnue/);
});

test('mini-jeux : se protéger ne soigne pas', () => {
  const u = user();
  const run = mini.start(u, 'mine', {}, { rnd: fixed(0.99) });
  run.hp = 10; run.mobs.forEach((m) => { m.dmg = 0; });
  mini.act(u, { action: 'defend' }, { rnd: fixed(0.99) });
  assert.ok(run.hp <= 10, 'pas de PV rendus');
});

test('mini-jeux : statistiques propres (améliorables), bouclier qui absorbe avec temps de recharge', () => {
  const u = user();
  u.mini = { energy: 3, energyAt: Date.now(), up: { vie: 2, force: 1, bouclier: 1 } };
  const run = mini.start(u, 'mine', {}, { rnd: fixed(0.99) });
  assert.strictEqual(run.max, 100 + 2 * 15, 'PV d’expédition, pas ceux du héros');
  assert.strictEqual(run.dmg, 12);
  assert.strictEqual(run.shieldMax, 30);
  run.mobs.forEach((m) => { m.hp = 9999; m.dmg = 10; });
  const hp0 = run.hp;
  mini.act(u, { action: 'defend' }, { rnd: fixed(0.5) });
  assert.ok(run.shield > 0 && run.shield < 30, 'le bouclier a absorbé les coups');
  assert.strictEqual(run.hp, hp0, 'aucun PV perdu tant que le bouclier tient');
  assert.throws(() => mini.act(u, { action: 'defend' }), /pas encore prêt/);
  mini.buyUpgrade(Object.assign(u, { mini: { ...u.mini, res: { pierre: 999, bois: 999, baies: 999 } } }), 'vie');
  assert.strictEqual(u.mini.up.vie, 3);
});

test('mini-jeux : le bouclier dure 2 tours et disparaît à la salle suivante', () => {
  const u = user();
  const run = mini.start(u, 'mine', {}, { rnd: fixed(0.99) });
  run.mobs.forEach((m) => { m.hp = 9999; m.dmg = 1; });
  mini.act(u, { action: 'defend' }, { rnd: fixed(0.99) });
  assert.ok(run.shield > 0);
  mini.act(u, { action: 'attack' }, { rnd: fixed(0.99) });
  assert.strictEqual(run.shield, 0, 'dissipé après 2 tours de monstres');
  mini.act(u, { action: 'attack' }, { rnd: fixed(0.99) });
  assert.throws(() => mini.act(u, { action: 'defend' }), /pas encore prêt/, 'recharge de 3 tours');
  mini.act(u, { action: 'attack' }, { rnd: fixed(0.99) });
  mini.act(u, { action: 'defend' }, { rnd: fixed(0.99) });
  assert.ok(run.shield > 0, 'de nouveau disponible après la recharge');
  run.mobs.forEach((m) => { m.hp = 1; });
  mini.act(u, { action: 'attack' }, { rnd: fixed(0.99) });
  mini.act(u, { action: 'next' }, { rnd: fixed(0.99) });
  assert.strictEqual(run.shield, 0, 'remis à zéro dans la nouvelle salle');
});
