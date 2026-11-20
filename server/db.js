'use strict';
/*
 * Stockage JSON minimaliste (écriture atomique, sauvegarde différée).
 * Suffisant pour quelques milliers de viewers ; remplaçable par une vraie BDD plus tard.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { DEFAULT_AI, PALETTE, emptyAttrs, PROGRESSION, ITEMS, DEFAULT_EQUIP } = require('../shared/constants');

// Anciennes armures (v1) : remboursées en Grêlons
const LEGACY_ITEMS = { head_hood: 30, head_leather: 90, head_iron: 250, head_great: 600, head_rune: 1500, body_leather: 140, body_mail: 380, body_plate: 900, body_rune: 2200 };

let data = { users: {}, sessions: {}, settings: {} };
let dirty = false;

function load() {
  try {
    data = JSON.parse(fs.readFileSync(config.DATA_FILE, 'utf8'));
    data.users ||= {}; data.sessions ||= {}; data.settings ||= {};
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
  u.look ||= { cape: 0, skin: 1, hair: 0 };
  u.owned ||= [];
  u.gold ||= 0;
  for (const id of u.owned) if (LEGACY_ITEMS[id]) u.gold += LEGACY_ITEMS[id];
  u.owned = [...new Set([...Object.values(DEFAULT_EQUIP), ...u.owned.filter((id) => ITEMS[id])])];
  u.equip = { ...DEFAULT_EQUIP, ...(u.equip || {}) };
  for (const [slot, id] of Object.entries(u.equip)) if (!ITEMS[id] || !u.owned.includes(id)) u.equip[slot] = DEFAULT_EQUIP[slot];
  u.stats ||= { kills: 0, runs: 0, bestWave: 0, deaths: 0, bossKills: 0 };
  u.cls ||= 'habitant';
  u.level ||= 1; u.xp ||= 0; u.gold ||= 0;
  syncAttrPoints(u);
  return u;
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
    look: { cape: rnd(PALETTE.capes.length), skin: rnd(PALETTE.skin.length), hair: rnd(PALETTE.hair.length) }
  });
  data.users[id] = u;
  markDirty();
  return u;
}

const db = {
  load, saveNow, markDirty, newUser, syncAttrPoints,
  get data() { return data; },
  userById: (id) => data.users[id] || null,
  userByPseudo: (p) => Object.values(data.users).find((u) => u.pseudoLower === String(p).toLowerCase()) || null,
  allUsers: () => Object.values(data.users),
  deleteUser(id) {
    delete data.users[id];
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
