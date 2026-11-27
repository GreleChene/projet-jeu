'use strict';
const test = require('node:test');
const assert = require('node:assert');
const GD = require('../shared/constants');
const X = require('../shared/expedition');
const mini = require('../server/mini');

const M = GD.MINI, H6 = M.ENERGY_HOURS * 3600e3, T0 = 1e12;
const user = () => ({ cls: 'paladin', level: 30, attrs: GD.emptyAttrs(), skills: {}, gold: 0, xp: 0 });
// tirages fixes : rnd() renvoie toujours v
const fixed = (v) => () => v;
// passe directement à la salle « room » (la sortie de la salle précédente est prise bien après son ouverture)
function goTo(u, room, now = T0 + 1e9) {
  const run = u.mini.run;
  run.room = room - 1; run.roomAt = 0; run.cur.reward = 'done';
  mini.act(u, { action: 'exit' }, { now });
  return run;
}
// petite salle de test pour la simulation : monstres { type, x, y }, options de la salle et du héros
function arena(mobs, roomExtra, simExtra) {
  const room = { mode: 'mine', room: 1, type: 'normal', tier: 0, seed: 1, decor: 0, sub: 0, entry: { x: 480, y: 300, side: null }, exit: { kind: 'hole', x: 820, y: 480, r: 30 },
    fountain: null, nodes: [], mobs: mobs.map((m, i) => ({ i, ...X.mobStats(m.type, 1, ''), x: m.x, y: m.y, drops: [], abil: null })), exitDelay: 10, boss: -1, ...(roomExtra || {}) };
  return X.createSim({ room, cls: 'paladin', hp: 100, max: 100, dmg: 10, crit: 0, armor: 0, shield: 20, pets: [], potions: 1, bag: [], bagCap: 5, cart: null, killed: [], harv: {}, picked: {}, extra: [], ...(simExtra || {}) });
}

test('mini-jeux : énergie (1 toutes les 6 h, 3 au plus), une expédition coûte 1 énergie', () => {
  const u = user();
  mini.ensure(u, T0);
  assert.strictEqual(u.mini.energy, 3);
  mini.start(u, 'mine', {}, { now: T0 });
  assert.strictEqual(u.mini.energy, 2);
  assert.throws(() => mini.start(u, 'mine', {}, { now: T0 }), /déjà en cours/);
  u.mini.run = null;
  mini.start(u, 'foret', {}, { now: T0 }); u.mini.run = null;
  mini.start(u, 'champ', {}, { now: T0 }); u.mini.run = null;
  assert.strictEqual(u.mini.energy, 0);
  assert.throws(() => mini.start(u, 'mine', {}, { now: T0 }), /énergie/);
  mini.ensure(u, T0 + H6 + 1000);
  assert.strictEqual(u.mini.energy, 1, '1 énergie après 6 h');
  mini.ensure(u, T0 + 10 * H6);
  assert.strictEqual(u.mini.energy, 3, 'plafond de 3');
  // une ancienne expédition au tour par tour est abandonnée et son énergie rendue
  u.mini.run = { state: 'fight', room: 4 };
  mini.ensure(u, T0 + 10 * H6);
  assert.strictEqual(u.mini.run, null);
  assert.strictEqual(u.mini.energy, 4);
});

test('mini-jeux : salles générées à l’identique (graine), types de salles, sorties, monstres déjà présents', () => {
  for (const mode of Object.keys(M.MODES)) {
    const a = X.genRoom(mode, 12345, 7, {});
    assert.deepStrictEqual(a, X.genRoom(mode, 12345, 7, {}), 'même graine : même salle (serveur et page)');
    assert.notDeepStrictEqual(X.genRoom(mode, 999, 7, {}).nodes, a.nodes, 'autre graine : autre salle');
    assert.strictEqual(a.exit.kind, M.MODES[mode].exit, 'cavité dans la caverne, ouverture sur un côté ailleurs');
    assert.ok(a.mobs.length >= 2, 'des monstres attendent dans la salle');
    for (const n of a.nodes) assert.ok(n.x > M.ARENA.WALL && n.x < M.ARENA.W - M.ARENA.WALL && n.y > M.ARENA.WALL && n.y < M.ARENA.H - M.ARENA.WALL);
    for (const m of a.mobs) assert.ok(M.MODES[mode].mobs[a.tier].includes(m.type), 'monstres de la zone');
  }
  assert.strictEqual(X.roomType(1, 1), 'normal');
  assert.strictEqual(X.roomType(1, 5), 'elite');
  assert.strictEqual(X.roomType(1, 10), 'gardien');
  const types = new Set();
  for (let r = 2; r < 300; r++) if (r % 5) types.add(X.roomType(3, r));
  assert.deepStrictEqual([...types].sort(), ['normal', 'repos', 'riche'], 'salles normales, riches et de repos');
  // gardien de zone (salle 10) : le butin rare de la zone + 3 communs ; élite (salle 5) : sortie seulement une fois vaincue
  const g = X.genRoom('foret', 42, 10, {});
  assert.ok(g.mobs[0].boss && g.boss === 0 && g.mobs[0].type === M.MODES.foret.bosses[0].type);
  assert.strictEqual(g.mobs[0].drops[0], M.MODES.foret.trophies.rare);
  assert.strictEqual(g.mobs[0].drops.length, 1 + M.DROPS.bossCommons);
  const e = X.genRoom('mine', 42, 5, {});
  assert.ok(e.mobs[0].elite && e.exitDelay === 0 && e.mobs[0].drops.length >= M.DROPS.eliteCommons);
  // salle de repos : une fontaine et pas de monstre ; salle riche : beaucoup de points, sortie à 20 s
  let r = 2; while (X.roomType(8, r) !== 'repos') r++;
  const rp = X.genRoom('champ', 8, r, {});
  assert.ok(rp.fountain && rp.mobs.length === 0);
  r = 2; while (X.roomType(8, r) !== 'riche') r++;
  const rc = X.genRoom('champ', 8, r, {});
  assert.ok(rc.nodes.length >= M.ROOMS.riche.nodes[0] && rc.exitDelay === M.ROOMS.riche.exit);
  // forêt, clairière : on entre par le côté opposé à la sortie précédente
  const s4 = X.sidesFor(77, 4), s5 = X.sidesFor(77, 5);
  assert.strictEqual(s5.entry, { n: 's', s: 'n', e: 'w', w: 'e' }[s4.exit]);
  assert.notStrictEqual(s5.exit, s5.entry);
});

test('mini-jeux : le serveur valide les rapports (récolte limitée au point et au sac, butins des monstres tués seulement)', () => {
  const u = user();
  const run = mini.start(u, 'mine', {}, { now: T0, rnd: fixed(0.3) });
  const R = X.genRoom('mine', run.seed, 1, run.gen), amt = R.nodes[0].amt;
  mini.act(u, { action: 'sync', report: { k: [], ops: [['h', 0, 999]], hp: run.hp } }, { now: T0 + 1000 });
  assert.deepStrictEqual(X.totals(run.bag).res, { pierre: amt }, 'pas plus que ce que contient le point');
  mini.act(u, { action: 'sync', report: { ops: [['h', 0, 5], ['h', 99, 5], ['x', 1, 2], 'n’importe quoi'] } }, { now: T0 + 1000 });
  assert.strictEqual(X.totals(run.bag).res.pierre, amt, 'point épuisé, point inconnu et opérations invalides ignorés');
  // sac : une case = 15 ressources, place limitée
  const items = [];
  assert.strictEqual(X.addRes(items, 2, 'pierre', 40), 30);
  assert.deepStrictEqual(items, [{ r: 'pierre', n: 15 }, { r: 'pierre', n: 15 }]);
  assert.ok(!X.addTrophy(items, 2, 'os'), 'pas de place pour un butin');
  // PV et potions rapportés
  mini.act(u, { action: 'sync', report: { ops: [['pot']], hp: 40 } }, { now: T0 + 1000 });
  assert.strictEqual(run.hp, 40);
  assert.strictEqual(run.potions, M.POTIONS - 1);
  mini.act(u, { action: 'sync', report: { hp: 1e6 } }, { now: T0 + 1000 });
  assert.strictEqual(run.hp, run.max, 'jamais plus que les PV max');
  // butins : seulement ceux des monstres tués (une seule fois), et de l'XP par monstre
  goTo(u, 5);
  mini.act(u, { action: 'sync', report: { ops: [['p', 'm0_0', 1]] } }, { now: T0 + 1e9 });
  assert.strictEqual(run.bag.filter((s) => s.t).length, 0, 'élite pas encore tuée');
  const xp0 = run.xp;
  mini.act(u, { action: 'sync', report: { k: [0, 0, 77], ops: [['p', 'm0_0', 1], ['p', 'm0_0', 1]] } }, { now: T0 + 1e9, rnd: fixed(0.5) });
  assert.strictEqual(run.bag.filter((s) => s.t).length, 1, 'un seul ramassage par butin');
  assert.strictEqual(run.kills, 1);
  assert.ok(run.xp > xp0);
});

test('mini-jeux : sortie après 10 s ; seau renvoyé à la base (contenu à l’abri), de retour 2 salles plus tard', () => {
  const u = user();
  const run = mini.start(u, 'mine', {}, { now: T0, rnd: fixed(0.3) });
  assert.strictEqual(run.cart.skin, 'seau');
  assert.throws(() => mini.act(u, { action: 'exit' }, { now: T0 + 3000 }), /pas encore ouverte/);
  mini.act(u, { action: 'exit' }, { now: T0 + 10000 });
  assert.strictEqual(run.room, 2);
  const R = X.genRoom('mine', run.seed, 2, run.gen), n = R.nodes[0].amt;
  // dépôt (le rapport est appliqué avant l'action) puis renvoi
  mini.act(u, { action: 'deposit', slot: 'all', report: { ops: [['h', 0, n]] } }, { now: T0 + 11000 });
  assert.strictEqual(run.bag.length, 0);
  assert.strictEqual(X.totals(run.cart.items).res.pierre, n);
  mini.act(u, { action: 'send' }, { now: T0 + 12000 });
  assert.strictEqual(u.mini.res.pierre, n, 'à l’abri sur le compte');
  assert.strictEqual(run.cart.back, 2 + M.CART.away);
  assert.throws(() => mini.act(u, { action: 'deposit', slot: 0 }, { now: T0 + 12000 }), /n’est pas là/);
  assert.throws(() => mini.act(u, { action: 'home' }, { now: T0 + 12000 }), /Il faut le seau/);
  mini.act(u, { action: 'exit' }, { now: T0 + 60000 });
  assert.strictEqual(run.room, 3);
  assert.ok(run.cart.back > 0, 'toujours parti en salle 3');
  mini.act(u, { action: 'exit' }, { now: T0 + 120000 });
  assert.strictEqual(run.cart.back, 0, 'de retour en salle 4');
  // seau plein : on ne peut plus y déposer de case
  run.cart.items = Array.from({ length: X.cartCap(u.mini.up) }, () => ({ r: 'pierre', n: 15 }));
  run.bag = [{ t: 'os' }];
  assert.throws(() => mini.act(u, { action: 'deposit', slot: 0 }, { now: T0 + 120000 }), /Plus de place/);
  // forêt et clairière : une charrette
  const u2 = user();
  assert.strictEqual(mini.start(u2, 'champ', {}, { now: T0 }).cart.skin, 'charrette');
});

test('mini-jeux : mort — tout le non-renvoyé est perdu sauf 25 % des ressources du sac ; poche sécurisée au sac max', () => {
  const u = user();
  const run = mini.start(u, 'foret', {}, { now: T0, rnd: fixed(0.3) });
  run.bag = [{ r: 'bois', n: 15 }, { r: 'bois', n: 15 }, { r: 'bois', n: 10 }, { t: 'croc' }, { t: 'crane' }];
  run.cart.items = [{ r: 'bois', n: 15 }, { t: 'peau' }];
  run.sent = { res: { bois: 30 }, tro: { peau: 1 } }; u.mini.res.bois = 30; u.mini.trophies = { peau: 1 }; // renvoyés plus tôt
  mini.act(u, { action: 'die', report: { hp: 0 } }, { now: T0 + 5000 });
  assert.strictEqual(run.state, 'over');
  assert.ok(run.over.dead);
  assert.strictEqual(u.mini.res.bois, 30 + 10, '25 % des 40 ressources du sac');
  assert.deepStrictEqual(u.mini.trophies, { peau: 1 }, 'les butins du sac et de la charrette non renvoyée sont perdus');
  assert.strictEqual(run.over.lost.res.bois, 30 + 15);
  assert.deepStrictEqual(run.over.lost.tro, { croc: 1, crane: 1, peau: 1 });
  assert.deepStrictEqual(run.over.banked, { res: { bois: 40 }, tro: { peau: 1 } });
  assert.throws(() => mini.act(u, { action: 'exit' }), /terminée/);
  mini.act(u, { action: 'close' });
  assert.strictEqual(u.mini.run, null);
  // poche sécurisée (sac au niveau max) : les 5 cases les plus précieuses sont gardées en entier
  assert.ok(X.hasPocket({ sac: M.UPGRADES.sac.max }) && !X.hasPocket({ sac: M.UPGRADES.sac.max - 1 }));
  const sp = X.deathSplit([{ r: 'bois', n: 15 }, { r: 'bois', n: 4 }, { t: 'croc' }, { t: 'crane' }, { r: 'bois', n: 15 }, { r: 'bois', n: 15 }, { r: 'bois', n: 15 }, { t: 'peau' }], true);
  assert.deepStrictEqual(sp.kept.tro, { croc: 1, crane: 1, peau: 1 });
  assert.strictEqual(sp.kept.res.bois, 30 + Math.floor((15 + 15 + 4) * M.DEATH_KEEP));
});

test('mini-jeux : « Rentrer » avec le seau / la charrette termine l’expédition et met tout à l’abri', () => {
  const u = user();
  const run = mini.start(u, 'champ', {}, { now: T0, rnd: fixed(0.3) });
  goTo(u, 4);
  run.bag = [{ r: 'baies', n: 15 }, { t: 'plume' }];
  run.cart.items = [{ r: 'baies', n: 12 }, { t: 'braise' }];
  let xp = -1;
  run.xp = 50;
  const R = X.genRoom('champ', run.seed, 4, run.gen);
  assert.strictEqual(R.mobs.length, M.START_MOBS, '3 monstres au départ');
  assert.deepStrictEqual([1, 7, 13, 31, 80].map(X.startMobs), [3, 4, 5, 8, 8], 'plus nombreux en profondeur (8 au plus)');
  assert.deepStrictEqual([1, 13, 80].map(X.reinfAfter), [20, 24, 30], 'renforts un peu plus tard en profondeur');
  assert.throws(() => mini.act(u, { action: 'home' }, { now: T0 + 1e9 }), /Élimine d’abord/, 'pas de retour tant que les monstres de la salle vivent');
  mini.act(u, { action: 'sync', report: { k: R.mobs.map((m) => m.i) } }, { now: T0 + 1e9 });
  run.xp = 50;
  mini.act(u, { action: 'home' }, { now: T0 + 1e9, grantXp: (p, n) => { xp = n; return 0; } });
  assert.ok(run.over && !run.over.dead);
  assert.strictEqual(u.mini.res.baies, 27);
  assert.deepStrictEqual(u.mini.trophies, { plume: 1, braise: 1 });
  assert.strictEqual(xp, 50, 'XP versée en fin d’expédition');
  assert.strictEqual(u.mini.best.champ, 4, 'record de profondeur');
});

test('mini-jeux : élite toutes les 5 salles, gardien toutes les 10 : récompense au choix, œuf à 10 %', () => {
  const u = user();
  const run = mini.start(u, 'champ', {}, { now: T0, rnd: fixed(0.3) });
  goTo(u, 5);
  assert.strictEqual(run.type, 'elite');
  run.cur.reward = 'todo';
  assert.throws(() => mini.act(u, { action: 'exit' }, { now: T0 + 2e9 }), /pas encore ouverte/, 'pas de sortie avant d’avoir vaincu l’élite');
  mini.act(u, { action: 'sync', report: { k: [0] } }, { now: T0 + 2e9, rnd: fixed(0.05) });
  assert.strictEqual(run.state, 'reward');
  assert.strictEqual(run.rewards.length, 3);
  assert.ok(run.rewards.includes('egg'), 'tirage sous 10 % : un œuf est proposé');
  assert.throws(() => mini.act(u, { action: 'exit' }, { now: T0 + 2e9 }), /récompense/);
  mini.act(u, { action: 'reward', id: 'egg' }, { now: T0 + 2e9 });
  assert.strictEqual(u.pets.eggs.length, 1);
  assert.strictEqual(u.pets.eggs[0].mode, 'champ');
  mini.act(u, { action: 'exit' }, { now: T0 + 2e9 });
  assert.strictEqual(run.room, 6);
  // gardien en salle 10 ; pas d'œuf si le tirage dépasse 10 %
  goTo(u, 10, T0 + 3e9);
  assert.strictEqual(run.type, 'gardien');
  run.cur.reward = 'todo';
  mini.act(u, { action: 'sync', report: { k: [0] } }, { now: T0 + 3e9, rnd: fixed(0.5) });
  assert.ok(run.state === 'reward' && !run.rewards.includes('egg'));
  assert.throws(() => mini.act(u, { action: 'reward', id: 'potion' }), /inconnue/, 'seulement les 3 proposées');
  const max0 = run.max;
  mini.act(u, { action: 'reward', id: 'hp' }, { now: T0 + 3e9 });
  assert.ok(run.max > max0);
  // trésor de l'élite : un tas de ressources à l'entrée de la salle, à ramasser
  run.state = 'reward'; run.rewards = ['res', 'dmg', 'crit'];
  mini.act(u, { action: 'reward', id: 'res' }, { now: T0 + 3e9 });
  const pile = run.cur.extra[0], E = X.genRoom('champ', run.seed, 10, run.gen).entry;
  assert.ok(pile && pile.x === Math.round(E.x) && pile.y === Math.round(E.y));
  const before = X.totals(run.bag).res.baies || 0;
  mini.act(u, { action: 'sync', report: { ops: [['p', pile.id, 9999]] } }, { now: T0 + 3e9 });
  assert.strictEqual((X.totals(run.bag).res.baies || 0) - before, Math.min(pile.n, X.resRoom([], X.bagCap(u.mini.up), 'baies')));
});

test('mini-jeux : sac et seau / charrette améliorés avec les butins des monstres, le reste avec les ressources', () => {
  const u = user();
  mini.ensure(u);
  assert.strictEqual(X.bagCap(u.mini.up), 5);
  assert.strictEqual(X.cartCap(u.mini.up), 10);
  assert.throws(() => mini.buyUpgrade(u, 'sac'), /butins/);
  u.mini.trophies = { os: 5, peau: 5 };
  mini.buyUpgrade(u, 'sac');
  assert.strictEqual(u.mini.up.sac, 1);
  assert.deepStrictEqual(u.mini.trophies, { os: 0, peau: 0 });
  assert.strictEqual(X.bagCap(u.mini.up), 10, '+5 cases par niveau');
  assert.strictEqual(X.bagCap({ sac: 5 }), 30);
  assert.strictEqual(X.cartCap({ chariot: 5 }), 60, '+10 cases par niveau');
  assert.ok(GD.isTrophyCost('chariot') && !GD.isTrophyCost('vie'));
  // statistiques d'expédition et Flair (caverne) payés avec les ressources
  u.mini.res.pierre = 500; u.mini.res.baies = 500;
  mini.buyUpgrade(u, 'luck_mine');
  assert.strictEqual(u.mini.res.pierre, 500 - GD.miniUpgradeCost('luck_mine', 0).pierre);
  mini.buyUpgrade(u, 'vie');
  const run = mini.start(u, 'mine', {}, { now: T0 });
  assert.strictEqual(run.max, M.BASE.hp + M.UPGRADES.vie.per, 'statistiques propres aux mini-jeux');
  assert.strictEqual(run.gen.luck, 1);
  const base = X.genRoom('mine', 5, 3, {}).nodes.length, more = X.genRoom('mine', 5, 3, { luck: 6 }).nodes.length;
  assert.ok(more > base, 'Flair : plus de points de récolte');
  // l'ours porteur ajoute des cases de sac
  assert.strictEqual(X.bagCap({}, [{ kind: 'k_ours', rarity: 0 }]), 5 + Math.round(GD.petPower('k_ours', 0).carry * 30));
});

test('mini-jeux (simulation) : parade parfaite = coup renvoyé ; bouclier levé trop tôt = blocage ; bouclier brisé', () => {
  // parade : bouclier levé moins de 0,22 s avant le coup
  let s = arena([{ type: 'sanglier', x: 515, y: 300 }]);
  const m = s.mobs[0], hp0 = m.hp;
  for (let i = 0; i < 400 && !(m.wind > 0 && m.wind < 0.12); i++) X.stepSim(s, 0.02, {});
  assert.ok(m.wind > 0, 'le monstre prépare son coup');
  for (let i = 0; i < 20; i++) X.stepSim(s, 0.02, { shield: true });
  assert.ok(s.events.some((e) => e.k === 'parry'), 'parade parfaite');
  assert.strictEqual(s.hero.hp, 100, 'aucun dégât');
  assert.ok(m.hp < hp0, 'le coup est renvoyé au monstre');
  // blocage : bouclier levé trop tôt, il encaisse avec ses points
  s = arena([{ type: 'sanglier', x: 515, y: 300 }]);
  const m2 = s.mobs[0];
  for (let i = 0; i < 400 && !(m2.wind > 0); i++) X.stepSim(s, 0.02, {});
  for (let i = 0; i < 30; i++) X.stepSim(s, 0.02, { shield: true });
  assert.ok(s.events.some((e) => e.k === 'block') && !s.events.some((e) => e.k === 'parry'));
  assert.ok(s.hero.shield < 20);
  // bouclier presque vide : il se brise et le reste passe
  s = arena([{ type: 'sanglier', x: 515, y: 300 }], null, { shield: 2 });
  const m3 = s.mobs[0];
  for (let i = 0; i < 400 && !(m3.wind > 0); i++) X.stepSim(s, 0.02, {});
  for (let i = 0; i < 30; i++) X.stepSim(s, 0.02, { shield: true });
  assert.ok(s.events.some((e) => e.k === 'shieldBreak'));
  assert.ok(s.hero.hp < 100 && s.hero.broken > 0);
  // projectile paré : il repart vers les monstres
  s = arena([]);
  s.projs.push({ owner: 'mob', x: 525, y: 284, vx: -240, vy: 0, life: 2, dmg: 9, kind: 'arrow', r: 8, scale: 1 });
  for (let i = 0; i < 30 && !s.events.some((e) => e.k === 'parry'); i++) X.stepSim(s, 0.02, { shield: true });
  assert.ok(s.projs.length === 1 && s.projs[0].owner === 'hero' && s.projs[0].vx > 0, 'flèche renvoyée');
});

test('mini-jeux (simulation) : récolte avec la touche d’attaque, sac plein, sortie après 10 s, renforts après 45 s', () => {
  // récolte : même bouton que l'attaque, vers le point visé
  let s = arena([], { nodes: [{ i: 0, x: 530, y: 300, k: 0, r: 24, gold: 0, amt: 40 }] }, { bagCap: 1 });
  for (let i = 0; i < 120; i++) X.stepSim(s, 0.05, { attack: true, ax: 530, ay: 300 });
  assert.deepStrictEqual(s.bag, [{ r: 'pierre', n: 15 }], 'une case = 15 ressources');
  assert.ok(s.events.some((e) => e.k === 'bagfull'), 'sac plein signalé');
  assert.strictEqual(s.ops.filter((o) => o[0] === 'h').reduce((a, o) => a + o[2], 0), 15, 'opérations envoyées au serveur');
  assert.strictEqual(s.nodes[0].left, 25);
  // sortie : cavité ouverte au bout de 10 s
  s = arena([]);
  for (let i = 0; i < 195; i++) X.stepSim(s, 0.05, {});
  assert.ok(!s.exitOpen);
  for (let i = 0; i < 10; i++) X.stepSim(s, 0.05, {});
  assert.ok(s.exitOpen);
  // renforts 20 s après l'entrée dans la salle
  s.hero.hp = s.hero.max = 1e6;
  for (let i = 0; i < 1200 && !s.events.some((e) => e.k === 'reinforce'); i++) X.stepSim(s, 0.05, {});
  assert.ok(s.mobs.some((m) => m.reinf), 'des renforts arrivent');
  assert.ok(Math.abs(s.t - M.REINFORCE.after) < 0.1, 'au bout de 20 s');
  // salle d'élite ou de gardien : aucun renfort
  const b = arena([{ type: 'sanglier', x: 900, y: 540 }], { boss: 0 });
  b.hero.hp = b.hero.max = 1e6;
  for (let i = 0; i < 20 * 60; i++) X.stepSim(b, 0.05, {});
  assert.ok(!b.mobs.some((m) => m.reinf), 'pas de renforts en salle de boss');
  // le héros saute dans la cavité
  s.hero.x = 820; s.hero.y = 470;
  X.stepSim(s, 0.05, {});
  assert.ok(s.exitReached);
  // forêt : on sort par l'ouverture d'un côté
  const R = X.genRoom('foret', 9, 3, {});
  const f = X.createSim({ room: { ...R, mobs: [] }, cls: 'archer', hp: 99, max: 99, dmg: 10, crit: 0, armor: 0, shield: 20, pets: [], potions: 0, bag: [], bagCap: 5, cart: null });
  X.openExit(f);
  const W = M.ARENA.WALL, dir = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }[R.exit.side];
  f.hero.x = R.exit.side === 'w' ? W + 20 : R.exit.side === 'e' ? M.ARENA.W - W - 20 : R.exit.x;
  f.hero.y = R.exit.side === 'n' ? W + 20 : R.exit.side === 's' ? M.ARENA.H - W - 20 : R.exit.y;
  for (let i = 0; i < 60 && !f.exitReached; i++) X.stepSim(f, 0.05, { mx: dir[0], my: dir[1] });
  assert.ok(f.exitReached, 'sortie par le côté ' + R.exit.side);
});

test('mini-jeux (simulation) : fontaine 10 PV/s pendant 3 s ; monstres qui foncent sur le héros ; renforts toutes les 5 s', () => {
  // fontaine : 30 PV au plus par salle de repos
  let s = arena([], { fountain: { x: 520, y: 300, r: 34 } });
  s.hero.hp = 10;
  for (let i = 0; i < 200; i++) X.stepSim(s, 0.05, {});
  assert.strictEqual(Math.round(s.hero.hp), 10 + M.FOUNTAIN.hps * M.FOUNTAIN.time);
  assert.ok(s.fountainLeft <= 0);
  // un monstre loin du héros se réveille et vient vers lui
  s = arena([{ type: 'sanglier', x: 880, y: 520 }]);
  const d0 = Math.hypot(s.mobs[0].x - 480, s.mobs[0].y - 300);
  for (let i = 0; i < 40; i++) X.stepSim(s, 0.05, {});
  assert.ok(s.mobs[0].aggro && Math.hypot(s.mobs[0].x - 480, s.mobs[0].y - 300) < d0 - 60, 'il fonce vers le héros');
  // renforts : 25 s après l'ouverture de la sortie, puis toutes les 5 s
  s = arena([]);
  s.hero.hp = s.hero.max = 1e7;
  for (let i = 0; i < 20 * (M.REINFORCE.after + M.REINFORCE.every) + 4; i++) X.stepSim(s, 0.05, {});
  assert.strictEqual(s.mobs.filter((m) => m.reinf).length, 2 * M.REINFORCE.count);
  assert.ok(s.mobs.every((m) => m.i >= X.REINF0), 'renforts numérotés');
  assert.deepStrictEqual(X.reinfSpec('mine', 1, 1, 0, 3), X.reinfSpec('mine', 1, 1, 0, 3), 'déterministes');
});

test('mini-jeux : les renforts tués comptent mais ne lâchent jamais de butin', () => {
  const u = user();
  const run = mini.start(u, 'foret', {}, { now: T0, rnd: fixed(0.3) });
  for (let i = 0; i < 200; i++) assert.deepStrictEqual(X.reinfSpec('foret', run.seed, 1, 0, i).drops, []);
  // trop tôt : impossible d'avoir déjà vu autant de renforts
  mini.act(u, { action: 'sync', report: { k: [X.REINF0 + 500], ops: [] } }, { now: T0 + 2000 });
  assert.strictEqual(run.kills, 0);
  const id = X.REINF0 + 3;
  mini.act(u, { action: 'sync', report: { k: [id], ops: [['p', `m${id}_0`, 1]] } }, { now: T0 + 60000 });
  assert.strictEqual(run.kills, 1);
  assert.deepStrictEqual(run.bag, [], 'rien à ramasser');
});

test('mini-jeux : vitesse et vitesse d’attaque (butins des monstres) ; seau posé à un endroit fixe de chaque salle', () => {
  const u = user();
  mini.ensure(u);
  assert.throws(() => mini.buyUpgrade(u, 'vitesse'), /butins/);
  u.mini.trophies = { ...GD.miniUpgradeCost('vitesse', 0), ...GD.miniUpgradeCost('cadence', 0) };
  mini.buyUpgrade(u, 'vitesse'); mini.buyUpgrade(u, 'cadence');
  const run = mini.start(u, 'mine', {}, { now: T0 });
  assert.strictEqual(run.speed, M.BASE.speed + M.UPGRADES.vitesse.per);
  assert.strictEqual(run.haste, M.UPGRADES.cadence.per);
  // le héros va plus vite et frappe plus souvent
  const fast = arena([], null, { speed: 250 }), slow = arena([]);
  for (let i = 0; i < 10; i++) { X.stepSim(fast, 0.05, { mx: 1 }); X.stepSim(slow, 0.05, { mx: 1 }); }
  assert.ok(fast.hero.x - 480 > (slow.hero.x - 480) * 1.3);
  const quick = arena([], null, { haste: 0.4 });
  for (let i = 0; i < 20; i++) X.stepSim(quick, 0.05, { attack: true, ax: 600, ay: 300 });
  assert.ok(quick.hero.atkCd <= M.HERO.atkCd / 1.4 + 1e-9);
  // seau : toujours au même endroit de la salle (tiré au hasard), il ne suit pas le héros
  const R = X.genRoom('mine', 31, 4, {});
  assert.deepStrictEqual(R.cart, X.genRoom('mine', 31, 4, {}).cart);
  assert.notDeepStrictEqual(R.cart, X.genRoom('mine', 31, 6, {}).cart);
  const s = X.createSim({ room: { ...R, mobs: [] }, cls: 'paladin', hp: 99, max: 99, dmg: 10, crit: 0, armor: 0, shield: 20, pets: [], potions: 0, bag: [], bagCap: 5, cart: { items: [], cap: 10, here: true, skin: 'seau' } });
  for (let i = 0; i < 40; i++) X.stepSim(s, 0.05, { mx: 1, my: 0.3 });
  assert.deepStrictEqual({ x: s.cart.x, y: s.cart.y }, R.cart);
});

test('mini-jeux (simulation) : sprint (Maj) ×1,5 avec une jauge d’endurance qui s’épuise puis remonte', () => {
  assert.strictEqual(M.BASE.speed, 150);
  const walk = arena([]), run = arena([]);
  for (let i = 0; i < 10; i++) { X.stepSim(walk, 0.05, { mx: 1 }); X.stepSim(run, 0.05, { mx: 1, sprint: true }); }
  assert.ok(Math.abs((run.hero.x - 480) / (walk.hero.x - 480) - M.SPRINT.mult) < 0.01, 'vitesse ×1,5');
  assert.ok(run.hero.stamina < M.BASE.stamina);
  for (let i = 0; i < 200 && run.hero.stamina > 0; i++) X.stepSim(run, 0.05, { mx: i % 2 ? 1 : -1, sprint: true });
  X.stepSim(run, 0.05, { mx: 1, sprint: true });
  assert.ok(run.hero.stamina < 1 && !run.hero.sprinting, 'endurance épuisée : plus de sprint');
  for (let i = 0; i < 60; i++) X.stepSim(run, 0.05, {});
  assert.ok(run.hero.stamina > 30, 'elle remonte au repos');
  // l'amélioration « Endurance » (butins) agrandit la jauge
  assert.strictEqual(GD.miniStats({ endurance: 2 }).stamina, M.BASE.stamina + 2 * M.UPGRADES.endurance.per);
  assert.strictEqual(arena([], null, { stamina: 150 }).hero.staminaMax, 150);
});

test('mini-jeux (simulation) : roulade (Espace) — bond, 2 s d’invulnérabilité, 50 d’endurance', () => {
  const s = arena([]);
  X.stepSim(s, 0.05, { mx: 1, roll: true });
  assert.strictEqual(s.hero.stamina, M.BASE.stamina - M.ROLL.cost);
  assert.ok(s.events.some((e) => e.k === 'roll'));
  for (let i = 0; i < 6; i++) X.stepSim(s, 0.05, {});
  assert.ok(s.hero.x - 480 > M.ROLL.speed * M.ROLL.dash * 0.8, 'le héros bondit');
  // invulnérable : une flèche qui l'atteint ne fait rien
  const shoot = () => s.projs.push({ owner: 'mob', x: s.hero.x + 40, y: s.hero.y - 16, vx: -300, vy: 0, life: 2, dmg: 30, kind: 'arrow', r: 8, scale: 1 });
  shoot();
  for (let i = 0; i < 8; i++) X.stepSim(s, 0.05, {});
  assert.strictEqual(s.hero.hp, 100, 'invulnérable');
  assert.strictEqual(s.hero.stamina, M.BASE.stamina - M.ROLL.cost, 'pas de récupération pendant l’invulnérabilité');
  // pas assez d'endurance pour une deuxième roulade de suite ? si : 50 restants ; une troisième, non
  X.stepSim(s, 0.05, { roll: true });
  for (let i = 0; i < 10; i++) X.stepSim(s, 0.05, {});
  X.stepSim(s, 0.05, { roll: true });
  assert.ok(s.events.some((e) => e.k === 'tired'), 'plus assez d’endurance');
  // après 2 s, il redevient vulnérable
  for (let i = 0; i < 50; i++) X.stepSim(s, 0.05, {});
  assert.strictEqual(s.hero.invT, 0);
  shoot();
  for (let i = 0; i < 8; i++) X.stepSim(s, 0.05, {});
  assert.ok(s.hero.hp < 100, 'touché après l’invulnérabilité');
});
