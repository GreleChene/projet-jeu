'use strict';
/*
 * Stockage JSON minimaliste (écriture atomique, sauvegarde différée).
 * Suffisant pour quelques milliers de viewers ; remplaçable par une vraie BDD plus tard.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { DEFAULT_AI, PALETTE, emptyAttrs, PROGRESSION, TEMPLATES, SLOTS, GLACONS, CLASSES, sanitizeLook, randomLook } = require('../shared/constants');

// Anciennes armures (v1) : remboursées en Grêlons
const LEGACY_ITEMS = { head_hood: 30, head_leather: 90, head_iron: 250, head_great: 600, head_rune: 1500, body_leather: 140, body_mail: 380, body_plate: 900, body_rune: 2200 };
// Catalogue v2 (armures achetées à l'unité) : prix recalculés pour le remboursement
function legacyPrice(id) {
  if (LEGACY_ITEMS[id]) return LEGACY_ITEMS[id];
  const TIER = [0, 60, 180, 500, 1400], SW = { head: 1, body: 1.5, legs: 1.15, feet: 0.8 };
  let m = /^weapon_[a-z]+_(\d)$/.exec(id);
  if (m) return Math.round((TIER[m[1]] * 1.3) / 10) * 10;
  m = /^(head|body|legs|feet)_[a-z]+_(\d)$/.exec(id);
  if (m) return Math.round((TIER[m[2]] * SW[m[1]]) / 10) * 10;
  return 0;
}

let data = { users: {}, sessions: {}, settings: {}, market: [], trades: [] };
let dirty = false;

function load() {
  try {
    data = JSON.parse(fs.readFileSync(config.DATA_FILE, 'utf8'));
    data.users ||= {}; data.sessions ||= {}; data.settings ||= {}; data.market ||= []; data.trades ||= []; delete data.balance; // ancien onglet « Équilibrage » supprimé
    for (const u of Object.values(data.users)) migrateUser(u);
    dirty = true; // enregistre les migrations éventuelles
  } catch (e) {
    if (e.code !== 'ENOENT') { console.error('Base illisible :', e.message); process.exit(1); }
  }
}

function saveNow() {
  if (!dirty) return;
  fs.mkdirSync(path.dirname(config.DATA_FILE), { recursive: true });
  const tmp = config.DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, config.DATA_FILE);
  dirty = false;
}
function markDirty() { dirty = true; }
setInterval(saveNow, 5000).unref();
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { saveNow(); process.exit(0); });

function migrateUser(u) {
  u.ai = { ...DEFAULT_AI, ...(u.ai || {}) };
  u.look = sanitizeLook(u.look);
  u.gold ||= 0;
  // v3 : objets uniques (inventaire) + glaçons ; les anciennes armures achetées sont remboursées
  if (u.gearVersion !== 3) {
    for (const id of u.owned || []) u.gold += legacyPrice(id);
    delete u.owned;
    u.inventory = [];
    u.equip = {};
    u.glacons = (u.glacons || 0) + GLACONS.START;
    u.gearVersion = 3;
  }
  u.inventory ||= [];
  if (u.glaconsOpened === undefined) u.glaconsOpened = u.inventory.length;
  u.inventory = u.inventory.filter((it) => TEMPLATES[it.t]);
  u.equip ||= {};
  for (const s of SLOTS) if (u.equip[s] && !u.inventory.some((it) => it.uid === u.equip[s])) delete u.equip[s];
  u.level ||= 1;
  // un compte créé avant ce correctif pouvait avoir un nombre de glaçons invalide (NaN, enregistré comme null) :
  // on lui rend ses glaçons de départ
  if (!Number.isFinite(u.glacons)) u.glacons = u.levelGlacons ? GLACONS.START : 0;
  // le niveau ne donne plus de statistiques : compensation rétroactive d'un glaçon par niveau déjà gagné
  if (!u.levelGlacons) { u.glacons += (u.level - 1) * PROGRESSION.GLACONS_PER_LEVEL; u.levelGlacons = true; }
  // ancien système d'éclats de glace : converti en Grêlons
  if (u.iceShards) { u.gold += Math.round((u.iceShards / 10) * GLACONS.PRICE); delete u.iceShards; }
  if (u.inventory.some((it) => it.r >= 5)) u.mysticFound = true;
  u.stats ||= { kills: 0, runs: 0, bestWave: 0, deaths: 0, bossKills: 0 };
  u.cls ||= 'habitant';
  u.level ||= 1; u.xp ||= 0; u.gold ||= 0;
  syncAttrPoints(u);
  // arbres de compétences : un compte déjà spécialisé reçoit sa branche si ses points le permettent
  u.skills ||= {};
  u.skillLost ||= 0;
  // v2 : branche de 5 compétences + ultime au niveau ULT_LEVEL ; une spécialisation déjà acquise est conservée si le niveau le permet
  if (!u.skillsV2) {
    const c = CLASSES[u.cls];
    u.skills = {};
    if (c && c.tier === 2) {
      if (u.level >= PROGRESSION.ULT_LEVEL) { for (let i = 1; i <= 5; i++) u.skills[`${u.cls}_${i}`] = 1; u.skills[`${u.cls}_ult`] = 1; }
      else u.cls = c.parent;
    }
    u.skillsV1 = u.skillsV2 = true;
  }
  return u;
}

// Équipement porté sous forme { slot: {t, r} }
function gearOf(u) {
  const out = {};
  for (const s of SLOTS) {
    const it = u.equip && u.equip[s] && u.inventory.find((x) => x.uid === u.equip[s]);
    out[s] = it ? { t: it.t, r: it.r } : null;
  }
  return out;
}

// Points de stat : 1 par niveau gagné. Recalcule les points libres (et réinitialise si le niveau a baissé).
function syncAttrPoints(u) {
  u.attrs = { ...emptyAttrs(), ...(u.attrs || {}) };
  const total = (u.level - 1) * PROGRESSION.POINTS_PER_LEVEL;
  const spent = Object.values(u.attrs).reduce((a, b) => a + b, 0);
  if (spent > total) { u.attrs = emptyAttrs(); u.attrPoints = total; }
  else u.attrPoints = total - spent;
}

function newUser(pseudo, passHash, role) {
  const id = crypto.randomUUID();
  const rnd = (n) => Math.floor(Math.random() * n);
  const u = migrateUser({
    id, pseudo, pseudoLower: pseudo.toLowerCase(), passHash, role, createdAt: Date.now(), banned: false,
    look: randomLook()
  });
  data.users[id] = u;
  markDirty();
  return u;
}

const db = {
  load, saveNow, markDirty, newUser, syncAttrPoints, gearOf,
  get data() { return data; },
  userById: (id) => data.users[id] || null,
  userByPseudo: (p) => Object.values(data.users).find((u) => u.pseudoLower === String(p).toLowerCase()) || null,
  allUsers: () => Object.values(data.users),
  deleteUser(id) {
    delete data.users[id];
    data.market = data.market.filter((l) => l.sellerId !== id && l.reservedFor !== id);
    data.trades = data.trades.filter((t) => t.fromId !== id && t.toId !== id);
    for (const [t, s] of Object.entries(data.sessions)) if (s.userId === id) delete data.sessions[t];
    markDirty();
  },
  createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    data.sessions[token] = { userId, expires: Date.now() + config.SESSION_DAYS * 86400e3 };
    markDirty();
    return token;
  },
  sessionUser(token) {
    const s = token && data.sessions[token];
    if (!s) return null;
    if (s.expires < Date.now()) { delete data.sessions[token]; markDirty(); return null; }
    const u = data.users[s.userId];
    return u && !u.banned ? u : null;
  },
  deleteSession(token) { delete data.sessions[token]; markDirty(); },
  deleteUserSessions(userId) {
    for (const [t, s] of Object.entries(data.sessions)) if (s.userId === userId) delete data.sessions[t];
    markDirty();
  }
};
module.exports = db;
