'use strict';
/*
 * Intégration Twitch : lecture du chat en anonyme (aucun identifiant nécessaire).
 * Commandes reconnues dans le chat de la chaîne :
 *   !join            → fait rejoindre la bataille au héros du compte lié
 *   !lier CODE       → lie le compte Twitch au compte du site (code affiché dans l'onglet Compte)
 *   !1 … !9 / !vote N → vote d'équipe pendant l'entracte
 */
const crypto = require('crypto');

const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';
const DEFAULTS = { channel: 'hyoneko_', enabled: true, chatVoteAll: true };

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
    db.data.settings.twitch = { ...DEFAULTS, ...(db.data.settings.twitch || {}) };
  }

  get settings() { return this.db.data.settings.twitch; }

  configure(s) {
    const t = this.settings;
    if (typeof s.channel === 'string') t.channel = s.channel.trim().toLowerCase().replace(/^#|^https?:\/\/(www\.)?twitch\.tv\//, '').replace(/[^a-z0-9_]/g, '').slice(0, 25) || DEFAULTS.channel;
    if (s.enabled !== undefined) t.enabled = !!s.enabled;
    if (s.chatVoteAll !== undefined) t.chatVoteAll = !!s.chatVoteAll;
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
      this.db.markDirty();
      this.notify(target.id, `✅ Compte Twitch « ${display} » lié !`, true);
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
