'use strict';
/*
 * Mini-jeux solo en temps réel, vus du dessus (onglet « Mini-jeux ») : caverne (pierre), forêt (bois), clairière (baies).
 *   - une expédition coûte 1 énergie (1 toutes les 6 h, 3 au plus) ; les salles s'enchaînent, la sortie apparaît après 10 s
 *     (une cavité dans la caverne, une ouverture dans un côté ailleurs) ; élite toutes les 5 salles, gardien toutes les 10
 *   - le héros remplit son sac (récolte, butins des monstres) et le vide dans le seau / la charrette qui le suit ;
 *     renvoyé(e) à la base, son contenu est à l'abri et il/elle revient 2 salles plus tard ; « Rentrer » termine l'expédition
 *   - mort : tout ce qui n'a pas été renvoyé est perdu, sauf 25 % des ressources du sac (et la poche sécurisée)
 * La page simule la salle (shared/expedition.js) et envoie des rapports : le serveur les valide (monstres de la salle,
 * ressources disponibles, butins tombés, place dans le sac) et garde l'inventaire.
 */
const GD = require('../shared/constants');
const X = require('../shared/expedition');
const pets = require('./pets');
const { MINI } = GD;
const ENERGY_MS = MINI.ENERGY_HOURS * 3600e3;

class MiniError extends Error {}
const fail = (msg) => { throw new MiniError(msg); };

// Données mini-jeux du profil, avec régénération de l'énergie
function ensure(u, now = Date.now()) {
  u.mini ||= {};
  const m = u.mini;
  m.res = { pierre: 0, bois: 0, baies: 0, ...(m.res || {}) };
  m.trophies ||= {};
  m.up ||= {};
  m.best ||= {};
  if (m.energy === undefined) { m.energy = MINI.ENERGY_MAX; m.energyAt = now; }
  if (m.energy >= MINI.ENERGY_MAX) m.energyAt = now;
  else {
    const g = Math.floor((now - m.energyAt) / ENERGY_MS);
    if (g > 0) {
      m.energy = Math.min(MINI.ENERGY_MAX, m.energy + g);
      m.energyAt = m.energy >= MINI.ENERGY_MAX ? now : m.energyAt + g * ENERGY_MS;
    }
  }
  // ancienne expédition au tour par tour : abandonnée, l'énergie est rendue
  if (m.run && m.run.v !== 2) { if (m.run.state !== 'over') m.energy = Math.min(99, m.energy + 1); m.run = null; }
  return m;
}

function log(run, text) {
  run.log.push(text);
  if (run.log.length > 8) run.log.shift();
}
const roomOf = (run) => X.genRoom(run.mode, run.seed, run.room, run.gen);
const bagCapOf = (u, run) => X.bagCap(u.mini.up, run.pets);
const cartHere = (run) => !run.cart.back;
const cartName = (run, cap) => (run.cart.skin === 'seau' ? (cap ? 'Le seau' : 'le seau') : cap ? 'La charrette' : 'la charrette');

// Range des objets à la base (compte) ; o = { res, tro } (totaux) ; into : totaux à compléter
function bank(m, o, into) {
  for (const [k, n] of Object.entries(o.res || {})) { m.res[k] = (m.res[k] || 0) + n; if (into) into.res[k] = (into.res[k] || 0) + n; }
  for (const [k, n] of Object.entries(o.tro || {})) { m.trophies[k] = (m.trophies[k] || 0) + n; if (into) into.tro[k] = (into.tro[k] || 0) + n; }
}
const addTot = (a, b) => { for (const [k, n] of Object.entries(b.res || {})) a.res[k] = (a.res[k] || 0) + n; for (const [k, n] of Object.entries(b.tro || {})) a.tro[k] = (a.tro[k] || 0) + n; return a; };

function newRoom(run, now) {
  run.room++;
  const R = roomOf(run);
  run.type = R.type;
  run.roomAt = now;
  run.cur = { killed: [], harv: {}, picked: {}, extra: [], reward: R.boss >= 0 ? 'todo' : null };
  run.state = 'room';
  run.rewards = null;
  // le seau / la charrette renvoyé(e) revient 2 salles plus tard
  if (run.cart.back && run.room >= run.cart.back) { run.cart.back = 0; log(run, `${cartName(run, true)} ${run.cart.skin === 'seau' ? 'est revenu' : 'est revenue'} !`); }
  const RT = MINI.ROOMS[R.type];
  log(run, `Salle ${run.room} · ${RT.icon} ${RT.name}`);
  return R;
}

function start(u, mode, gear, opts = {}) {
  const now = opts.now || Date.now(), rnd = opts.rnd || Math.random;
  const m = ensure(u, now);
  if (!MINI.MODES[mode]) fail('Mini-jeu inconnu');
  if (m.run && m.run.state !== 'over') fail('Une expédition est déjà en cours');
  if (m.energy < 1) fail('Plus d’énergie : reviens plus tard');
  if (m.energy >= MINI.ENERGY_MAX) m.energyAt = now;
  m.energy--;
  const st = GD.miniStats(m.up), M = MINI.MODES[mode];
  m.run = {
    v: 2, mode, seed: Math.floor(rnd() * 1e9), room: 0, state: 'room',
    gen: { luck: m.up['luck_' + mode] || 0, bounty: m.up['bounty_' + mode] || 0, jackpot: m.up['jackpot_' + mode] || 0, fortune: m.up['fortune_' + mode] || 0 },
    hp: st.hp, max: st.hp, baseMax: st.hp, dmg: st.dmg, crit: st.crit, armor: st.armor, shield: st.shield,
    buff: { dmg: 0, hp: 0, crit: 0 }, potions: MINI.POTIONS + (m.up.potion || 0),
    xp: 0, kills: 0, grelons: 0, log: [],
    bag: [], cart: { items: [], back: 0, skin: M.cart }, sent: { res: {}, tro: {} },
    pets: pets.forRun(u)
  };
  log(m.run, `${M.icon} ${M.verb}…`);
  newRoom(m.run, now);
  return m.run;
}

/* Rapport de la page (depuis le dernier envoi) :
 *   k : index des monstres tués dans la salle (liste complète)
 *   ops : opérations dans l'ordre — ['h', point, n] récolte · ['p', butin, n] ramassage · ['pot'] potion
 *   hp : PV du héros · pets : PV des familiers */
function applyReport(u, run, rep, rnd = Math.random, now = Date.now()) {
  if (!rep || run.state === 'over') return;
  const R = roomOf(run), cur = run.cur, cap = bagCapOf(u, run), res = MINI.MODES[run.mode].res;
  // renforts : numérotés à partir de X.REINF0 ; leur nombre est borné par le temps passé dans la salle
  const maxReinf = Math.ceil(Math.max(0, now - run.roomAt) / 1000 * 0.8) + 4;
  for (const v of Array.isArray(rep.k) ? rep.k : []) {
    const i = Number.isInteger(v) ? v : -1;
    if (i < 0 || cur.killed.includes(i)) continue;
    if (i >= X.REINF0 ? i - X.REINF0 >= maxReinf : !R.mobs[i]) continue;
    const mob = X.mobAt(R, i);
    cur.killed.push(i); run.kills++; run.xp += mob.xp;
  }
  for (const op of Array.isArray(rep.ops) ? rep.ops.slice(0, 2000) : []) {
    if (!Array.isArray(op)) continue;
    if (op[0] === 'h') { // récolte d'un point (dans la limite de ce qu'il contient et de la place dans le sac)
      const node = R.nodes[op[1] | 0];
      if (!node) continue;
      const want = Math.min(Math.max(0, op[2] | 0), node.amt - (cur.harv[node.i] || 0));
      if (want <= 0) continue;
      cur.harv[node.i] = (cur.harv[node.i] || 0) + X.addRes(run.bag, cap, res, want);
    } else if (op[0] === 'p') { // ramassage d'un butin tombé d'un monstre tué, ou d'un tas de ressources
      const id = String(op[1]);
      const mm = /^m(\d+)_(\d+)$/.exec(id);
      if (mm) {
        const mi = mm[1] | 0, mob = cur.killed.includes(mi) ? X.mobAt(R, mi) : null, t = mob && mob.drops[mm[2] | 0];
        if (!t || !cur.killed.includes(mob.i) || cur.picked[id]) continue;
        if (X.addTrophy(run.bag, cap, t)) cur.picked[id] = 1;
      } else {
        const pile = cur.extra.find((x) => x.id === id);
        if (!pile) continue;
        const want = Math.min(Math.max(0, op[2] | 0), pile.n - (cur.picked[id] || 0));
        if (want > 0) cur.picked[id] = (cur.picked[id] || 0) + X.addRes(run.bag, cap, pile.res, want);
      }
    } else if (op[0] === 'pot') { if (run.potions > 0) run.potions--; }
  }
  if (typeof rep.hp === 'number' && isFinite(rep.hp)) run.hp = Math.max(0, Math.min(run.max, Math.round(rep.hp)));
  if (Array.isArray(rep.pets)) run.pets.forEach((p, i) => { const v = Number(rep.pets[i]); if (isFinite(v)) p.hp = Math.max(0, Math.min(p.hp, Math.round(v))); });
  // élite / gardien vaincu : choix de récompense
  if (cur.reward === 'todo' && R.mobs[0] && (R.mobs[0].boss || R.mobs[0].elite) && cur.killed.includes(0)) {
    const keys = Object.keys(MINI.ELITE_REWARDS).filter((k) => k !== 'egg').sort(() => rnd() - 0.5).slice(0, 3);
    if (rnd() < GD.PETS.EGG_CHANCE) keys[Math.floor(rnd() * 3)] = 'egg'; // œuf mystérieux : 10 % de chances
    run.rewards = keys; run.state = 'reward'; cur.reward = 'pending';
    log(run, `${R.mobs[0].name} est vaincu ! Choisis une récompense.`);
  }
}

// Fin de l'expédition : mort (tout le non-renvoyé est perdu, sauf 25 % des ressources du sac) ou retour à la base
function finish(u, m, run, dead, grantXp) {
  const banked = addTot({ res: {}, tro: {} }, run.sent), lost = { res: {}, tro: {} }; // déjà renvoyé : à l'abri
  if (dead) {
    const sp = X.deathSplit(run.bag, X.hasPocket(m.up));
    bank(m, sp.kept, banked);
    addTot(lost, sp.lost);
    if (cartHere(run)) addTot(lost, X.totals(run.cart.items));
  } else {
    bank(m, X.totals(run.bag), banked);
    if (cartHere(run)) bank(m, X.totals(run.cart.items), banked);
  }
  run.bag = [];
  if (cartHere(run)) run.cart.items = [];
  const levels = grantXp ? grantXp(u, run.xp) || 0 : 0;
  m.best[run.mode] = Math.max(m.best[run.mode] || 0, run.room);
  const petUps = pets.afterRun(u, run);
  run.state = 'over';
  run.over = { dead, room: run.room, kills: run.kills, xp: run.xp, grelons: run.grelons, levels, banked, lost, petUps };
  log(run, dead ? 'Ton héros est tombé…' : 'De retour à la base !');
}

// Action de la page : sync · exit · deposit · send · home · die · reward · close
function act(u, body, opts = {}) {
  const now = opts.now || Date.now();
  const m = ensure(u, now);
  const run = m.run;
  if (!run) fail('Aucune expédition en cours');
  const a = body.action;
  if (a === 'close') { if (run.state !== 'over') fail('L’expédition n’est pas terminée'); m.run = null; return null; }
  if (run.state === 'over') fail('L’expédition est terminée');
  applyReport(u, run, body.report, opts.rnd, now);
  if (a === 'sync') return run;
  if (a === 'die') { run.hp = 0; finish(u, m, run, true, opts.grantXp); return run; }
  if (a === 'reward') {
    if (run.state !== 'reward' || !run.rewards.includes(body.id)) fail('Récompense inconnue');
    const k = body.id, RW = MINI.ELITE_REWARDS[k];
    if (k === 'dmg') run.buff.dmg += 0.2;
    else if (k === 'crit') run.buff.crit += 0.1;
    else if (k === 'hp') { run.buff.hp += 0.2; const nm = Math.round(run.baseMax * (1 + run.buff.hp)); run.hp += nm - run.max; run.max = nm; }
    else if (k === 'heal') run.hp = run.max;
    else if (k === 'res') { // tas de ressources à ramasser à l'entrée de la salle (toujours dégagée)
      const n = Math.round(20 + run.room * 4), E = roomOf(run).entry;
      run.cur.extra.push({ id: 'x' + run.cur.extra.length, res: MINI.MODES[run.mode].res, n, x: Math.round(E.x), y: Math.round(E.y) });
    } else if (k === 'grelons') { const n = 15 + run.room * 2; run.grelons += n; u.gold = (u.gold || 0) + n; }
    else if (k === 'potion') run.potions++;
    else if (k === 'egg') pets.addEgg(u, run.mode, Math.min(2, Math.floor((run.room - 1) / MINI.DECOR_ROOMS)), now);
    log(run, `Récompense : ${RW.icon} ${RW.name}${k === 'egg' ? ` (éclosion dans ${GD.PETS.INCUBATION_MIN} min)` : ''}`);
    run.state = 'room'; run.cur.reward = 'done'; run.rewards = null;
    return run;
  }
  if (run.state === 'reward') fail('Choisis d’abord ta récompense');
  const ccap = X.cartCap(m.up);
  if (a === 'deposit') { // sac → seau / charrette (une case, ou tout)
    if (!cartHere(run)) fail(`${cartName(run, true)} n’est pas là`);
    if (body.slot === 'all') X.moveAll(run.bag, run.cart.items, ccap);
    else if (!X.moveSlot(run.bag, body.slot | 0, run.cart.items, ccap)) fail(`Plus de place dans ${cartName(run)}`);
    return run;
  }
  if (a === 'send') { // renvoyer à la base : le contenu est à l'abri, retour 2 salles plus tard
    if (!cartHere(run)) fail(`${cartName(run, true)} n’est pas là`);
    if (!run.cart.items.length) fail(`${cartName(run, true)} est vide`);
    bank(m, X.totals(run.cart.items), run.sent);
    run.cart.items = []; run.cart.back = run.room + MINI.CART.away;
    log(run, `${cartName(run, true)} repart à la base : retour dans ${MINI.CART.away} salles`);
    return run;
  }
  if (a === 'home') { // rentrer avec le seau / la charrette
    if (!cartHere(run)) fail(`Il faut ${cartName(run)} pour rentrer`);
    finish(u, m, run, false, opts.grantXp);
    return run;
  }
  if (a === 'exit') {
    const R = roomOf(run);
    if (R.boss >= 0) { if (run.cur.reward !== 'done') fail('La sortie n’est pas encore ouverte'); }
    else if (now - run.roomAt < (R.exitDelay - 1) * 1000) fail('La sortie n’est pas encore ouverte');
    newRoom(run, now);
    return run;
  }
  fail('Action inconnue');
}

function buyUpgrade(u, id) {
  const m = ensure(u);
  const U = MINI.UPGRADES[id.split('_')[0]];
  const lvl = m.up[id] || 0;
  if (!U || !GD.miniUpgradeIds().includes(id)) fail('Amélioration inconnue');
  if (lvl >= U.max) fail('Déjà au niveau maximum');
  const cost = GD.miniUpgradeCost(id, lvl);
  if (!cost) fail('Amélioration inconnue');
  const stock = U.trophy ? m.trophies : m.res;
  if (!GD.canPay(stock, cost)) fail(U.trophy ? 'Pas assez de butins' : 'Pas assez de ressources');
  for (const [k, n] of Object.entries(cost)) stock[k] -= n;
  m.up[id] = lvl + 1;
  return m;
}

// État envoyé à la page (la graine sert à générer les salles à l'identique)
function publicState(u, now = Date.now()) {
  const m = ensure(u, now);
  const run = m.run;
  return {
    energy: m.energy, max: MINI.ENERGY_MAX,
    nextIn: m.energy >= MINI.ENERGY_MAX ? null : Math.max(0, m.energyAt + ENERGY_MS - now),
    res: m.res, trophies: m.trophies, up: m.up, best: m.best,
    run: run ? { ...run, bagCap: X.bagCap(m.up, run.pets), cartCap: X.cartCap(m.up), pocket: X.hasPocket(m.up), roomAge: now - run.roomAt } : null,
    pets: pets.publicState(u, now)
  };
}

module.exports = { MiniError, ensure, start, act, buyUpgrade, publicState };
