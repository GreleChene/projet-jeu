'use strict';
/*
 * Mini-jeux en temps réel : un bot joue des expéditions complètes (moteur shared/expedition.js + serveur server/mini.js)
 * et mesure la salle atteinte, les morts, ce qui est rapporté (ressources, butins) et la durée.
 *   node tools/sim/minijeux.js [--mode=mine|foret|champ|tous] [--n=30] [--classe=paladin] [--parade=0.4]
 *                              [--familiers=k_loup,araignee:3] [--rentrer=15]
 * Le bot : se bat contre le monstre le plus proche (compétence dès qu'elle est prête), lève le bouclier au bon moment,
 * roule (Espace) pour esquiver les attaques annoncées des gardiens ou quand ses PV sont bas,
 * avec une probabilité --parade (habileté du joueur), récolte tant que le sac n'est pas plein, vide le sac dans le seau,
 * renvoie le seau quand il est presque plein, prend la sortie quand il n'y a plus rien à faire (ou avant les renforts),
 * boit une potion sous 35 % de PV et rentre avec le seau quand ses PV sont bas sans potion (ou à la salle --rentrer).
 * Repères : sans amélioration ≈ salles 6-10, à mi-chemin ≈ 15-20, au maximum ≈ 25+ ; la mort doit rester un vrai risque.
 */
const GD = require('../../shared/constants');
const X = require('../../shared/expedition');
const mini = require('../../server/mini');
const { args } = require('./lib');
const A = args();
const MODES = !A.mode || A.mode === 'tous' ? Object.keys(GD.MINI.MODES) : [A.mode];
const N = Number(A.n || 30), CLS = A.classe || 'paladin', PARRY = A.parade === undefined ? 0.4 : Number(A.parade);
const HOME_AT = A.rentrer ? Number(A.rentrer) : Infinity;
const PETS = A.familiers ? String(A.familiers).split(',') : [];
const DT = 0.05, M = GD.MINI;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clone = (a) => (a || []).map((x) => ({ ...x }));
const PREF = ['hp', 'dmg', 'crit', 'potion', 'egg', 'res', 'heal', 'grelons'];

function makeUser(tier) {
  const up = {};
  for (const [k, U] of Object.entries(M.UPGRADES)) if (U.stat || U.trophy) up[k] = Math.round(U.max * tier);
  for (const m of Object.keys(M.MODES)) for (const k of ['luck', 'bounty', 'jackpot', 'fortune']) up[`${k}_${m}`] = Math.round(M.UPGRADES[k].max * tier);
  const now = Date.now();
  return {
    cls: CLS, level: 30, attrs: GD.emptyAttrs(), skills: {}, gold: 0, xp: 0,
    mini: { energy: 3, energyAt: now, up },
    pets: { list: PETS.map((s, i) => { const [kind, r] = s.split(':'); return { id: 'p' + i, kind, rarity: Number(r) || 0, level: 1, xp: 0, hp: GD.petMaxHp(kind, Number(r) || 0), at: now }; }), active: PETS.map((s, i) => 'p' + i), main: null }
  };
}

// Une expédition complète
function expedition(mode, tier) {
  const u = makeUser(tier);
  let now = 1e12;
  const run = mini.start(u, mode, {}, { now });
  const st = { deposits: 0, sends: 0, parries: 0, hurt: 0, roomTime: 0 };
  let s = null, roomNo = 0;
  const report = () => ({ k: [...s.killed], ops: s.ops.splice(0), hp: Math.round(s.hero.hp), pets: s.pets.map((p) => Math.max(0, Math.round(p.hp))) });
  const act = (action, extra) => mini.act(u, { action, report: report(), ...(extra || {}) }, { now, grantXp: () => 0 });
  // salle simulée à partir de l'état du serveur (comme la page)
  function build() {
    const room = X.genRoom(run.mode, run.seed, run.room, run.gen);
    s = X.createSim({ room, cls: CLS, hp: run.hp, max: run.max, dmg: run.dmg, crit: run.crit, armor: run.armor, shield: run.shield, speed: run.speed, haste: run.haste, stamina: run.stamina,
      buff: { dmg: run.buff.dmg, crit: run.buff.crit }, pets: clone(run.pets), potions: run.potions, bag: clone(run.bag), bagCap: X.bagCap(u.mini.up, run.pets),
      cart: { items: clone(run.cart.items), cap: X.cartCap(u.mini.up), here: !run.cart.back, skin: run.cart.skin },
      killed: run.cur.killed, harv: run.cur.harv, picked: run.cur.picked, extra: run.cur.extra, rewardDone: run.cur.reward === 'done' });
    roomNo = run.room;
  }
  // après une action : l'inventaire du serveur fait foi
  function sync() {
    s.bag.splice(0, s.bag.length, ...clone(run.bag));
    s.cart.items = clone(run.cart.items); s.cart.here = !run.cart.back;
    s.potions = run.potions; s.hero.buff = { dmg: run.buff.dmg, crit: run.buff.crit };
  }
  build();
  for (let guard = 0; guard < 400000 && run.state !== 'over'; guard++) {
    if (run.state === 'reward') {
      const id = run.hp < run.max * 0.5 && run.rewards.includes('heal') ? 'heal' : PREF.find((k) => run.rewards.includes(k));
      act('reward', { id });
      s.hero.max = run.max; s.hero.hp = run.hp; sync();
      for (const x of run.cur.extra) if (!s.drops.some((d) => d.id === x.id)) s.drops.push({ id: x.id, r: x.res, n: x.n, x: x.x, y: x.y });
      X.openExit(s);
      continue;
    }
    if (run.room !== roomNo) build();
    const h = s.hero, C = s.cart;
    // rentrer avec le seau (PV bas sans potion, ou salle visée atteinte)
    if (C.here && X.startMobsLeft(s) === 0 && ((h.hp < h.max * 0.3 && s.potions === 0) || run.room >= HOME_AT)) { act('home'); break; }
    // vider le sac dans le seau, renvoyer le seau presque plein
    if (X.nearCart(s) && s.bag.length >= s.bagCap - 1 && C.items.length < C.cap) { act('deposit', { slot: 'all' }); sync(); st.deposits++; }
    if (C.here && C.items.length >= C.cap - 1) { act('send'); sync(); st.sends++; }
    X.stepSim(s, DT, decide(s));
    now += DT * 1000; st.roomTime += DT;
    for (const e of s.events.splice(0)) { if (e.k === 'parry') st.parries++; if (e.k === 'hurt') st.hurt++; }
    if (s.needReward) { s.needReward = false; act('sync'); }
    if (s.dead) { act('die'); break; }
    if (s.exitReached) { act('exit'); sync(); }
  }
  if (run.state !== 'over') act('die'); // garde-fou
  return { ...run.over, ...st, minutes: st.roomTime / 60 };
}

// Décision du bot pour un pas de simulation
function decide(s) {
  const h = s.hero, inp = { mx: 0, my: 0 };
  const go = (x, y, stop) => { const dx = x - h.x, dy = y - h.y, d = Math.hypot(dx, dy); if (d > (stop || 4)) { inp.mx = dx / d; inp.my = dy / d; if (d > 160 && h.stamina > h.staminaMax * 0.3) inp.sprint = true; } return d; };
  const mobs = s.mobs.filter((m) => !m.dead);
  // parade : on lève le bouclier juste avant le coup (avec la probabilité --parade, tirée une fois par coup préparé)
  for (const m of mobs) {
    if (m.wind > 0.3) m._p = Math.random() < PARRY;
    if (m.wind > 0 && m.wind < 0.12 && m._p && dist(m, h) < m.r + h.r + 50 && h.shield > 0 && h.broken <= 0) inp.shield = true;
  }
  for (const q of s.projs) if (q.owner === 'mob' && Math.hypot(q.x - h.x, q.y - h.y + 16) < 55 && (q._p === undefined ? (q._p = Math.random() < PARRY) : q._p)) inp.shield = true;
  if (h.hp < h.max * 0.35 && s.potions > 0) inp.potion = true;
  if (h.hp < h.max * 0.4 && h.stamina >= M.ROLL.cost && h.invT <= 0) {
    const th = mobs.find((m) => m.wind > 0 && m.wind < 0.15 && dist(m, h) < m.r + h.r + 50);
    if (th) { const a = Math.atan2(h.y - th.y, h.x - th.x); inp.mx = Math.cos(a); inp.my = Math.sin(a); inp.roll = true; return inp; }
  }
  // esquive des capacités annoncées des gardiens (onde de choc, charge)
  for (const m of mobs) {
    const c = m.cast;
    if (c && c.kind === 'slam' && Math.hypot(h.x - c.x, h.y - c.y) < c.r + 24) { const a = Math.atan2(h.y - c.y, h.x - c.x); inp.mx = Math.cos(a); inp.my = Math.sin(a); if (c.t < 0.35 && h.stamina >= M.ROLL.cost) inp.roll = true; return inp; }
    if (c && c.kind === 'charge' && c.phase === 0) {
      const px = -Math.sin(c.a), py = Math.cos(c.a), side = (h.x - m.x) * px + (h.y - m.y) * py, along = (h.x - m.x) * Math.cos(c.a) + (h.y - m.y) * Math.sin(c.a);
      if (along > 0 && Math.abs(side) < m.r + h.r + 20) { const k = side >= 0 ? 1 : -1; inp.mx = px * k; inp.my = py * k; if (c.t < 0.25 && h.stamina >= M.ROLL.cost) inp.roll = true; return inp; }
    }
  }
  const exitOpen = s.exitOpen, reinf = s.room.boss < 0 ? X.reinfAfter(s.room.room) : Infinity, since = s.t + 25 - reinf; // since > 25 - n : renforts dans n s
  // combat : le monstre le plus proche (éveillé ou à moins de 300 px)
  let tg = null, bd = 1e9;
  for (const m of mobs) { const d = dist(m, h); if ((m.aggro || d < 300) && d < bd) { bd = d; tg = m; } }
  if (tg && !(exitOpen && since > 25 - 8 && !tg.boss && !tg.elite)) {
    const reach = s.style === 'melee' ? tg.r + 44 : 230;
    go(tg.x, tg.y, reach - 12);
    inp.ax = tg.x; inp.ay = tg.y;
    if (bd <= reach + 6) inp.attack = true;
    if (h.skillCd <= 0 && bd < (s.style === 'melee' ? 100 : 260)) inp.skill = true;
    return inp;
  }
  // butins et tas de ressources
  const roomInBag = s.bag.length < s.bagCap;
  const drop = s.drops.find((d) => roomInBag || (!d.t && s.bag.some((x) => x.r === d.r && x.n < X.SLOT)));
  if (drop && since < 25 - 5) { go(drop.x, drop.y, 2); return inp; }
  // sac plein : vers le seau s'il est là et qu'il a de la place
  if (!roomInBag && s.cart.here && s.cart.items.length < s.cart.cap) { go(s.cart.x, s.cart.y, 40); return inp; }
  // récolte
  if (roomInBag && since < 25 - 6) {
    let n = null, nd = 1e9;
    for (const q of s.nodes) if (q.left > 0) { const d = dist(q, h); if (d < nd) { nd = d; n = q; } }
    if (n) { go(n.x, n.y, 48); inp.ax = n.x; inp.ay = n.y; if (nd < 60) inp.attack = true; return inp; }
  }
  // sortie
  if (exitOpen) {
    const e = s.room.exit;
    if (e.kind === 'hole') go(e.x, e.y, 0);
    else go(e.side === 'w' ? -40 : e.side === 'e' ? M.ARENA.W + 40 : e.x, e.side === 'n' ? -40 : e.side === 's' ? M.ARENA.H + 40 : e.y, 0);
    return inp;
  }
  // rien d'autre à faire (élite, gardien, ou sortie pas encore ouverte) : on va chercher le monstre le plus proche
  let far = null, fd = 1e9;
  for (const m of mobs) { const d = dist(m, h); if (d < fd) { fd = d; far = m; } }
  if (far) { go(far.x, far.y, 30); inp.ax = far.x; inp.ay = far.y; }
  return inp;
}

console.log(`Bot : ${GD.CLASSES[CLS] ? GD.CLASSES[CLS].name : CLS}, parade réussie ${Math.round(PARRY * 100)} %${PETS.length ? `, familiers ${PETS.join(' + ')}` : ''}${isFinite(HOME_AT) ? `, rentre à la salle ${HOME_AT}` : ''} · ${N} expéditions par ligne`);
for (const mode of MODES) {
  const R = GD.MINI.MODES[mode], icon = GD.RESOURCES[R.res].icon;
  console.log(`\n${R.icon} ${R.name}`);
  for (const tier of [0, 0.25, 0.5, 0.75, 1]) {
    const rs = Array.from({ length: N }, () => expedition(mode, tier));
    const avg = (f) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
    const rooms = rs.map((r) => r.room).sort((a, b) => a - b);
    const tro = (r) => Object.values(r.banked.tro || {}).reduce((a, b) => a + b, 0);
    console.log(`  améliorations ${String(Math.round(tier * 100)).padStart(3)} % : salle moy. ${avg((r) => r.room).toFixed(1)} (méd. ${rooms[N >> 1]}, max ${rooms[N - 1]}) · morts ${Math.round((100 * rs.filter((r) => r.dead).length) / N)} %`
      + ` · rapporté ${icon} ${Math.round(avg((r) => r.banked.res[R.res] || 0))} + ${avg(tro).toFixed(1)} butins · perdu ${icon} ${Math.round(avg((r) => (r.lost.res || {})[R.res] || 0))}`
      + ` · ${avg((r) => r.minutes).toFixed(1)} min · seau renvoyé ${avg((r) => r.sends).toFixed(1)}× · parades ${avg((r) => r.parries).toFixed(0)}`);
  }
}
