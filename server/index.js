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
const mini = require('./mini');
const pets = require('./pets');
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
    gold: u.gold, look: u.look, inventory: u.inventory, equip: u.equip, glacons: u.glacons, glaconsOpened: u.glaconsOpened || 0, ai: u.ai, stats: u.stats, inRun: game.heroes.has(u.id),
    attrs: u.attrs, attrPoints: u.attrPoints, skills: u.skills || {}, house: GD.houseOf(u), skillLost: u.skillLost || 0, twitchName: u.twitchName || null, mysticFound: !!u.mysticFound,
    locked: Object.fromEntries(u.inventory.map((it) => [it.uid, lockOf(u, it.uid)]).filter(([, l]) => l)),
    incomingTrades: db.data.trades.filter((t) => t.toId === u.id).length
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
  const b = req.body || {};
  const clean = GD.sanitizeLook(b);
  // toute valeur envoyée doit être valide (pas de correction silencieuse côté client)
  for (const k of Object.keys(clean)) if (b[k] !== undefined && b[k] !== clean[k]) return res.status(400).json({ error: 'Apparence invalide' });
  req.user.look = clean;
  afterProfileChange(req.user);
  res.json({ user: publicUser(req.user) });
});

app.put('/api/me/ai', auth, (req, res) => {
  const b = req.body || {};
  const O = GD.AI_OPTIONS;
  const ai = { ...req.user.ai };
  if (b.stance in O.stance) ai.stance = b.stance;
  if (b.target in O.target) ai.target = b.target;
  if (b.ult in O.ult) ai.ult = b.ult;
  req.user.ai = ai;
  afterProfileChange(req.user);
  res.json({ user: publicUser(req.user) });
});

/* ============================== Mini-jeux (expéditions solo) ============================== */
function miniReply(res, u, fn) {
  try {
    fn();
    db.markDirty();
    res.json({ mini: mini.publicState(u), user: publicUser(u) });
  } catch (e) {
    // refus : le rapport de la page a pu être pris en compte avant l'action, on renvoie l'état à jour
    if (e instanceof mini.MiniError || e instanceof pets.PetError) { db.markDirty(); return res.status(400).json({ error: e.message, mini: mini.publicState(u) }); }
    throw e;
  }
}
app.get('/api/mini', auth, (req, res) => res.json({ mini: mini.publicState(req.user) }));
app.post('/api/mini/start', auth, (req, res) => miniReply(res, req.user, () => mini.start(req.user, String((req.body || {}).mode), db.gearOf(req.user))));
app.post('/api/mini/act', auth, (req, res) => {
  const b = req.body || {};
  const report = b.report && typeof b.report === 'object' ? b.report : null;
  miniReply(res, req.user, () => mini.act(req.user, { action: String(b.action), report, slot: b.slot === 'all' ? 'all' : Number(b.slot) || 0, id: String(b.id || '') }, { grantXp: (u, xp) => game.grantXp(u, xp) }));
});
// Familiers : chenil (Grêlons), familiers actifs (2 au plus), familier principal (stream, niveau 10+)
app.post('/api/pets/buy', auth, (req, res) => miniReply(res, req.user, () => pets.buy(req.user, String((req.body || {}).kind))));
app.post('/api/pets/active', auth, (req, res) => miniReply(res, req.user, () => pets.setActive(req.user, Array.isArray((req.body || {}).ids) ? req.body.ids : [])));
app.post('/api/pets/hatch', auth, (req, res) => {
  try {
    const hatch = pets.hatchEgg(req.user, String((req.body || {}).id));
    db.markDirty();
    res.json({ hatch, mini: mini.publicState(req.user), user: publicUser(req.user) });
  } catch (e) {
    if (e instanceof pets.PetError) return res.status(400).json({ error: e.message });
    throw e;
  }
});
app.post('/api/pets/main', auth, (req, res) => miniReply(res, req.user, () => { pets.setMain(req.user, (req.body || {}).id ? String(req.body.id) : null); afterProfileChange(req.user); }));
app.post('/api/mini/upgrade', auth, (req, res) => miniReply(res, req.user, () => { mini.buyUpgrade(req.user, String((req.body || {}).id)); afterProfileChange(req.user); }));

/* ============================== Améliorations d'habitation ============================== */
app.post('/api/me/house', auth, (req, res) => {
  const u = req.user;
  const key = (req.body || {}).key;
  const fam = GD.familyOf(u.cls);
  const def = key === 'special' ? GD.HOUSE_SPECIALS[fam] : GD.HOUSE_UPGRADES[key];
  if (!def) return res.status(400).json({ error: 'Amélioration inconnue' });
  const h = GD.houseOf(u);
  const lvl = key === 'special' ? h.special[fam] || 0 : h[key];
  if (lvl >= def.max) return res.status(400).json({ error: 'Niveau maximum atteint.' });
  const cost = GD.houseCost(def, lvl);
  if (u.gold < cost) return res.status(400).json({ error: 'Pas assez de Grêlons' });
  u.gold -= cost;
  if (key === 'special') h.special[fam] = lvl + 1; else h[key] = lvl + 1;
  u.house = h;
  afterProfileChange(u);
  res.json({ user: publicUser(u) });
});

/* ============================== Arbre de compétences ============================== */
app.post('/api/me/skill', auth, (req, res) => {
  const u = req.user;
  const n = GD.SKILLS[(req.body || {}).id];
  if (!n) return res.status(400).json({ error: 'Compétence inconnue' });
  const PR = GD.PROGRESSION;
  const cur = GD.CLASSES[u.cls];
  const base = GD.familyOf(u.cls);
  u.skills ||= {};
  if (n.core) {
    // centre de l'arbre : toujours disponible
  } else if (n.init) {
    // branche de classe : le premier point fait devenir cette classe
    if (cur.tier === 0) { if (u.level < PR.CLASS_LEVEL) return res.status(400).json({ error: `Les branches de classe s’ouvrent au niveau ${PR.CLASS_LEVEL}.` }); }
    else if (n.base !== base) return res.status(400).json({ error: `Tu as choisi la branche ${GD.CLASSES[base].name} : les autres sont bloquées (reconversion possible).` });
  } else {
    if (cur.tier === 0 || n.base !== base) return res.status(400).json({ error: `Entre d’abord dans la branche ${GD.CLASSES[n.base].name}.` });
    const started = GD.startedBranch(u.skills);
    if (started && started !== n.spec) return res.status(400).json({ error: `Tu as choisi la voie ${GD.CLASSES[started].name} : les autres branches sont bloquées (reconversion possible).` });
    if (n.step === 1 && (u.skills[`init_${n.base}`] || 0) < GD.SKILL_MAX_RANK) return res.status(400).json({ error: `Maîtrise d’abord « ${GD.SKILLS[`init_${n.base}`].name} » (${GD.SKILL_MAX_RANK}/${GD.SKILL_MAX_RANK}).` });
    if (n.ult && u.level < PR.ULT_LEVEL) return res.status(400).json({ error: `L’ultime se débloque au niveau ${PR.ULT_LEVEL}.` });
  }
  const rank = u.skills[n.id] || 0;
  if (rank >= n.max) return res.status(400).json({ error: 'Rang maximum atteint.' });
  if (n.requires && (u.skills[n.requires] || 0) < GD.requiredRank(n.requires)) return res.status(400).json({ error: GD.SKILLS[n.requires].ult ? 'Débloque d’abord l’ultime.' : `Place au moins ${GD.requiredRank(n.requires)} points dans « ${GD.SKILLS[n.requires].name} ».` });
  if (GD.skillPoints(u).free < 1) return res.status(400).json({ error: 'Pas assez de points de compétence.' });
  u.skills[n.id] = rank + 1;
  if (n.init && cur.tier === 0) u.cls = n.base; // entrée dans la branche de classe
  if (n.spec && GD.CLASSES[u.cls].tier === 1) u.cls = n.spec; // entrée dans la sous-branche : spécialisation
  afterProfileChange(u);
  res.json({ user: publicUser(u) });
});

// Reconversion : remise à zéro de l'arbre, en perdant un quart des points attribués. Le joueur revient au
// centre de l'arbre (Paysan) et choisit à nouveau sa branche dans l'onglet « Classe & compétences ».
app.post('/api/me/respec', auth, (req, res) => {
  const u = req.user;
  if (GD.CLASSES[u.cls].tier === 0 && !Object.keys(u.skills || {}).length) return res.status(400).json({ error: 'Ton arbre est déjà vide.' });
  const { spent } = GD.skillPoints(u);
  const lost = Math.floor(spent * GD.PROGRESSION.SKILL_RESPEC_LOSS);
  u.skillLost = (u.skillLost || 0) + lost;
  u.skills = {};
  // les améliorations d'habitation sont remises à zéro, 75 % des Grêlons dépensés sont remboursés
  const refund = Math.floor(GD.houseSpent(u) * GD.HOUSE_RESPEC_REFUND);
  u.gold += refund;
  u.house = { hp: 0, heal: 0, special: {} };
  u.cls = 'habitant';
  afterProfileChange(u);
  res.json({ user: publicUser(u), lost, refund });
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
// Un objet en vente ou proposé dans un échange est « verrouillé » : ni équipable, ni recyclable
function lockOf(u, uid) {
  if (db.data.market.some((l) => l.sellerId === u.id && l.uid === uid)) return 'vente';
  if (db.data.trades.some((t) => (t.fromId === u.id && t.give === uid) || (t.toId === u.id && t.want === uid))) return 'échange';
  return null;
}
function findItem(u, uid) { return u.inventory.find((x) => x.uid === uid) || null; }
function isWorn(u, uid) { return Object.values(u.equip).includes(uid); }
// Retire un objet d'un inventaire (et le déséquipe)
function takeItem(u, uid) {
  const it = findItem(u, uid);
  if (!it) return null;
  u.inventory = u.inventory.filter((x) => x !== it);
  for (const s of GD.SLOTS) if (u.equip[s] === uid) delete u.equip[s];
  return it;
}
function giveItem(u, it) {
  u.inventory.push({ ...it, at: Date.now() });
  if (it.r >= 5) u.mysticFound = true; // la rareté secrète est découverte
}
function refreshUser(u) { const h = game.heroes.get(u.id); if (h) game.refreshHero(h); }
// Annule ventes et échanges qui concernent un objet qui a changé de main
function purgeItem(uid) {
  db.data.market = db.data.market.filter((l) => l.uid !== uid);
  db.data.trades = db.data.trades.filter((t) => t.give !== uid && t.want !== uid);
}

app.put('/api/me/equip', auth, (req, res) => {
  const u = req.user;
  const { uid, slot } = req.body || {};
  if (uid === null && GD.SLOTS.includes(slot)) {
    delete u.equip[slot];
  } else {
    const it = findItem(u, uid);
    if (!it) return res.status(400).json({ error: 'Objet introuvable' });
    if (GD.isConsumable(it.t)) return res.status(400).json({ error: 'Cet objet ne s’équipe pas : utilise-le.' });
    if (!GD.canUse(it.t, u.cls)) return res.status(400).json({ error: 'Cet objet n’est pas fait pour ta classe.' });
    const lock = lockOf(u, uid);
    if (lock) return res.status(400).json({ error: `Cet objet est en ${lock}.` });
    u.equip[GD.TEMPLATES[it.t].slot] = it.uid;
  }
  afterProfileChange(u);
  res.json({ user: publicUser(u) });
});

// Parchemin de mémoire : rend 1 point de compétence perdu en reconversion
app.post('/api/inventory/use', auth, (req, res) => {
  const u = req.user;
  const it = findItem(u, (req.body || {}).uid);
  if (!it || !GD.isConsumable(it.t)) return res.status(400).json({ error: 'Objet introuvable' });
  const lock = lockOf(u, it.uid);
  if (lock) return res.status(400).json({ error: `Cet objet est en ${lock}.` });
  if (GD.TEMPLATES[it.t].consumable === 'skill') {
    if (!(u.skillLost > 0)) return res.status(400).json({ error: 'Tu n’as aucun point de compétence perdu à récupérer.' });
    u.skillLost--;
  }
  takeItem(u, it.uid);
  afterProfileChange(u);
  res.json({ user: publicUser(u) });
});

app.post('/api/inventory/recycle', auth, (req, res) => {
  const u = req.user;
  const it = findItem(u, (req.body || {}).uid);
  if (!it) return res.status(400).json({ error: 'Objet introuvable' });
  if (isWorn(u, it.uid)) return res.status(400).json({ error: 'Retire d’abord cet objet.' });
  const lock = lockOf(u, it.uid);
  if (lock) return res.status(400).json({ error: `Cet objet est en ${lock}.` });
  const gain = GD.recycleValue(it.r);
  takeItem(u, it.uid);
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
  u.glaconsOpened = (u.glaconsOpened || 0) + 1;
  const item = rollItem(u.cls);
  giveItem(u, item);
  db.markDirty();
  // la rareté secrète n'est jamais nommée publiquement
  if (GD.isConsumable(item.t)) game.pushFeed(`📜 ${u.pseudo} trouve un ${GD.TEMPLATES[item.t].name} dans un glaçon !`);
  else if (item.r === 5) game.pushFeed(`🌌 ${u.pseudo} a trouvé quelque chose d’inconnu dans un glaçon…`);
  else if (item.r === 4) game.pushFeed(`✨ ${u.pseudo} obtient un objet légendaire : ${GD.itemName(item, u.cls)} !`);
  res.json({ user: publicUser(u), item });
});

// Contenu d'un glaçon : 60% universel, 35% set de sa classe (moins si la classe a moins de 5 objets), 5% set d'une autre classe
function rollItem(cls) {
  // parfois un parchemin de mémoire à la place d'une pièce d'équipement
  if (Math.random() < GD.GLACONS.SCROLL_CHANCE) return { uid: crypto.randomUUID(), t: 'memoire', r: GD.TEMPLATES.memoire.rarity, at: Date.now() };
  const all = Object.keys(GD.TEMPLATES).filter((t) => !GD.isConsumable(t));
  const fam = GD.familyOf(cls);
  const universal = all.filter((t) => !GD.TEMPLATES[t].families);
  const mine = all.filter((t) => GD.TEMPLATES[t].families && GD.TEMPLATES[t].families.includes(fam));
  const others = all.filter((t) => GD.TEMPLATES[t].families && !GD.TEMPLATES[t].families.includes(fam));
  const x = Math.random();
  const G = GD.GLACONS;
  // la part « classe » est réduite si la classe a peu d'objets (ex. Habitant : 2 armes seulement)
  const mineChance = (1 - G.UNIVERSAL_CHANCE - G.OTHER_CLASS_CHANCE) * Math.min(1, mine.length / 5);
  let pool;
  if (x < G.OTHER_CLASS_CHANCE) pool = others;
  else if (x < G.OTHER_CLASS_CHANCE + mineChance) pool = mine;
  else pool = universal;
  const t = pool[Math.floor(Math.random() * pool.length)];
  return { uid: crypto.randomUUID(), t, r: GD.rollRarity(), at: Date.now() };
}

/* ============================== Place marchande ============================== */
const pubItem = (it) => (it ? { uid: it.uid, t: it.t, r: it.r } : null);
const pseudoOf = (id) => (db.userById(id) || {}).pseudo || '?';

app.get('/api/market', auth, (req, res) => {
  const u = req.user;
  const listings = [];
  for (const l of db.data.market) {
    if (l.reservedFor && l.reservedFor !== u.id && l.sellerId !== u.id) continue;
    const s = db.userById(l.sellerId);
    const it = s && !s.banned && findItem(s, l.uid);
    if (!it) continue;
    listings.push({ id: l.id, item: pubItem(it), price: l.price, seller: s.pseudo, mine: l.sellerId === u.id, reservedFor: l.reservedFor ? pseudoOf(l.reservedFor) : null, at: l.at });
  }
  const trades = db.data.trades.filter((t) => t.fromId === u.id || t.toId === u.id).map((t) => {
    const from = db.userById(t.fromId), to = db.userById(t.toId);
    return {
      id: t.id, incoming: t.toId === u.id, from: pseudoOf(t.fromId), to: pseudoOf(t.toId), gold: t.gold,
      give: pubItem(from && findItem(from, t.give)), want: t.want ? pubItem(to && findItem(to, t.want)) : null, at: t.at
    };
  });
  res.json({ listings: listings.sort((a, b) => b.at - a.at), trades });
});

// Vitrine d'un joueur (pour lui proposer un échange)
app.get('/api/players/:pseudo/items', auth, (req, res) => {
  const o = db.userByPseudo(req.params.pseudo);
  if (!o || o.banned) return res.status(404).json({ error: 'Joueur introuvable' });
  res.json({ pseudo: o.pseudo, cls: o.cls, items: o.inventory.filter((it) => !isWorn(o, it.uid) && !lockOf(o, it.uid)).map(pubItem) });
});

app.post('/api/market/sell', auth, (req, res) => {
  const u = req.user;
  const { uid, reservedFor } = req.body || {};
  const price = Math.floor(Number((req.body || {}).price));
  const it = findItem(u, uid);
  if (!it) return res.status(400).json({ error: 'Objet introuvable' });
  if (!(price >= 1 && price <= 1_000_000)) return res.status(400).json({ error: 'Prix invalide (1 à 1 000 000 Grêlons).' });
  if (lockOf(u, uid)) return res.status(400).json({ error: 'Objet déjà en vente ou en échange.' });
  if (db.data.market.filter((l) => l.sellerId === u.id).length >= 20) return res.status(400).json({ error: '20 objets en vente maximum.' });
  let reserved = null;
  if (reservedFor) {
    const o = db.userByPseudo(reservedFor);
    if (!o || o.id === u.id) return res.status(400).json({ error: 'Joueur introuvable.' });
    reserved = o.id;
  }
  for (const s of GD.SLOTS) if (u.equip[s] === uid) delete u.equip[s];
  db.data.market.push({ id: crypto.randomUUID(), sellerId: u.id, uid, price, reservedFor: reserved, at: Date.now() });
  afterProfileChange(u);
  res.json({ user: publicUser(u) });
});

app.post('/api/market/cancel', auth, (req, res) => {
  const u = req.user;
  const id = (req.body || {}).id;
  const n = db.data.market.length;
  db.data.market = db.data.market.filter((l) => !(l.id === id && l.sellerId === u.id));
  if (db.data.market.length === n) return res.status(404).json({ error: 'Annonce introuvable' });
  db.markDirty();
  res.json({ user: publicUser(u) });
});

app.post('/api/market/buy', auth, (req, res) => {
  const u = req.user;
  const l = db.data.market.find((x) => x.id === (req.body || {}).id);
  if (!l) return res.status(404).json({ error: 'Cette annonce n’existe plus.' });
  if (l.sellerId === u.id) return res.status(400).json({ error: 'C’est ta propre annonce.' });
  if (l.reservedFor && l.reservedFor !== u.id) return res.status(403).json({ error: 'Annonce réservée à un autre joueur.' });
  if (u.gold < l.price) return res.status(400).json({ error: 'Pas assez de Grêlons' });
  if (u.inventory.length >= 300) return res.status(400).json({ error: 'Inventaire plein.' });
  const seller = db.userById(l.sellerId);
  const it = seller && takeItem(seller, l.uid);
  if (!it) { purgeItem(l.uid); db.markDirty(); return res.status(410).json({ error: 'Objet plus disponible.' }); }
  purgeItem(l.uid);
  u.gold -= l.price;
  seller.gold += l.price;
  giveItem(u, it);
  refreshUser(seller);
  afterProfileChange(u);
  notify(seller.id, `💰 ${u.pseudo} a acheté ${GD.itemName(it, seller.cls)} pour ${l.price} Grêlons.`);
  res.json({ user: publicUser(u), item: pubItem(it) });
});

app.post('/api/market/gift', auth, (req, res) => {
  const u = req.user;
  const { uid, to } = req.body || {};
  const o = db.userByPseudo(to || '');
  if (!o || o.banned || o.id === u.id) return res.status(400).json({ error: 'Joueur introuvable.' });
  if (!findItem(u, uid)) return res.status(400).json({ error: 'Objet introuvable' });
  if (lockOf(u, uid)) return res.status(400).json({ error: 'Objet en vente ou en échange.' });
  if (o.inventory.length >= 300) return res.status(400).json({ error: 'L’inventaire de ce joueur est plein.' });
  const it = takeItem(u, uid);
  purgeItem(uid);
  giveItem(o, it);
  afterProfileChange(u);
  refreshUser(o);
  notify(o.id, `🎁 ${u.pseudo} t’a offert ${GD.itemName(it, o.cls)} !`);
  res.json({ user: publicUser(u) });
});

// Échange : mon objet (+ Grêlons éventuels) contre un objet d'un autre joueur
app.post('/api/market/trade', auth, (req, res) => {
  const u = req.user;
  const { give, want, to } = req.body || {};
  const gold = Math.max(0, Math.floor(Number((req.body || {}).gold) || 0));
  const o = db.userByPseudo(to || '');
  if (!o || o.banned || o.id === u.id) return res.status(400).json({ error: 'Joueur introuvable.' });
  if (!findItem(u, give) || lockOf(u, give)) return res.status(400).json({ error: 'Ton objet est introuvable, en vente ou déjà proposé.' });
  if (!findItem(o, want) || lockOf(o, want) || isWorn(o, want)) return res.status(400).json({ error: 'L’objet demandé n’est pas disponible.' });
  if (gold > u.gold) return res.status(400).json({ error: 'Pas assez de Grêlons.' });
  if (db.data.trades.filter((t) => t.fromId === u.id).length >= 10) return res.status(400).json({ error: '10 propositions en attente maximum.' });
  for (const s of GD.SLOTS) if (u.equip[s] === give) delete u.equip[s];
  db.data.trades.push({ id: crypto.randomUUID(), fromId: u.id, toId: o.id, give, want, gold, at: Date.now() });
  afterProfileChange(u);
  notify(o.id, `🔄 ${u.pseudo} te propose un échange (place marchande).`);
  res.json({ user: publicUser(u) });
});

app.post('/api/market/trade/:id/:action', auth, (req, res) => {
  const u = req.user;
  const t = db.data.trades.find((x) => x.id === req.params.id);
  if (!t || (t.fromId !== u.id && t.toId !== u.id)) return res.status(404).json({ error: 'Proposition introuvable' });
  const action = req.params.action;
  if (action === 'cancel' || action === 'refuse') {
    db.data.trades = db.data.trades.filter((x) => x !== t);
    db.markDirty();
    if (action === 'refuse') notify(t.fromId, `❌ ${u.pseudo} a refusé ton échange.`);
    return res.json({ user: publicUser(u) });
  }
  if (action !== 'accept' || t.toId !== u.id) return res.status(400).json({ error: 'Action impossible' });
  const from = db.userById(t.fromId);
  if (!from || !findItem(from, t.give) || !findItem(u, t.want)) { db.data.trades = db.data.trades.filter((x) => x !== t); db.markDirty(); return res.status(410).json({ error: 'Un des objets n’est plus disponible.' }); }
  if (from.gold < t.gold) return res.status(400).json({ error: `${from.pseudo} n’a plus assez de Grêlons.` });
  const a = takeItem(from, t.give), b = takeItem(u, t.want);
  purgeItem(t.give); purgeItem(t.want);
  giveItem(u, a); giveItem(from, b);
  from.gold -= t.gold; u.gold += t.gold;
  afterProfileChange(u);
  refreshUser(from);
  notify(from.id, `✅ ${u.pseudo} a accepté ton échange !`);
  res.json({ user: publicUser(u) });
});

// Notification en direct au joueur connecté
function notify(userId, text) {
  for (const s of io.sockets.sockets.values()) if (s.data.userId === userId) s.emit('notify', text);
}

app.get('/api/leaderboard', (req, res) => {
  const top = db.allUsers().filter((u) => !u.banned)
    .sort((a, b) => b.stats.bestWave - a.stats.bestWave || b.level - a.level || b.stats.kills - a.stats.kills)
    .slice(0, 20)
    .map((u) => ({ pseudo: u.pseudo, cls: u.cls, level: u.level, bestWave: u.stats.bestWave, kills: u.stats.kills }));
  res.json({ top });
});

app.get('/api/info', (req, res) => res.json({ publicUrl: config.PUBLIC_URL, twitch: twitch.settings.channel, subGrelons: twitch.settings.subGrelons, giftGrelons: twitch.settings.giftGrelons, run: game.publicRunInfo() }));

/* ============================== Twitch ============================== */
app.post('/api/me/twitch/code', auth, (req, res) => res.json({ code: twitch.newCode(req.user.id), channel: twitch.settings.channel }));
app.post('/api/me/twitch/unlink', auth, (req, res) => {
  delete req.user.twitchLogin; delete req.user.twitchName;
  db.markDirty();
  res.json({ user: publicUser(req.user) });
});
app.get('/api/admin/twitch', admin, (req, res) => res.json(twitch.info()));
app.post('/api/admin/twitch', admin, (req, res) => { twitch.configure(req.body || {}); res.json(twitch.info()); });
// simule un message du chat (tests sans être en live)
app.post('/api/admin/twitch/test', admin, (req, res) => {
  const { user, text } = req.body || {};
  const login = String(user || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 25);
  if (!login) return res.status(400).json({ error: 'Pseudo Twitch requis' });
  const event = (req.body || {}).event;
  if (['sub', 'prime', 'gift'].includes(event)) { twitch.simulate(login, String(user), event, Number((req.body || {}).count) || 1); return res.json(twitch.info()); }
  if (!text) return res.status(400).json({ error: 'Pseudo Twitch et message requis' });
  twitch.onChat(login, String(user), String(text).slice(0, 200));
  res.json(twitch.info());
});

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
    case 'start': game.startRun(b.wave || 1, { mode: b.mode, difficulty: b.difficulty }); break;
    case 'stop': game.stopRun(); break;
    case 'pause': game.paused = true; break;
    case 'ack': if (!game.endRunAck()) return res.status(400).json({ error: 'Aucun écran de fin à valider.' }); break;
    case 'resume': game.paused = false; break;
    case 'speed': game.speed = [1, 2, 3].includes(Number(b.speed)) ? Number(b.speed) : 1; break;
    case 'skip': game.skipWave(); break;
    case 'wave': game.setWave(b.wave); break;
    case 'next': if (game.phase === 'intermission') game.run.timer = 0; break;
    case 'openJoin': game.openJoin(b.seconds === undefined ? game.settings.joinWindow : b.seconds); break;
    case 'closeJoin': game.closeJoin(); break;
    case 'upgrade': if (!game.forceUpgrade(String(b.id))) return res.status(400).json({ error: 'Amélioration impossible (inconnue ou au maximum).' }); break;
    case 'treasury': for (const k of GD.RES_IDS) game.addRes(k, Number(b.amount) || 0); break;
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
      num('difficulty', 0.2, 5); num('intermission', 2, 120);
      num('maxHeroes', 1, 500); num('maxAliveMobs', 20, 600); num('voteEvery', 1, 20); num('joinWindow', 0, 7200); num('prepTime', 5, 600);
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
    users: db.allUsers().map((u) => ({ id: u.id, pseudo: u.pseudo, role: isAdmin(u) ? 'admin' : 'player', banned: !!u.banned, cls: u.cls, level: u.level, gold: u.gold, glacons: u.glacons, energy: mini.ensure(u).energy, twitch: u.twitchName || null, stats: u.stats, createdAt: u.createdAt, online: isOnline(u.id) }))
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
  // énergie des mini-jeux (peut dépasser le maximum, pour les tests)
  if (b.addEnergy !== undefined) {
    const m = mini.ensure(u);
    m.energy = Math.max(0, Math.min(99, m.energy + Math.floor(Number(b.addEnergy) || 0)));
    if (m.energy >= GD.MINI.ENERGY_MAX) m.energyAt = Date.now();
  }
  // test : faire éclore un œuf de familier (zone choisie, rareté au hasard)
  if (b.giveEgg !== undefined) {
    const [mode, tier] = String(b.giveEgg).split(':');
    if (!GD.MINI.MODES[mode]) return res.status(400).json({ error: 'Mini-jeu inconnu' });
    mini.ensure(u);
    // l'œuf de test est prêt à éclore tout de suite (sans les 30 min d'incubation) ; « :incuber » pour garder l'attente
    const wait = String(b.giveEgg).includes('incub');
    pets.addEgg(u, mode, Math.max(0, Math.min(2, Number(tier) || 0)), Date.now(), wait ? undefined : 0);
    afterProfileChange(u);
    return res.json({ ok: true, text: `œuf ${GD.MINI.MODES[mode].name.toLowerCase()} ${wait ? `en incubation (${GD.PETS.INCUBATION_MIN} min)` : 'prêt à éclore'} : onglet Mini-jeux → Familiers` });
  }
  if (b.addXp !== undefined) {
    const n = Math.floor(Number(b.addXp) || 0);
    if (n <= 0 || n > 10_000_000) return res.status(400).json({ error: 'Quantité d’XP invalide.' });
    game.grantXp(u, n);
  }
  if (b.level !== undefined) { u.level = Math.min(GD.PROGRESSION.MAX_LEVEL, Math.max(1, Math.floor(Number(b.level) || 1))); u.xp = 0; db.syncAttrPoints(u); }
  if (b.resetClass) { u.cls = 'habitant'; u.skills = {}; u.skillLost = 0; }
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
    if (typeof ack === 'function') ack(h && !h.error ? { ok: true } : { error: (h && h.error) || 'Impossible de rejoindre.' });
  });
  socket.on('vote', (opt) => game.castVote(socket.data.userId, String(opt)));
});

// récompenses de fin de partie : notification au joueur
// récompenses restées en attente (serveur arrêté en pleine partie) : versées au redémarrage
for (const u of db.allUsers()) if (u.pending) game.settlePending(u);
game.onPayout = (u, r) => notify(u.id, `🎁 Fin de partie : +${r.xp} XP, +${r.gold} Grêlons, +${r.glacons} glaçon(s)${r.levels ? ` · +${r.levels} niveau(x) !` : ''}`);
// récapitulatif détaillé de fin de partie sur la page joueur
game.onRunEnd = (userId, r) => { for (const s of io.sockets.sockets.values()) if (s.data.userId === userId) s.emit('runEnd', r); };
game.start();
const Twitch = require('./twitch');
const twitch = new Twitch(db, game, notify);
twitch.start();
server.listen(config.PORT, () => {
  console.log(`⚔️  Serveur prêt sur http://localhost:${config.PORT}`);
  console.log(`   Joueurs : /   ·   Stream (OBS) : /stream   ·   Admin : /admin`);
});

module.exports = { app, server, game };
