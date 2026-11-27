'use strict';
/*
 * Bastion (onglet « Bastion ») : défense de tour solo sur une carte en cases générée au hasard (shared/bastion.js).
 *   - une partie coûte 50 Grêlons ; atteindre la manche 30 (survivre aux 29 premières) les rembourse ;
 *     survivre à la manche 30 = victoire (la zone suivante se débloque), puis mode infini au choix ;
 *   - la page joue : elle envoie ses actions de construction au fil de l'eau (le serveur applique les mêmes, dans le même
 *     ordre), lance la vague, envoie les capacités utilisées (avec leur instant) puis demande la fin de la vague :
 *     le serveur REJOUE la vague entière à partir de son propre état — son résultat fait foi ;
 *   - une vague ne peut pas se terminer plus vite que la vitesse ×3 ne le permet (temps réel écoulé) ;
 *   - récompenses : XP (manches gagnées, versée en fin de partie), plans (chaque gardien lâche des plans de SA zone, tirés au
 *     hasard parmi ceux qui ne sont pas encore trouvés : jamais de doublon ; +1 à la première victoire dans une zone),
 *     œufs de familier (15 % à chaque manche de gardien). Aucune ressource des mini-jeux.
 * État : u.bastion = { run, best (meilleure manche survécue par zone), wins, unlocked (plans trouvés), games }.
 */
const GD = require('../shared/constants');
const BS = require('../shared/bastion');
const pets = require('./pets');
const ach = require('./achievements');
const AC = require('./anticheat');
const B = GD.BASTION;
const MAX_SPEED = Math.max(...B.SPEEDS);

class BastionError extends Error {}
const fail = (msg) => { throw new BastionError(msg); };

function ensure(u) {
  u.bastion ||= {};
  const S = u.bastion;
  S.best ||= {}; S.wins ||= {};
  if (!Array.isArray(S.unlocked)) S.unlocked = [];
  S.unlocked = S.unlocked.filter((k, i, a) => GD.bastionPlanZone(k) && a.indexOf(k) === i);
  S.games ||= 0;
  // anciens plans « à dépenser » : convertis en plans trouvés (dans l'ordre des zones)
  if (S.plans > 0) { for (const z of Object.keys(B.ZONES)) S.plans -= dropPlans(S, z, S.plans, Math.random).length; S.plans = 0; }
  delete S.plans; delete S.plansTotal;
  if (S.run === undefined) S.run = null;
  return S;
}
const zoneOpen = (S, zone) => { const Z = B.ZONES[zone]; return !!Z && (!Z.unlock || (S.wins[Z.unlock] || 0) > 0); };
const live = (S) => (S.run && !S.run.over ? S.run : null);

// Plans d'une zone encore à trouver : jamais un plan déjà trouvé ; une spécialisation seulement si son bâtiment est disponible
function planCandidates(S, zone) {
  return GD.bastionPlanKeys(zone).filter((k) => {
    if (S.unlocked.includes(k)) return false;
    const [t, sp] = k.split('/');
    return !sp || !B.BUILDINGS[t].plan || S.unlocked.includes(t);
  });
}
// Tire n plans de la zone (au hasard, sans doublon) ; renvoie les clés trouvées
function dropPlans(S, zone, n, rnd) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const cand = planCandidates(S, zone);
    if (!cand.length) break;
    const k = cand[Math.floor(rnd() * cand.length)];
    S.unlocked.push(k); out.push(k);
  }
  return out;
}
// plans trouvés pendant une partie : utilisables tout de suite
function grantPlans(u, S, run, keys) {
  for (const k of keys) {
    run.found.push(k);
    if (!run.G.unlocked.includes(k)) run.G.unlocked.push(k);
    if (run.next && !run.next.G.unlocked.includes(k)) run.next.G.unlocked.push(k);
    log(run, `📜 Plan trouvé : ${GD.bastionPlanName(k)}`);
  }
  if (keys.length) ach.add(u, 'bastionPlans', keys.length);
}

function start(u, zone, opts = {}) {
  const now = opts.now || Date.now(), rnd = opts.rnd || Math.random;
  const S = ensure(u);
  if (!B.ZONES[zone]) fail('Zone inconnue');
  if (!zoneOpen(S, zone)) fail(`Gagne d’abord une partie dans la zone « ${B.ZONES[B.ZONES[zone].unlock].name} »`);
  if (live(S)) fail('Une partie est déjà en cours : reprends-la ou abandonne-la');
  if ((u.gold || 0) < B.PRICE) fail(`Il faut ${B.PRICE} Grêlons pour lancer une partie`);
  u.gold -= B.PRICE;
  const seed = Math.floor(rnd() * 2147483647) >>> 0;
  S.run = { v: 2, zone, G: BS.newGame(zone, seed, S.unlocked), nops: 0, abil: [], launchAt: 0, startedAt: now, xp: 0, found: [], eggs: 0, refunded: false, log: [], over: null, next: null };
  return S.run;
}

// Actions de construction (dans l'ordre) ; from = nombre d'actions déjà appliquées selon la page (renvoi sans doublon)
function applyOps(u, from, list, now = Date.now()) {
  const run = live(ensure(u));
  if (!run) fail('Aucune partie en cours');
  if (!Array.isArray(list) || list.length > 80) fail('Actions invalides');
  if (!Number.isInteger(from) || from < 0 || from > run.nops) fail('Partie désynchronisée : elle va être rechargée');
  for (let i = run.nops - from; i < list.length; i++) {
    const err = BS.act(run.G, list[i]);
    if (err) { AC.flag(u, 'bastion', `action refusée (${err})`, now); fail(err); }
    run.nops++;
  }
  return run;
}

function launch(u, now = Date.now()) {
  const run = live(ensure(u));
  if (!run) fail('Aucune partie en cours');
  const err = BS.launch(run.G);
  if (err) fail(err);
  run.launchAt = now; run.abil = []; run.next = null;
  return run;
}

// Capacité de la tour principale : [id, c, r, tick] ; l'instant doit être possible (vitesse ×3 au plus depuis le lancement)
function ability(u, a, now = Date.now()) {
  const run = live(ensure(u));
  if (!run || run.G.phase !== 'wave') fail('Aucune vague en cours');
  if (!Array.isArray(a) || !B.ABILITIES[a[0]] || ![a[1], a[2], a[3]].every(Number.isInteger)) fail('Capacité invalide');
  const last = run.abil.length ? run.abil[run.abil.length - 1][3] : 0;
  const maxTick = Math.ceil((((now - run.launchAt) / 1000) * MAX_SPEED + 3) / B.TICK);
  if (a[3] < last || a[3] > maxTick || run.abil.length >= 60) { AC.flag(u, 'bastion', `capacité à un instant impossible (${a[3]} > ${maxTick})`, now); fail('Capacité refusée'); }
  run.abil.push([String(a[0]), a[1], a[2], a[3]]);
  run.next = null;
  return run;
}

// Fin de la vague : le serveur la rejoue entièrement (même état de départ, mêmes capacités)
function endWave(u, opts = {}) {
  const now = opts.now || Date.now();
  const S = ensure(u), run = live(S);
  if (!run || run.G.phase !== 'wave') fail('Aucune vague en cours');
  if (!run.next) {
    const G2 = BS.clone(run.G);
    const r = BS.runWave(G2, run.abil);
    run.next = { G: G2, ticks: r.ticks, refused: r.refused };
  }
  const minMs = (run.next.ticks * B.TICK * 1000) / MAX_SPEED - 3000, elapsed = now - run.launchAt;
  if (elapsed < minMs) {
    if (elapsed < minMs * 0.5) AC.flag(u, 'bastion', `vague terminée trop vite (${Math.round(elapsed / 1000)} s au lieu de ${Math.round(minMs / 1000)} s)`, now);
    return { wait: Math.ceil(minMs - elapsed) };
  }
  if (run.next.refused) AC.flag(u, 'bastion', `${run.next.refused} capacité(s) impossible(s)`, now);
  run.G = run.next.G; run.next = null; run.abil = []; run.launchAt = 0;
  afterWave(u, S, run, opts);
  return { ok: true };
}

function log(run, text) { run.log.push(text); if (run.log.length > 12) run.log.shift(); }

// Récompenses d'une vague gagnée (ou fin de partie si la tour principale est détruite)
function afterWave(u, S, run, opts = {}) {
  const G = run.G, rnd = opts.rnd || Math.random, now = opts.now || Date.now();
  if (G.phase === 'over') { finish(u, S, run, 'lost', opts); return; }
  const w = G.wave, Z = B.ZONES[run.zone];
  run.xp += GD.bastionXp(run.zone, w);
  S.best[run.zone] = Math.max(S.best[run.zone] || 0, w);
  if (w % 10 === 0) { // gardien vaincu : plans de la zone (jamais en double), et parfois un œuf de familier de la zone
    const keys = dropPlans(S, run.zone, w === B.WIN_WAVE ? B.PLANS.final : B.PLANS.boss, rnd);
    if (keys.length) grantPlans(u, S, run, keys);
    else log(run, `Manche ${w} : gardien vaincu (tous les plans de la zone « ${Z.name} » sont déjà trouvés)`);
    if (rnd() < B.EGG_CHANCE) {
      pets.addEgg(u, run.zone, Math.min(2, Math.floor((w - 1) / 10)), now);
      run.eggs++;
      log(run, `Manche ${w} : un œuf de familier 🥚 (éclosion dans ${GD.PETS.INCUBATION_MIN} min)`);
    }
  }
  if (!run.refunded && w >= B.REFUND_WAVE - 1) {
    u.gold = (u.gold || 0) + B.PRICE; run.refunded = true;
    log(run, `Manche ${B.REFUND_WAVE} atteinte : les ${B.PRICE} Grêlons sont remboursés 🌨️`);
  }
  if (G.phase === 'won') {
    const first = !(S.wins[run.zone] > 0);
    S.wins[run.zone] = (S.wins[run.zone] || 0) + 1;
    ach.add(u, 'bastionWins');
    const next = Object.entries(B.ZONES).find(([, z]) => z.unlock === run.zone);
    log(run, `Victoire dans la zone « ${Z.name} » !${first && next ? ` La zone « ${next[1].name} » est débloquée.` : ''}`);
    if (first) grantPlans(u, S, run, dropPlans(S, run.zone, B.PLANS.firstWin, rnd));
  }
}

// Fin de la partie : XP, statistiques et succès
function finish(u, S, run, reason, opts = {}) {
  const G = run.G;
  const levels = opts.grantXp ? opts.grantXp(u, run.xp) || 0 : 0;
  S.games++;
  ach.add(u, 'bastionGames'); ach.add(u, 'bastionBuilt', G.st.built); ach.add(u, 'bastionKills', G.st.kills); ach.setMax(u, 'bastionSynergy', G.st.syn || 0);
  run.over = {
    reason, zone: run.zone, wave: G.wave, lostAt: G.lostAt || null, won: G.wave >= B.WIN_WAVE, xp: run.xp, levels,
    found: run.found || [], eggs: run.eggs, refunded: run.refunded, kills: G.st.kills, built: G.st.built, syn: G.st.syn || 0
  };
  run.next = null;
}

// Autres actions : continue (mode infini après la victoire) · victory (terminer après la victoire) · abandon · close
function act(u, action, opts = {}) {
  const S = ensure(u);
  if (action === 'close') { if (S.run && S.run.over) S.run = null; return null; }
  const run = live(S);
  if (!run) fail('Aucune partie en cours');
  if (action === 'continue') { const err = BS.continueInfinite(run.G); if (err) fail(err); log(run, 'Mode infini : jusqu’où tiendras-tu ?'); return run; }
  if (action === 'victory') { if (run.G.phase !== 'won' && !(run.G.infinite && run.G.phase === 'build')) fail('La partie n’est pas gagnée'); finish(u, S, run, 'victory', opts); return run; }
  if (action === 'abandon') {
    // une vague en cours est perdue (seules les manches déjà gagnées comptent)
    if (run.G.phase === 'wave') { delete run.G.W; run.G.phase = 'build'; for (const b of run.G.b) b.fresh = {}; }
    finish(u, S, run, run.G.infinite ? 'victory' : 'abandon', opts);
    return run;
  }
  fail('Action inconnue');
}

// Admin (tests) : donner des plans au hasard (n), ou tous ; renvoie les clés données
function givePlans(u, n) {
  const S = ensure(u);
  const out = [];
  if (n === 'tous') for (const k of GD.bastionPlanKeys()) { if (!S.unlocked.includes(k)) { S.unlocked.push(k); out.push(k); } }
  else for (const z of Object.keys(B.ZONES)) out.push(...dropPlans(S, z, Math.max(0, n - out.length), Math.random));
  const run = live(S);
  if (run) for (const k of out) if (!run.G.unlocked.includes(k)) run.G.unlocked.push(k);
  return out;
}

function publicState(u, now = Date.now()) {
  const S = ensure(u), run = S.run;
  return {
    price: B.PRICE, gold: u.gold || 0, unlocked: S.unlocked, best: S.best, wins: S.wins, games: S.games,
    open: Object.fromEntries(Object.keys(B.ZONES).map((z) => [z, zoneOpen(S, z)])),
    run: run ? { zone: run.zone, G: run.G, nops: run.nops, abil: run.abil, elapsed: run.launchAt ? now - run.launchAt : 0, xp: run.xp, found: run.found || [], eggs: run.eggs, refunded: run.refunded, log: run.log, over: run.over } : null
  };
}

// Classement : meilleure manche survécue par zone
function ladder(users) {
  return Object.fromEntries(Object.keys(B.ZONES).map((z) => [z, users.filter((u) => !u.banned && u.bastion && (u.bastion.best || {})[z] > 0)
    .sort((a, b) => b.bastion.best[z] - a.bastion.best[z] || ((b.bastion.wins || {})[z] || 0) - ((a.bastion.wins || {})[z] || 0))
    .slice(0, 10).map((u) => ({ pseudo: u.pseudo, title: ach.titleOf(u), wave: u.bastion.best[z], wins: (u.bastion.wins || {})[z] || 0 }))]));
}

module.exports = { BastionError, ensure, start, applyOps, launch, ability, endWave, act, givePlans, dropPlans, planCandidates, publicState, ladder, zoneOpen };
