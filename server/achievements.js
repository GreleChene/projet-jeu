'use strict';
/*
 * Succès des joueurs : compteurs (u.ach.c), succès débloqués (u.ach.done : date) et titre équipé (u.title).
 * Les succès sont définis dans shared/constants.js (ACHIEVEMENTS). Certaines statistiques sont des compteurs
 * tenus ici (add / setMax), les autres sont lues directement sur le profil (niveau, glaçons ouverts, familiers…).
 * check() débloque ce qui est atteint et prévient le joueur (onUnlock, branché par server/index.js).
 */
const GD = require('../shared/constants');
const { ACHIEVEMENTS } = GD;
const BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
const STATS = [...new Set(ACHIEVEMENTS.map((a) => a.stat))];

class AchError extends Error {}
let onUnlock = null; // (u, succès) : notification au joueur et sur le stream

function ensure(u) {
  u.ach ||= {};
  u.ach.c ||= {};
  u.ach.done ||= {};
  return u.ach;
}

// toutes les pièces d'un même set sont portées en même temps
function fullSetNow(u) {
  const count = {};
  for (const uid of Object.values(u.equip || {})) {
    const it = (u.inventory || []).find((x) => x.uid === uid), T = it && GD.TEMPLATES[it.t];
    if (T && T.set) count[T.set] = (count[T.set] || 0) + 1;
  }
  return Object.entries(count).some(([sid, n]) => n >= GD.setSize(sid)) ? 1 : 0;
}

// valeur actuelle d'une statistique de succès
function value(u, stat) {
  const c = ensure(u).c, st = u.stats || {}, list = (u.pets && u.pets.list) || [], best = (u.mini && u.mini.best) || {};
  switch (stat) {
    case 'games': return st.runs || 0;
    case 'kills': return st.kills || 0;
    case 'bossKills': return st.bossKills || 0;
    case 'deaths': return st.deaths || 0;
    case 'bestWave': return st.bestWave || 0;
    case 'level': return u.level || 1;
    case 'glacons': return u.glaconsOpened || 0;
    case 'mystic': return u.mysticFound ? 1 : 0;
    case 'bestRoom': return Math.max(0, ...Object.values(best));
    case 'best_mine': case 'best_foret': case 'best_champ': return best[stat.slice(5)] || 0;
    case 'pets': return list.length;
    case 'petLevel': return Math.max(0, ...list.map((p) => p.level || 1));
    case 'petRarity': return list.length ? Math.max(...list.map((p) => p.rarity || 0)) : -1;
    case 'twitch': return u.twitchName ? 1 : 0;
    case 'achCount': return Object.keys(ensure(u).done).length;
    case 'bastionBest': return Math.max(0, ...Object.values((u.bastion && u.bastion.best) || {}));
    case 'bastionZones': return Object.values((u.bastion && u.bastion.wins) || {}).filter((n) => n > 0).length;
    case 'fullSet': return Math.max(c.fullSet || 0, fullSetNow(u));
    case 'goldMax': return Math.max(c.goldMax || 0, Math.floor(u.gold || 0));
    default: return c[stat] || 0;
  }
}

// compteurs
function add(u, stat, n = 1) {
  if (!u || !(n > 0)) return;
  const c = ensure(u).c;
  c[stat] = (c[stat] || 0) + n;
}
function setMax(u, stat, v) {
  if (!u) return;
  const c = ensure(u).c;
  if (v > (c[stat] || 0)) c[stat] = v;
}

// Débloque les succès atteints ; renvoie les nouveaux (silent : sans notification, pour la migration des comptes)
function check(u, opts = {}) {
  if (!u) return [];
  const A = ensure(u), out = [];
  A.c.goldMax = value(u, 'goldMax'); // records gardés même si la valeur redescend
  A.c.fullSet = value(u, 'fullSet');
  for (let pass = 0; pass < 3; pass++) { // « Débloque N succès » dépend des autres
    let any = false;
    for (const a of ACHIEVEMENTS) {
      if (A.done[a.id] || value(u, a.stat) < a.goal) continue;
      A.done[a.id] = Date.now();
      out.push(a); any = true;
    }
    if (!any) break;
  }
  if (!opts.silent && onUnlock) for (const a of out) onUnlock(u, a);
  return out;
}

// Titre équipé (id d'un succès débloqué, ou null pour aucun)
function setTitle(u, id) {
  if (!id) { u.title = null; return null; }
  const a = BY_ID[id];
  if (!a) throw new AchError('Titre inconnu');
  if (!ensure(u).done[id]) throw new AchError('Ce titre n’est pas encore débloqué');
  u.title = id;
  return a.title;
}
const titleOf = (u) => (u && u.title && BY_ID[u.title] && u.ach && u.ach.done && u.ach.done[u.title] ? BY_ID[u.title].title : null);

// État envoyé à la page joueur : valeurs des statistiques, succès débloqués, titre équipé
function publicState(u) {
  ensure(u);
  return { v: Object.fromEntries(STATS.map((s) => [s, value(u, s)])), done: u.ach.done, title: titleOf(u) ? u.title : null };
}

module.exports = {
  AchError, ensure, value, add, setMax, check, setTitle, titleOf, publicState, BY_ID,
  set onUnlock(f) { onUnlock = f; }, get onUnlock() { return onUnlock; }
};
