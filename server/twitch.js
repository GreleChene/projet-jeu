'use strict';
/*
 * Intégration Twitch : lecture du chat en anonyme (aucun identifiant nécessaire).
 * Commandes reconnues dans le chat de la chaîne :
 *   !join            → fait rejoindre la bataille au héros du compte lié
 *   !lier CODE       → lie le compte Twitch au compte du site (code affiché dans l'onglet Compte)
 *   !1 … !9 / !vote N → vote d'équipe (pendant la manche et l'entracte)
 * Abonnements (USERNOTICE, reçus aussi en lecture anonyme) : un abonnement (Prime compris) ou un abonnement offert
 * rapporte des Grêlons au compte lié. Si le compte Twitch n'est pas encore lié, les Grêlons attendent la liaison.
 */
const crypto = require('crypto');

const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';
const DEFAULTS = { channel: 'hyoneko_', enabled: true, chatVoteAll: true, subGrelons: 300, giftGrelons: 300 };
// multiplicateur selon le palier d'abonnement (Prime = palier 1)
const TIER_MULT = { Prime: 1, 1000: 1, 2000: 2, 3000: 5 };
const SUB_KINDS = ['sub', 'resub', 'primepaidupgrade', 'giftpaidupgrade', 'anongiftpaidupgrade'];
// valeurs des tags IRC échappées (\s = espace, \: = point-virgule)
const unescapeTag = (v) => String(v || '').replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\\\/g, '\\');

class Twitch {
  constructor(db, game, notify) {
    this.db = db;
    this.game = game;
    this.notify = notify;
    this.ws = null;
    this.status = 'déconnecté';
    this.log = [];
    this.codes = new Map(); // code -> { userId, expires }
    this.hint = new Map(); // login -> dernier rappel « lie ton compte »
    this.retry = 0;
    this.seen = new Set(); // identifiants d'événements déjà traités
    this.batch = new Map(); // login -> annonce groupée (abonnements offerts en masse)
    db.data.twitchPending = db.data.twitchPending || {}; // login Twitch -> Grêlons en attente de liaison
    db.data.settings.twitch = { ...DEFAULTS, ...(db.data.settings.twitch || {}) };
  }

  get settings() { return this.db.data.settings.twitch; }

  configure(s) {
    const t = this.settings;
    if (typeof s.channel === 'string') t.channel = s.channel.trim().toLowerCase().replace(/^#|^https?:\/\/(www\.)?twitch\.tv\//, '').replace(/[^a-z0-9_]/g, '').slice(0, 25) || DEFAULTS.channel;
    if (s.enabled !== undefined) t.enabled = !!s.enabled;
    if (s.chatVoteAll !== undefined) t.chatVoteAll = !!s.chatVoteAll;
    for (const k of ['subGrelons', 'giftGrelons']) if (s[k] !== undefined && Number.isFinite(Number(s[k]))) t[k] = Math.max(0, Math.min(100000, Math.round(Number(s[k]))));
    this.db.markDirty();
    this.restart();
  }

  start() { this.restart(); }

  restart() {
    if (this.ws) { try { this.ws.onclose = null; this.ws.close(); } catch (e) { /* */ } this.ws = null; }
    clearTimeout(this.timer);
    if (!this.settings.enabled) { this.status = 'désactivé'; return; }
    if (typeof WebSocket === 'undefined') { this.status = 'indisponible (Node 22+ requis)'; return; }
    this.status = 'connexion…';
    let ws;
    try { ws = new WebSocket(IRC_URL); } catch (e) { this.status = 'erreur : ' + e.message; return this.scheduleRetry(); }
    this.ws = ws;
    ws.onopen = () => {
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws.send('PASS SCHMOOPIIE');
      ws.send('NICK justinfan' + (10000 + Math.floor(Math.random() * 80000)));
      ws.send('JOIN #' + this.settings.channel);
    };
    ws.onmessage = (ev) => String(ev.data).split('\r\n').forEach((line) => line && this.onLine(line));
    ws.onerror = () => { this.status = 'erreur de connexion'; };
    ws.onclose = () => { this.ws = null; if (this.settings.enabled) { this.status = 'déconnecté (nouvel essai…)'; this.scheduleRetry(); } };
  }

  scheduleRetry() {
    clearTimeout(this.timer);
    const delay = Math.min(60000, 2000 * 2 ** this.retry++);
    this.timer = setTimeout(() => this.restart(), delay);
  }

  onLine(line) {
    if (line.startsWith('PING')) { this.ws && this.ws.send('PONG :tmi.twitch.tv'); return; }
    // @tags :login!login@login.tmi.twitch.tv PRIVMSG #chan :message
    const m = /^(?:@(\S+) )?:(\w+)!\S+ PRIVMSG #\w+ :(.*)$/.exec(line);
    if (m) {
      const tags = Object.fromEntries((m[1] || '').split(';').map((kv) => kv.split('=')));
      this.onChat(m[2].toLowerCase(), tags['display-name'] || m[2], m[3]);
      return;
    }
    // @tags :tmi.twitch.tv USERNOTICE #chan :message éventuel
    const n = /^@(\S+) :tmi\.twitch\.tv USERNOTICE #\w+/.exec(line);
    if (n) {
      const tags = Object.fromEntries(n[1].split(';').map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), unescapeTag(kv.slice(i + 1))]; }));
      this.onUserNotice(tags);
      return;
    }
    if (/ 366 /.test(line) || / JOIN #/.test(line)) { this.status = `connecté à #${this.settings.channel}`; this.retry = 0; }
  }

  userByTwitch(login) {
    return this.db.allUsers().find((u) => u.twitchLogin === login && !u.banned) || null;
  }

  // Message du chat (aussi utilisé par l'admin pour simuler un message)
  onChat(login, display, text) {
    text = String(text).trim();
    if (!text.startsWith('!')) return;
    this.log.push({ t: Date.now(), user: display, text: text.slice(0, 80) });
    if (this.log.length > 40) this.log.shift();
    const [cmd, arg] = text.slice(1).split(/\s+/);
    const c = (cmd || '').toLowerCase();
    const u = this.userByTwitch(login);

    if (c === 'join' || c === 'rejoindre') {
      if (!u) return this.remind(login, display);
      const h = this.game.joinUser(u);
      if (h && h.error) this.game.pushFeed(`${display} : ${h.error}`);
      else this.notify(u.id, '⚔️ Ton héros a rejoint la bataille depuis le chat Twitch !');
      return;
    }
    if (c === 'lier' || c === 'link') {
      const code = String(arg || '').trim();
      const entry = this.codes.get(code);
      if (!entry || entry.expires < Date.now()) return;
      this.codes.delete(code);
      const target = this.db.userById(entry.userId);
      if (!target) return;
      const prev = this.userByTwitch(login);
      if (prev && prev.id !== target.id) { delete prev.twitchLogin; delete prev.twitchName; }
      target.twitchLogin = login;
      target.twitchName = display;
      const pending = this.db.data.twitchPending[login] || 0;
      if (pending) { target.gold += pending; delete this.db.data.twitchPending[login]; }
      this.db.markDirty();
      this.notify(target.id, `✅ Compte Twitch « ${display} » lié !${pending ? ` +${pending} Grêlons de soutien récupérés.` : ''}`, true);
      this.game.pushFeed(`🔗 ${display} a lié son compte Twitch à ${target.pseudo}`);
      return;
    }
    // vote : !1 … !9 ou !vote 2
    let n = /^[1-9]$/.test(c) ? Number(c) : c === 'vote' && /^[1-9]$/.test(arg || '') ? Number(arg) : 0;
    if (n) {
      const v = this.game.run.vote;
      if (!v) return;
      const opt = v.options[n - 1];
      if (!opt) return;
      if (u && this.game.heroes.has(u.id)) this.game.castVote(u.id, opt);
      else if (this.settings.chatVoteAll) this.game.castVote('tw:' + login, opt, true);
    }
  }

  // Abonnement, réabonnement, Prime, abonnement offert…
  onUserNotice(tags) {
    if (tags.id) {
      if (this.seen.has(tags.id)) return;
      this.seen.add(tags.id);
      if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value);
    }
    const kind = tags['msg-id'];
    const login = String(tags.login || '').toLowerCase();
    if (!login || login === 'ananonymousgifter') return;
    const display = tags['display-name'] || login;
    const plan = tags['msg-param-sub-plan'];
    const mult = TIER_MULT[plan] || 1;
    // un don en masse arrive comme un « submysterygift » suivi d'un « subgift » par abonnement offert : on ne compte que ces derniers
    if (SUB_KINDS.includes(kind)) this.rewardSub(login, display, 'sub', this.settings.subGrelons * mult, plan === 'Prime');
    else if (kind === 'subgift') this.rewardSub(login, display, 'gift', this.settings.giftGrelons * mult);
  }

  rewardSub(login, display, kind, amount, prime) {
    if (!(amount > 0)) return;
    const u = this.userByTwitch(login);
    if (u) u.gold += amount;
    else this.db.data.twitchPending[login] = (this.db.data.twitchPending[login] || 0) + amount;
    this.db.markDirty();
    // annonces groupées quelques secondes (50 abonnements offerts = une seule annonce)
    const b = this.batch.get(login) || { display, subs: 0, gifts: 0, amount: 0, prime: false };
    if (kind === 'gift') b.gifts++; else { b.subs++; b.prime = b.prime || !!prime; }
    b.amount += amount;
    if (!b.timer) b.timer = setTimeout(() => this.flushSub(login), 3000);
    this.batch.set(login, b);
  }

  flushSub(login) {
    const b = this.batch.get(login);
    this.batch.delete(login);
    if (!b) return;
    const what = [b.subs ? (b.prime ? 's’abonne avec Prime' : 's’abonne') : '', b.gifts ? `offre ${b.gifts} abonnement${b.gifts > 1 ? 's' : ''}` : ''].filter(Boolean).join(' et ');
    const u = this.userByTwitch(login);
    this.game.pushFeed(`💜 ${b.display} ${what} ! +${b.amount} Grêlons${u ? '' : ' (lie ton compte sur le site pour les récupérer)'}`);
    if (u) this.notify(u.id, `💜 Merci pour ton soutien sur Twitch : +${b.amount} Grêlons !`);
  }

  // Test depuis l'admin : abonnement, Prime ou abonnements offerts simulés
  simulate(login, display, event, count) {
    const plan = event === 'prime' ? 'Prime' : '1000';
    if (event === 'gift') for (let i = 0; i < Math.max(1, Math.min(100, count | 0)); i++) this.onUserNotice({ 'msg-id': 'subgift', login, 'display-name': display, 'msg-param-sub-plan': plan });
    else this.onUserNotice({ 'msg-id': 'sub', login, 'display-name': display, 'msg-param-sub-plan': plan });
  }

  remind(login, display) {
    const last = this.hint.get(login) || 0;
    if (Date.now() - last < 60000) return;
    this.hint.set(login, Date.now());
    this.game.pushFeed(`${display} : lie ton compte Twitch sur le site pour jouer (onglet Compte) !`);
  }

  // Code à taper dans le chat pour lier un compte
  newCode(userId) {
    for (const [k, v] of this.codes) if (v.userId === userId || v.expires < Date.now()) this.codes.delete(k);
    let code;
    do { code = String(crypto.randomInt(1000, 10000)); } while (this.codes.has(code));
    this.codes.set(code, { userId, expires: Date.now() + 10 * 60 * 1000 });
    return code;
  }

  info() { return { ...this.settings, status: this.status, log: this.log.slice(-15).reverse() }; }
}

module.exports = Twitch;
