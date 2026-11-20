'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');

const config = require('./config');
const db = require('./db');
const Game = require('./game/engine');
const GD = require('../shared/constants');

db.load();

// Compte admin par variables d'environnement
if (config.ADMIN_PSEUDO && config.ADMIN_PASSWORD) {
  const u = db.userByPseudo(config.ADMIN_PSEUDO);
  if (!u) db.newUser(config.ADMIN_PSEUDO, bcrypt.hashSync(config.ADMIN_PASSWORD, 10), 'admin');
  else if (u.role !== 'admin') { u.role = 'admin'; db.markDirty(); }
}

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
  auth(req, res, () => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Réservé aux administrateurs' })));
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
    id: u.id, pseudo: u.pseudo, role: u.role, cls: u.cls, level: u.level, xp: u.xp, xpNext: GD.PROGRESSION.xpForLevel(u.level),
    gold: u.gold, look: u.look, owned: u.owned, equip: u.equip, ai: u.ai, stats: u.stats, inRun: game.heroes.has(u.id)
  };
}

/* ============================== Comptes ============================== */
const PSEUDO_RE = /^[A-Za-z0-9_\-]{3,20}$/;

app.post('/api/register', async (req, res) => {
  const { pseudo, password } = req.body || {};
  if (rateLimited('reg:' + req.ip)) return res.status(429).json({ error: 'Trop de tentatives, réessaie dans une minute.' });
  if (!PSEUDO_RE.test(pseudo || '')) return res.status(400).json({ error: 'Pseudo : 3 à 20 caractères (lettres, chiffres, _ et -).' });
  if (typeof password !== 'string' || password.length < 6 || password.length > 100) return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum.' });
  if (db.userByPseudo(pseudo)) return res.status(409).json({ error: 'Ce pseudo est déjà pris.' });
  const first = db.allUsers().length === 0;
  const u = db.newUser(pseudo, await bcrypt.hash(password, 10), first ? 'admin' : 'player');
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

app.post('/api/shop/buy', auth, (req, res) => {
  const u = req.user;
  const id = (req.body || {}).item;
  const a = GD.ARMORS[id];
  if (!a) return res.status(400).json({ error: 'Objet inconnu' });
  if (u.owned.includes(id)) return res.status(400).json({ error: 'Déjà possédé' });
  if (u.gold < a.price) return res.status(400).json({ error: 'Pas assez d’écus' });
  u.gold -= a.price;
  u.owned.push(id);
  u.equip[a.slot] = id;
  afterProfileChange(u);
  res.json({ user: publicUser(u) });
});

app.put('/api/me/equip', auth, (req, res) => {
  const u = req.user;
  const id = (req.body || {}).item;
  const a = GD.ARMORS[id];
  if (!a || !u.owned.includes(id)) return res.status(400).json({ error: 'Objet non possédé' });
  u.equip[a.slot] = id;
  afterProfileChange(u);
  res.json({ user: publicUser(u) });
});

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
    case 'bots': for (let i = 0; i < Math.min(50, Number(b.count) || 1); i++) game.addBot(); break;
    case 'clearBots': for (const h of [...game.heroes.values()]) if (h.isBot) game.removeHero(h.id); break;
    case 'kick': game.removeHero(String(b.id)); break;
    case 'announce': game.announce(String(b.text || '').slice(0, 80), String(b.sub || '').slice(0, 120)); break;
    case 'settings': {
      const s = game.settings;
      const num = (k, a, z) => { if (b[k] !== undefined && !isNaN(b[k])) s[k] = Math.min(z, Math.max(a, Number(b[k]))); };
      num('difficulty', 0.2, 5); num('intermission', 5, 120); num('choiceInterval', 10, 300); num('choiceDuration', 5, 60);
      num('maxHeroes', 1, 500); num('maxAliveMobs', 20, 600);
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
    users: db.allUsers().map((u) => ({ id: u.id, pseudo: u.pseudo, role: u.role, banned: !!u.banned, cls: u.cls, level: u.level, gold: u.gold, stats: u.stats, createdAt: u.createdAt, online: isOnline(u.id) }))
  });
});

app.post('/api/admin/users/:id', admin, async (req, res) => {
  const u = db.userById(req.params.id);
  if (!u) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const b = req.body || {};
  if (b.role && ['admin', 'player'].includes(b.role)) {
    if (u.id === req.user.id && b.role !== 'admin') return res.status(400).json({ error: 'Impossible de te retirer tes propres droits.' });
    u.role = b.role;
  }
  if (b.banned !== undefined) {
    if (u.id === req.user.id) return res.status(400).json({ error: 'Impossible de te bannir toi-même.' });
    u.banned = !!b.banned;
    if (u.banned) { db.deleteUserSessions(u.id); game.removeHero(u.id); }
  }
  if (b.gold !== undefined) u.gold = Math.max(0, Math.floor(Number(b.gold) || 0));
  if (b.level !== undefined) { u.level = Math.min(GD.PROGRESSION.MAX_LEVEL, Math.max(1, Math.floor(Number(b.level) || 1))); u.xp = 0; }
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
  socket.on('choose', (msg) => {
    if (msg && typeof msg === 'object') game.applyChoice(socket.data.userId, Number(msg.id), String(msg.option));
  });
  socket.on('vote', (opt) => game.castVote(socket.data.userId, String(opt)));
});

game.start();
server.listen(config.PORT, () => {
  console.log(`⚔️  Serveur prêt sur http://localhost:${config.PORT}`);
  console.log(`   Joueurs : /   ·   Stream (OBS) : /stream   ·   Admin : /admin`);
});

module.exports = { app, server, game };
