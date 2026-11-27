'use strict';
/*
 * Anti-triche. Le serveur a toujours le dernier mot ; ce module l'aide à repérer et à limiter les abus :
 *  - journal d'alertes par joueur (u.cheat : score qui baisse avec le temps + dernières alertes), consultable
 *    et effaçable par l'admin ; au-delà d'un seuil, les mini-jeux sont suspendus jusqu'à décision de l'admin ;
 *  - limitation du débit des requêtes (seaux à jetons) ;
 *  - comptes liés : adresses IP enregistrées seulement sous forme hachée (jamais en clair), pour repérer
 *    les transferts d'objets ou de Grêlons entre comptes d'une même connexion ;
 *  - limites de vraisemblance des expéditions (mini-jeux simulés par la page) : dégâts par seconde,
 *    récolte par seconde, soins possibles ; server/mini.js refuse ce qui les dépasse.
 */
const crypto = require('crypto');
const GD = require('../shared/constants');
const { MINI } = GD;

// libellés et poids des alertes
const KINDS = {
  kills: { name: 'Monstres tués trop vite', w: 3 },
  recolte: { name: 'Récolte trop rapide', w: 2 },
  pv: { name: 'PV remontés sans soin', w: 3 },
  // simple indice (un joueur très fort qui pare tout peut y arriver) : trop léger pour suspendre un compte à lui seul
  invulnerable: { name: 'Aucun dégât subi en profondeur (à vérifier)', w: 0.5 },
  compteurs: { name: 'Parades ou roulades impossibles', w: 1 },
  rapport: { name: 'Rapport invalide', w: 1 },
  debit: { name: 'Trop de requêtes', w: 0.5 },
  transfert: { name: 'Transfert entre comptes liés', w: 2 },
  bastion: { name: 'Bastion : action ou vague impossible', w: 0.5 }
};
const DECAY_PER_DAY = 2;   // le score baisse de 2 points par jour sans nouvelle alerte
const SUSPECT = 10;        // affiché « suspect » chez l'admin
const BLOCK = 30;          // mini-jeux suspendus (jusqu'à ce que l'admin efface les alertes)
const SHARED_IP_MAX = 6;   // une adresse partagée par plus de comptes (réseau public, proxy) n'est pas un lien
let onFlag = null;         // (u, alerte) : journal du serveur / admin

function ensure(u) {
  u.cheat ||= { score: 0, at: Date.now(), log: [] };
  return u.cheat;
}
// score actuel (avec la baisse dans le temps)
function score(u, now = Date.now()) {
  const C = ensure(u);
  C.score = Math.max(0, C.score - (Math.max(0, now - (C.at || now)) / 864e5) * DECAY_PER_DAY);
  C.at = now;
  return C.score;
}
// Enregistre une alerte ; les alertes identiques rapprochées (moins de 30 s) ne comptent qu'une fois
function flag(u, kind, detail, now = Date.now()) {
  if (!u) return;
  const C = ensure(u), K = KINDS[kind] || { name: kind, w: 1 };
  score(u, now);
  const last = C.log[C.log.length - 1];
  if (last && last.kind === kind && now - last.t < 30e3) { last.n = (last.n || 1) + 1; last.detail = detail; return; }
  C.score += K.w;
  C.log.push({ t: now, kind, detail: String(detail || '').slice(0, 200) });
  if (C.log.length > 40) C.log.shift();
  if (onFlag) onFlag(u, { kind, name: K.name, detail });
}
const blocked = (u) => !!u && score(u) >= BLOCK;
function clear(u) { u.cheat = { score: 0, at: Date.now(), log: [] }; }

/* ---------------- Limitation du débit (seau à jetons) ---------------- */
const buckets = new Map();
// rate : jetons par seconde ; burst : réserve ; renvoie false si la requête doit être refusée
function allow(key, rate, burst, now = Date.now()) {
  let b = buckets.get(key);
  if (!b) { b = { tok: burst, t: now }; buckets.set(key, b); }
  b.tok = Math.min(burst, b.tok + ((now - b.t) / 1000) * rate);
  b.t = now;
  if (b.tok < 1) return false;
  b.tok -= 1;
  return true;
}
// ménage des seaux inactifs
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now - b.t > 600e3) buckets.delete(k); }, 300e3).unref();

/* ---------------- Comptes liés (adresses IP hachées) ---------------- */
let salt = null; // sel secret (gardé dans les réglages de la base)
const setSalt = (s) => { salt = s; };
const hashIp = (ip) => crypto.createHash('sha256').update(String(salt || 'tdv') + '|' + String(ip || '')).digest('hex').slice(0, 16);
// note l'adresse (hachée) d'un compte ; renvoie true si l'enregistrement a changé
function seen(u, ip, now = Date.now()) {
  if (!ip) return false;
  const h = hashIp(ip);
  u.iph ||= [];
  const e = u.iph.find((x) => x.h === h);
  if (e) { if (now - e.t < 3600e3) return false; e.t = now; } else u.iph.push({ h, t: now });
  u.iph.sort((a, b) => b.t - a.t);
  u.iph = u.iph.slice(0, 5);
  return true;
}
// comptes qui partagent une adresse avec u (hors adresses partagées par trop de comptes)
function linked(u, allUsers) {
  const mine = new Set((u.iph || []).map((x) => x.h));
  if (!mine.size) return [];
  const byHash = {};
  for (const o of allUsers) for (const x of o.iph || []) if (mine.has(x.h)) (byHash[x.h] ||= []).push(o);
  const out = new Set();
  for (const list of Object.values(byHash)) if (list.length <= SHARED_IP_MAX) for (const o of list) if (o.id !== u.id) out.add(o);
  return [...out];
}
// transfert (don, échange, achat) entre deux comptes liés : alerte des deux côtés
function transfer(a, b, allUsers, what) {
  if (!a || !b || a.id === b.id) return false;
  if (!linked(a, allUsers).some((o) => o.id === b.id)) return false;
  flag(a, 'transfert', `${what} avec ${b.pseudo} (même connexion)`);
  flag(b, 'transfert', `${what} avec ${a.pseudo} (même connexion)`);
  return true;
}

/* ---------------- Vraisemblance des expéditions ---------------- */
// Limites hautes (généreuses) de ce qu'un héros peut faire en une seconde dans une expédition
function miniLimits(run) {
  const H = MINI.HERO;
  const fx = {};
  for (const p of run.pets || []) for (const [k, v] of Object.entries(GD.petPower(p.kind, p.rarity))) fx[k] = (fx[k] || 0) + v;
  const base = (run.dmg || MINI.BASE.dmg) * (1 + ((run.buff && run.buff.dmg) || 0) + Math.min(0.3, fx.rally || 0));
  const critMul = 2; // au pire, que des coups critiques
  const markMul = 1 + Math.min(0.5, fx.mark || 0);
  const atkPerSec = (1 + (run.haste || 0)) / Math.min(H.atkCd, H.shotCd);
  const hit = base * critMul * markMul;
  // coups, compétence, familiers (morsure, zone, poison / brûlure), marge de sécurité ×1,5
  const pets = base * ((fx.bite || 0) / 1.2 + (fx.aoe || 0) / 3 + (fx.poison || 0) + (fx.burn || 0));
  const dps = (hit * (atkPerSec + 2.2 / H.skillCd) + pets) * 1.5;
  const harvestRate = (MINI.HARVEST.perHit * (1 + Math.min(0.5, fx.loot || 0)) * atkPerSec + (fx.sniff ? 0.5 * (run.pets || []).length : 0)) * 1.5;
  const healRate = Math.min(0.08 * 2, fx.heal || 0) / 4; // part des PV max par seconde (soins des familiers)
  // contact : les monstres et les points de récolte sont loin de l'entrée ; il faut au moins s'approcher ou que le tir arrive
  return { dps, harvestRate, healRate, aoe: 4, contact: 0.4 };
}
// Moment le plus tôt (en secondes depuis l'entrée dans la salle) où un renfort numéro j peut exister
function reinfEarliest(room, j, X) {
  if (room.boss < 0) return X.reinfAfter(room.room) + Math.floor(j / MINI.REINFORCE.count) * MINI.REINFORCE.every;
  const B = room.mobs[0];
  if (!B || !B.boss || !(B.abil || []).includes('summon')) return Infinity; // élite : jamais de renfort
  return 5 + Math.floor(j / 2) * 10; // invocations du gardien
}

function publicState(u, allUsers) {
  const C = ensure(u);
  return { score: Math.round(score(u) * 10) / 10, log: C.log.slice(-15).reverse(), linked: linked(u, allUsers).map((o) => o.pseudo), level: C.score >= BLOCK ? 'bloque' : C.score >= SUSPECT ? 'suspect' : 'ok' };
}

module.exports = {
  KINDS, SUSPECT, BLOCK, ensure, score, flag, blocked, clear, allow, setSalt, hashIp, seen, linked, transfer, miniLimits, reinfEarliest, publicState,
  set onFlag(f) { onFlag = f; }
};
