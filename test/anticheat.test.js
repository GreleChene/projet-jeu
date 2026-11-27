'use strict';
const test = require('node:test');
const assert = require('node:assert');
const GD = require('../shared/constants');
const X = require('../shared/expedition');
const AC = require('../server/anticheat');
const mini = require('../server/mini');

const M = GD.MINI, T0 = 1e12;
const user = (id = 'u1', pseudo = 'Testeur') => ({ id, pseudo, cls: 'paladin', level: 30, attrs: GD.emptyAttrs(), skills: {}, gold: 0, xp: 0, inventory: [], equip: {},
  stats: { kills: 0, runs: 0, bestWave: 0, deaths: 0, bossKills: 0 }, mini: { energy: 9, energyAt: Date.now(), res: { pierre: 0, bois: 0, baies: 0 }, up: {} } });
const kinds = (u) => ((u.cheat && u.cheat.log) || []).map((l) => l.kind);
// passe à la salle « room », entrée au temps « now »
function goTo(u, room, now) {
  const run = u.mini.run;
  run.room = room - 1; run.roomAt = 0; run.cur.reward = 'done';
  mini.act(u, { action: 'exit' }, { now });
  return run;
}

test('anti-triche : une élite « tuée » dès l’entrée dans la salle est refusée (puis acceptée quand c’est possible)', () => {
  const u = user();
  const run = mini.start(u, 'mine', {}, { now: T0, rnd: () => 0.3 });
  const t = T0 + 1e9;
  goTo(u, 5, t);
  mini.act(u, { action: 'sync', report: { k: [0] } }, { now: t + 500 });
  assert.ok(!run.cur.killed.includes(0), 'refusée : 0,5 s pour une élite');
  assert.strictEqual(run.state, 'room', 'pas de récompense');
  assert.ok(kinds(u).includes('kills'));
  // la page renvoie la liste complète à chaque rapport : acceptée une fois le temps écoulé vraisemblable
  mini.act(u, { action: 'sync', report: { k: [0] } }, { now: t + 60e3, rnd: () => 0.5 });
  assert.ok(run.cur.killed.includes(0) && run.state === 'reward');
});

test('anti-triche : renforts impossibles (avant leur arrivée, ou en salle d’élite) refusés', () => {
  const u = user();
  const run = mini.start(u, 'foret', {}, { now: T0, rnd: () => 0.3 });
  // salle 2 (normale) : premiers renforts au bout de 20 s
  goTo(u, 2, T0 + 1e9);
  mini.act(u, { action: 'sync', report: { k: [X.REINF0] } }, { now: T0 + 1e9 + 5e3 });
  assert.ok(!run.cur.killed.includes(X.REINF0), 'pas encore arrivé');
  mini.act(u, { action: 'sync', report: { k: [X.REINF0] } }, { now: T0 + 1e9 + 40e3 });
  assert.ok(run.cur.killed.includes(X.REINF0));
  // salle d'élite : jamais de renfort
  goTo(u, 5, T0 + 2e9);
  mini.act(u, { action: 'sync', report: { k: [X.REINF0 + 1] } }, { now: T0 + 2e9 + 60e3 });
  assert.ok(!run.cur.killed.includes(X.REINF0 + 1));
  assert.ok(kinds(u).includes('rapport'));
});

test('anti-triche : récolte éclair plafonnée, PV qui remontent sans soin ramenés au possible', () => {
  const u = user();
  const run = mini.start(u, 'champ', {}, { now: T0, rnd: () => 0.3 });
  // une salle riche entière récoltée en 0,3 s
  let r = 2; while (X.roomType(run.seed, r) !== 'riche') r++;
  goTo(u, r, T0 + 1e9);
  const R = X.genRoom('champ', run.seed, r, run.gen), total = R.nodes.reduce((a, n) => a + n.amt, 0);
  mini.act(u, { action: 'sync', report: { ops: R.nodes.map((n) => ['h', n.i, n.amt]) } }, { now: T0 + 1e9 + 300 });
  const got = Object.values(run.cur.harv).reduce((a, n) => a + n, 0);
  assert.ok(got < total && got <= 12, `récolte plafonnée (${got} / ${total})`);
  assert.ok(kinds(u).includes('recolte'));
  // PV : 100 → 30 (coups reçus) → 100 sans potion : refusé ; avec une potion : +35 %
  mini.act(u, { action: 'sync', report: { hp: 30 } }, { now: T0 + 1e9 + 10e3 });
  mini.act(u, { action: 'sync', report: { hp: run.max } }, { now: T0 + 1e9 + 11e3 });
  assert.ok(run.hp < 35, 'pas de soin miracle');
  assert.ok(kinds(u).includes('pv'));
  const before = run.hp;
  mini.act(u, { action: 'sync', report: { ops: [['pot']], hp: before + Math.round(run.max * M.POTION_HEAL) } }, { now: T0 + 1e9 + 12e3 });
  assert.strictEqual(run.hp, before + Math.round(run.max * M.POTION_HEAL), 'la potion soigne');
});

test('anti-triche : la fontaine soigne jusqu’à 30 PV, pas plus', () => {
  const u = user();
  const run = mini.start(u, 'mine', {}, { now: T0, rnd: () => 0.3 });
  let r = 2; while (X.roomType(run.seed, r) !== 'repos') r++;
  goTo(u, r, T0 + 1e9);
  mini.act(u, { action: 'sync', report: { hp: 20 } }, { now: T0 + 1e9 + 2e3 });
  mini.act(u, { action: 'sync', report: { hp: 50 } }, { now: T0 + 1e9 + 6e3 });
  assert.strictEqual(run.hp, 50, '+30 PV de la fontaine');
  mini.act(u, { action: 'sync', report: { hp: 90 } }, { now: T0 + 1e9 + 9e3 });
  assert.ok(run.hp < 55, 'la fontaine est tarie');
});

test('anti-triche : score qui baisse avec le temps, mini-jeux suspendus au-delà du seuil, déblocage par l’admin', () => {
  const u = user(), now = Date.now();
  for (let i = 0; i < 12; i++) AC.flag(u, 'kills', 'test', now - (12 - i) * 60e3); // une alerte par minute
  assert.ok(AC.score(u, now) >= AC.BLOCK);
  assert.ok(AC.blocked(u));
  assert.throws(() => mini.start(u, 'mine', {}, { now: T0 }), /suspendus/);
  // les alertes rapprochées ne comptent qu'une fois
  const v = user('v2');
  for (let i = 0; i < 10; i++) AC.flag(v, 'pv', 'rafale', now + i * 1000);
  assert.strictEqual(Math.round(AC.score(v, now + 10e3)), AC.KINDS.pv.w);
  assert.strictEqual(v.cheat.log[0].n, 10);
  // baisse dans le temps : 2 points par jour
  assert.ok(AC.score(v, now + 2 * 864e5) === 0);
  AC.clear(u);
  assert.ok(!AC.blocked(u));
  assert.ok(mini.start(u, 'mine', {}, { now: T0 }));
});

test('anti-triche : héros jamais touché en profondeur signalé une fois', () => {
  const u = user();
  const run = mini.start(u, 'mine', {}, { now: T0, rnd: () => 0.3 });
  run.room = 32; run.kills = 120; run.dmgTaken = 0;
  mini.act(u, { action: 'sync', report: { hp: run.max } }, { now: T0 + 1e9 });
  mini.act(u, { action: 'sync', report: { hp: run.max } }, { now: T0 + 1e9 + 1e3 });
  assert.strictEqual(kinds(u).filter((k) => k === 'invulnerable').length, 1);
});

test('anti-triche : limitation du débit et comptes liés (adresses hachées)', () => {
  // seau à jetons : 2 par seconde, réserve de 3
  const k = 'test:' + Math.random();
  const res = Array.from({ length: 5 }, () => AC.allow(k, 2, 3, T0));
  assert.deepStrictEqual(res, [true, true, true, false, false]);
  assert.ok(AC.allow(k, 2, 3, T0 + 600), 'un jeton revient au bout de 0,5 s');
  // adresses : jamais en clair
  AC.setSalt('sel-de-test');
  const a = user('a', 'Alice'), b = user('b', 'Bob'), c = user('c', 'Chloé');
  AC.seen(a, '203.0.113.7'); AC.seen(b, '203.0.113.7'); AC.seen(c, '198.51.100.2');
  assert.ok(!JSON.stringify(a.iph).includes('203.0.113'), 'adresse hachée');
  assert.deepStrictEqual(AC.linked(a, [a, b, c]).map((o) => o.pseudo), ['Bob']);
  assert.ok(AC.transfer(a, b, [a, b, c], 'don'));
  assert.ok(kinds(a).includes('transfert') && kinds(b).includes('transfert'));
  assert.ok(!AC.transfer(a, c, [a, b, c], 'don'), 'pas de lien : pas d’alerte');
  // adresse partagée par beaucoup de comptes (réseau public, proxy) : pas un lien
  const many = Array.from({ length: 8 }, (_, i) => user('m' + i, 'M' + i));
  for (const m of many) AC.seen(m, '192.0.2.50');
  assert.deepStrictEqual(AC.linked(many[0], many), []);
});
