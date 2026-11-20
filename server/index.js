'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const config = require('./config');
const db = require('./db');
const Game = require('./game/engine');
const GD = require('../shared/constants');

db.load();

// Compte administrateur unique : « admin ». Seul ce compte a accès à l'administration.
const ADMIN_PSEUDO = 'admin';
const ADMIN_DEFAULT_PASSWORD = '123456';
{
  const existing = db.userByPseudo(ADMIN_PSEUDO);
  if (!existing) {
    db.newUser(ADMIN_PSEUDO, bcrypt.hashSync(ADMIN_DEFAULT_PASSWORD, 10), 'admin');
    console.log(`Compte « ${ADMIN_PSEUDO} » créé (mot de passe par défaut : ${ADMIN_DEFAULT_PASSWORD}).`);
  } else if (bcrypt.compareSync('1234', existing.passHash)) {
    // ancien mot de passe par défaut, trop court : remplacé
    existing.passHash = bcrypt.hashSync(ADMIN_DEFAULT_PASSWORD, 10);
    db.deleteUserSessions(existing.id);
    console.log(`Mot de passe du compte « ${ADMIN_PSEUDO} » mis à jour : ${ADMIN_DEFAULT_PASSWORD}.`);
  }
  // personne d'autre ne garde le rôle admin
  for (const u of db.allUsers()) {
    const role = u.pseudoLower === ADMIN_PSEUDO ? 'admin' : 'player';
    if (u.role !== role) { u.role = role; db.markDirty(); }
    if (u.pseudoLower === ADMIN_PSEUDO) u.banned = false;
  }
}
const isAdmin = (u) => !!u && u.pseudoLower === ADMIN_PSEUDO && u.role === 'admin';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e5 });
const game = new Game(db, io);

app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

/* ============================== Sessions ============================== */
function parseCookies(str) {
  const out = {};
  for (const part of (str || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setSessionCookie(res, token) {
  const parts = [`sid=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${config.SESSION_DAYS * 86400}`];
  if (config.SECURE_COOKIES) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function auth(req, res, next) {
  const token = parseCookies(req.headers.cookie).sid;
  const u = db.sessionUser(token);
  if (!u) return res.status(401).json({ error: 'Non connecté' });
  req.user = u; req.token = token;
  next();
}
function admin(req, res, next) {
  auth(req, res, () => (isAdmin(req.user) ? next() : res.status(403).json({ error: 'Réservé à l’administrateur' })));
}

// limitation simple des tentatives de connexion
const attempts = new Map();
function rateLimited(key) {
  const now = Date.now();
  const a = attempts.get(key) || { n: 0, t: now };
  if (now - a.t > 60_000) { a.n = 0; a.t = now; }
  a.n++;
  attempts.set(key, a);
  return a.n > 10;
}

function publicUser(u) {
  return {
    id: u.id, pseudo: u.pseudo, role: isAdmin(u) ? 'admin' : 'player', cls: u.cls, level: u.level, xp: u.xp, xpNext: GD.PROGRESSION.xpForLevel(u.level),
    gold: u.gold, look: u.look, inventory: u.inventory, equip: u.equip, glacons: u.glacons, ai: u.ai, stats: u.stats, inRun: game.heroes.has(u.id),
    attrs: u.attrs, attrPoints: u.attrPoints
  };
}

/* ============================== Comptes ============================== */
const PSEUDO_RE = /^[A-Za-z0-9_\-]{3,20}$/;

app.post('/api/register', async (req, res) => {
  const { pseudo, password } = req.body || {};
  if (rateLimited('reg:' + req.ip)) return res.status(429).json({ error: 'Trop de tentatives, réessaie dans une minute.' });
  if (!PSEUDO_RE.test(pseudo || '')) return res.status(400).json({ error: 'Pseudo : 3 à 20 caractères (lettres, chiffres, _ et -).' });
  if (typeof password !== 'string' || password.length < 6 || password.length > 100) return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum.' });
  if (pseudo.toLowerCase() === ADMIN_PSEUDO || db.userByPseudo(pseudo)) return res.status(409).json({ error: 'Ce pseudo est déjà pris.' });
  const u = db.newUser(pseudo, await bcrypt.hash(password, 10), 'player');
  setSessionCookie(res, db.createSession(u.id));
  res.json({ user: publicUser(u) });
});

app.post('/api/login', async (req, res) => {
  const { pseudo, password } = req.body || {};
  if (rateLimited('login:' + req.ip)) return res.status(429).json({ error: 'Trop de tentatives, réessaie dans une minute.' });
  const u = db.userByPseudo(pseudo || '');
  if (!u || !(await bcrypt.compare(String(password || ''), u.passHash))) return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect.' });
  if (u.banned) return res.status(403).json({ error: 'Ce compte est banni.' });
  setSessionCookie(res, db.createSession(u.id));
  res.json({ user: publicUser(u) });
});

app.post('/api/logout', auth, (req, res) => {
  db.deleteSession(req.token);
  res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

app.post('/api/me/password', auth, async (req, res) => {
  const { current, next: nw } = req.body || {};
  if (!(await bcrypt.compare(String(current || ''), req.user.passHash))) return res.status(400).json({ error: 'Mot de passe actuel incorrect.' });
  if (typeof nw !== 'string' || nw.length < 6) return res.status(400).json({ error: 'Nouveau mot de passe : 6 caractères minimum.' });
  req.user.passHash = await bcrypt.hash(nw, 10);
  db.markDirty();
  res.json({ ok: true });
});

/* ============================== Personnalisation ============================== */
function afterProfileChange(u) {
  db.markDirty();
  const h = game.heroes.get(u.id);
  if (h) game.refreshHero(h);
}

app.put('/api/me/look', auth, (req, res) => {
  const { cape, skin, hair } = req.body || {};
  const P = GD.PALETTE;
  const ok = (v, n) => Number.isInteger(v) && v >= 0 && v < n;
  if (!ok(cape, P.capes.length) || !ok(skin, P.skin.length) || !ok(hair, P.hair.length)) return res.status(400).json({ error: 'Apparence invalide' });
  req.user.look = { cape, skin, hair };
  afterProfileChange(req.user);
  res.json({ user: publicUser(req.user) });
});

app.put('/api/me/ai', auth, (req, res) => {
  const b = req.body || {};
  const O = GD.AI_OPTIONS;
  const ai = { ...req.user.ai };
  if (b.stance in O.stance) ai.stance = b.stance;
  if (b.target in O.target) ai.target = b.target;
  if (String(b.retreat) in O.retreat) ai.retreat = Number(b.retreat);
  if (b.ult in O.ult) ai.ult = b.ult;
  req.user.ai = ai;
  afterProfileChange(req.user);
  res.json({ user: publicUser(req.user) });
});

app.post('/api/me/class', auth, (req, res) => {
  const u = req.user;
  const id = (req.body || {}).cls;
  const c = GD.CLASSES[id];
  if (!c || c.tier === 0) return res.status(400).json({ error: 'Classe inconnue' });
  const cur = GD.CLASSES[u.cls];
  if (c.tier === 1) {
    if (cur.tier !== 0) return res.status(400).json({ error: 'Tu as déjà une classe.' });
    if (u.level < GD.PROGRESSION.CLASS_LEVEL) return res.status(400).json({ error: `Niveau ${GD.PROGRESSION.CLASS_LEVEL} requis.` });
  } else {
    if (cur.tier !== 1 || c.parent !== u.cls) return res.status(400).json({ error: 'Spécialisation impossible depuis ta classe.' });
    if (u.level < GD.PROGRESSION.SPEC_LEVEL) return res.status(400).json({ error: `Niveau ${GD.PROGRESSION.SPEC_LEVEL} requis.` });
  }
  u.cls = id;
  afterProfileChange(u);
  res.json({ user: publicUser(u) });
});

/* ============================== Points de statistiques ============================== */
app.post('/api/me/attrs', auth, (req, res) => {
  const u = req.user;
  const { attr } = req.body || {};
  const n = Math.max(1, Math.min(100, Math.floor(Number((req.body || {}).n) || 1)));
  if (!GD.ATTRIBUTES[attr]) return res.status(400).json({ error: 'Statistique inconnue' });
  db.syncAttrPoints(u);
  if (u.attrPoints < n) return res.status(400).json({ error: 'Pas assez de points de stat.' });
  u.attrs[attr] += n;
  u.attrPoints -= n;
  afterProfileChange(u);
  res.json({ user: publicUser(u) });
});

app.post('/api/me/attrs/reset', auth, (req, res) => {
  const u = req.user;
  u.attrs = GD.emptyAttrs();
  db.syncAttrPoints(u);
  afterProfileChange(u);
  res.json({ user: publicUser(u) });
});

/* ============================== Équipement & glaçons ============================== */
app.put('/api/me/equip', auth, (req, res) => {
  const u = req.user;
  const { uid, slot } = req.body || {};
  if (uid === null && GD.SLOTS.includes(slot)) {
    delete u.equip[slot];
  } else {
    const it = u.inventory.find((x) => x.uid === uid);
    if (!it) return res.status(400).json({ error: 'Objet introuvable' });
    if (!GD.canUse(it.t, u.cls)) return res.status(400).json({ error: 'Cet objet n’est pas fait pour ta classe.' });
    u.equip[GD.TEMPLATES[it.t].slot] = it.uid;
  }
  afterProfileChange(u);
  res.json({ user: publicUser(u) });
});

app.post('/api/inventory/recycle', auth, (req, res) => {
  const u = req.user;
  const it = u.inventory.find((x) => x.uid === (req.body || {}).uid);
  if (!it) return res.status(400).json({ error: 'Objet introuvable' });
  if (Object.values(u.equip).includes(it.uid)) return res.status(400).json({ error: 'Retire d’abord cet objet.' });
  const gain = GD.RARITIES[it.r].recycle;
  u.inventory = u.inventory.filter((x) => x !== it);
  u.gold += gain;
  afterProfileChange(u);
  res.json({ user: publicUser(u), gain });
});

app.post('/api/glacons/buy', auth, (req, res) => {
  const u = req.user;
  const n = Math.max(1, Math.min(10, Math.floor(Number((req.body || {}).n) || 1)));
  const cost = n * GD.GLACONS.PRICE;
  if (u.gold < cost) return res.status(400).json({ error: 'Pas assez de Grêlons' });
  u.gold -= cost;
  u.glacons += n;
  db.markDirty();
  res.json({ user: publicUser(u) });
});

app.post('/api/glacons/open', auth, (req, res) => {
  const u = req.user;
  if (u.glacons < 1) return res.status(400).json({ error: 'Tu n’as aucun glaçon.' });
  if (u.inventory.length >= 300) return res.status(400).json({ error: 'Inventaire plein (300 objets) : recycle des objets.' });
  u.glacons--;
  const item = rollItem(u.cls);
  u.inventory.push(item);
  db.markDirty();
  if (item.r >= 4) game.pushFeed(`${item.r === 5 ? '🌌' : '✨'} ${u.pseudo} obtient un objet ${GD.RARITIES[item.r].name.toLowerCase()} : ${GD.itemName(item, u.cls)} !`);
  res.json({ user: publicUser(u), item });
});

// Contenu d'un glaçon : une pièce utilisable par la classe actuelle du joueur
function rollItem(cls) {
  const ids = Object.keys(GD.TEMPLATES).filter((t) => GD.canUse(t, cls));
  const classIds = ids.filter((t) => GD.TEMPLATES[t].families);
  const pool = classIds.length && Math.random() < GD.GLACONS.CLASS_SET_CHANCE ? classIds : ids.filter((t) => !GD.TEMPLATES[t].families);
  const t = pool[Math.floor(Math.random() * pool.length)];
  return { uid: crypto.randomUUID(), t, r: GD.rollRarity(), at: Date.now() };
}

app.get('/api/leaderboard', (req, res) => {
  const top = db.allUsers().filter((u) => !u.banned)
    .sort((a, b) => b.stats.bestWave - a.stats.bestWave || b.level - a.level || b.stats.kills - a.stats.kills)
    .slice(0, 20)
    .map((u) => ({ pseudo: u.pseudo, cls: u.cls, level: u.level, bestWave: u.stats.bestWave, kills: u.stats.kills }));
  res.json({ top });
});

app.get('/api/info', (req, res) => res.json({ publicUrl: config.PUBLIC_URL, run: game.publicRunInfo() }));

/* ============================== Administration ============================== */
app.get('/api/admin/state', admin, (req, res) => {
  const heroes = [...game.heroes.values()].map((h) => ({
    id: h.id, name: h.name, bot: h.isBot, cls: h.cls, level: h.level, alive: h.alive, hp: Math.ceil(h.hp), maxHp: h.maxHp,
    kills: h.runKills, online: !h.isBot && isOnline(h.userId)
  }));
  res.json({ run: game.publicRunInfo(), settings: game.settings, heroes, feed: game.feed.slice(-15) });
});

app.post('/api/admin/game/:action', admin, (req, res) => {
  const b = req.body || {};
  switch (req.params.action) {
    case 'start': game.startRun(b.wave || 1); break;
    case 'stop': game.stopRun(); break;
    case 'pause': game.paused = true; break;
    case 'resume': game.paused = false; break;
    case 'skip': game.skipWave(); break;
    case 'wave': game.setWave(b.wave); break;
    case 'next': if (game.phase === 'intermission') game.run.timer = 0; break;
    case 'treasury': game.addTreasury(Math.max(-game.run.treasury, Number(b.amount) || 0)); break;
    case 'healTower': game.run.tower.hp = game.run.tower.max; break;
    case 'bots': {
      const cls = GD.CLASSES[b.cls] ? b.cls : null;
      const level = b.level ? Math.min(GD.PROGRESSION.MAX_LEVEL, Math.max(1, Math.floor(Number(b.level) || 1))) : null;
      for (let i = 0; i < Math.min(50, Number(b.count) || 1); i++) game.addBot({ cls, level });
      break;
    }
    case 'clearBots': for (const h of [...game.heroes.values()]) if (h.isBot) game.removeHero(h.id); break;
    case 'kick': game.removeHero(String(b.id)); break;
    case 'announce': game.announce(String(b.text || '').slice(0, 80), String(b.sub || '').slice(0, 120)); break;
    case 'settings': {
      const s = game.settings;
      const num = (k, a, z) => { if (b[k] !== undefined && !isNaN(b[k])) s[k] = Math.min(z, Math.max(a, Number(b[k]))); };
      num('difficulty', 0.2, 5); num('intermission', 5, 120);
      num('maxHeroes', 1, 500); num('maxAliveMobs', 20, 600); num('voteEvery', 1, 20);
      if (b.autoNext !== undefined) s.autoNext = !!b.autoNext;
      if (b.autoRestart !== undefined) s.autoRestart = !!b.autoRestart;
      game.saveSettings();
      break;
    }
    default: return res.status(400).json({ error: 'Action inconnue' });
  }
  res.json({ ok: true, run: game.publicRunInfo(), settings: game.settings });
});

app.get('/api/admin/users', admin, (req, res) => {
  res.json({
    users: db.allUsers().map((u) => ({ id: u.id, pseudo: u.pseudo, role: isAdmin(u) ? 'admin' : 'player', banned: !!u.banned, cls: u.cls, level: u.level, gold: u.gold, glacons: u.glacons, stats: u.stats, createdAt: u.createdAt, online: isOnline(u.id) }))
  });
});

app.post('/api/admin/users/:id', admin, async (req, res) => {
  const u = db.userById(req.params.id);
  if (!u) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const b = req.body || {};
  if (b.banned !== undefined) {
    if (u.id === req.user.id) return res.status(400).json({ error: 'Impossible de te bannir toi-même.' });
    u.banned = !!b.banned;
    if (u.banned) { db.deleteUserSessions(u.id); game.removeHero(u.id); }
  }
  if (b.gold !== undefined) u.gold = Math.max(0, Math.floor(Number(b.gold) || 0));
  if (b.addGold !== undefined) u.gold = Math.max(0, u.gold + Math.floor(Number(b.addGold) || 0));
  if (b.addGlacons !== undefined) u.glacons = Math.max(0, u.glacons + Math.min(1000, Math.floor(Number(b.addGlacons) || 0)));
  if (b.addXp !== undefined) {
    const n = Math.floor(Number(b.addXp) || 0);
    if (n <= 0 || n > 10_000_000) return res.status(400).json({ error: 'Quantité d’XP invalide.' });
    game.grantXp(u, n);
  }
  if (b.level !== undefined) { u.level = Math.min(GD.PROGRESSION.MAX_LEVEL, Math.max(1, Math.floor(Number(b.level) || 1))); u.xp = 0; db.syncAttrPoints(u); }
  if (b.resetClass) u.cls = 'habitant';
  if (b.password) {
    if (String(b.password).length < 6) return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum.' });
    u.passHash = await bcrypt.hash(String(b.password), 10);
    db.deleteUserSessions(u.id);
  }
  afterProfileChange(u);
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', admin, (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Impossible de supprimer ton propre compte ici.' });
  game.removeHero(req.params.id);
  db.deleteUser(req.params.id);
  res.json({ ok: true });
});

/* ============================== Fichiers statiques ============================== */
// La page d'administration n'est servie qu'au compte « admin »
app.get(['/admin', '/admin.html'], (req, res) => {
  const u = db.sessionUser(parseCookies(req.headers.cookie).sid);
  if (!isAdmin(u)) return res.redirect('/');
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

/* ============================== Temps réel ============================== */
function isOnline(userId) {
  for (const s of io.sockets.sockets.values()) if (s.data.userId === userId) return true;
  return false;
}

io.on('connection', (socket) => {
  const token = parseCookies(socket.handshake.headers.cookie).sid;
  const u = db.sessionUser(token);
  socket.data.userId = u ? u.id : null;

  // L'écran du stream (OBS) est public, en lecture seule
  socket.on('watch', () => {
    socket.join('stream');
    socket.emit('roster', game.rosterPayload());
  });

  if (!u) return;
  socket.emit('state', game.playerState(u.id));

  socket.on('join', (ack) => {
    const user = db.userById(socket.data.userId);
    if (!user || user.banned) return;
    const h = game.joinUser(user);
    if (typeof ack === 'function') ack(h ? { ok: true } : { error: 'La bataille est complète.' });
  });
  socket.on('leave', () => game.removeHero(socket.data.userId));
  socket.on('vote', (opt) => game.castVote(socket.data.userId, String(opt)));
});

game.start();
server.listen(config.PORT, () => {
  console.log(`⚔️  Serveur prêt sur http://localhost:${config.PORT}`);
  console.log(`   Joueurs : /   ·   Stream (OBS) : /stream   ·   Admin : /admin`);
});

module.exports = { app, server, game };
