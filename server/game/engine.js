'use strict';
/*
 * Moteur de jeu autoritaire (côté serveur).
 * Simule la partie à TICK_RATE Hz, diffuse des instantanés à l'écran du stream
 * et un état personnel à chaque joueur.
 */
const GD = require('../../shared/constants');
const Terrain = require('../../shared/terrain');
const U = require('./util');
const config = require('../config');

const { WORLD, CLASSES, MOBS, MOB_IDS, ARMORS, UPGRADES, PERSONAL_CHOICES, PROGRESSION, BOSS_WAVES } = GD;
const MOB_INDEX = Object.fromEntries(MOB_IDS.map((id, i) => [id, i]));
const { PROJ_KINDS, ZONE_KINDS, HF, MF } = GD.NET;
const PROJ_INDEX = Object.fromEntries(PROJ_KINDS.map((k, i) => [k, i]));
const ZONE_INDEX = Object.fromEntries(ZONE_KINDS.map((k, i) => [k, i]));

const TOWER_BASE_HP = 200;

const DEFAULT_SETTINGS = {
  voteEvery: 2, // vote des viewers toutes les N manches
  difficulty: 1, // multiplicateur global
  intermission: 20, // secondes d'entracte (vote)
  choiceInterval: 40, // un choix personnel toutes les X secondes de combat
  choiceDuration: 15,
  autoNext: true, // enchaîne les manches automatiquement
  autoRestart: false, // relance une partie après une défaite
  maxHeroes: 200,
  maxAliveMobs: 260
};


class Game {
  constructor(db, io) {
    this.db = db;
    this.io = io;
    this.settings = { ...DEFAULT_SETTINGS, ...(db.data.settings.game || {}) };
    this.nid = 1;
    this.heroes = new Map(); // id -> héros
    this.mobs = [];
    this.allies = []; // invocations
    this.projectiles = [];
    this.zones = [];
    this.events = [];
    this.feed = [];
    this.mobHash = new U.SpatialHash(80);
    this.rosterVersion = 1;
    this.time = 0;
    this.paused = false;
    this.resetRun();
    this.phase = 'lobby';
  }

  /* ============================== Partie ============================== */
  resetRun() {
    this.run = {
      id: Date.now(),
      seed: (Math.random() * 1e9) | 0,
      wave: 0,
      cleared: 0,
      uprooted: false,
      tower: { hp: TOWER_BASE_HP, max: TOWER_BASE_HP, ballistaT: 0, catapultT: 0 },
      treasury: 0,
      wealthEarned: 0,
      upgrades: Object.fromEntries(Object.keys(UPGRADES).map((k) => [k, 0])),
      pactNext: false,
      pactActive: false,
      queue: [],
      spawnT: 0,
      bossPending: [],
      waveTime: 0,
      choiceT: 0,
      timer: 0, // compte à rebours de l'entracte
      vote: null,
      startedAt: Date.now()
    };
    this.nodes = Terrain.resourceNodes(this.run.seed);
    this.mobs = []; this.allies = []; this.projectiles = []; this.zones = [];
    for (const h of this.heroes.values()) this.resetHeroForRun(h);
    this.terrainChanged();
  }

  terrainChanged() {
    this.terrain = Terrain.terrainState(this.run.cleared, this.run.uprooted);
    this.terrainVersion = (this.terrainVersion || 0) + 1;
  }

  saveSettings() {
    this.db.data.settings.game = this.settings;
    this.db.markDirty();
  }

  startRun(fromWave = 1) {
    this.resetRun();
    this.run.cleared = Math.max(0, Math.min(99, (fromWave | 0) - 1));
    this.run.wave = this.run.cleared;
    // si on démarre plus loin (test), on donne un peu de richesse et d'améliorations cohérentes
    if (this.run.cleared > 0) this.run.treasury = this.run.wealthEarned = this.run.cleared * 25;
    this.terrainChanged();
    this.phase = 'intermission';
    this.run.timer = 8;
    this.paused = false;
    this.announce('La bataille va commencer !', 'Défendez la tour !');
  }

  stopRun() {
    this.finishRun(false, true);
    this.phase = 'lobby';
    this.resetRun();
  }

  gameOver() {
    this.phase = 'gameover';
    this.run.timer = 25;
    this.announce('La tour est tombée…', `Manche atteinte : ${this.run.wave}`);
    this.finishRun(false);
  }

  victory() {
    this.phase = 'victory';
    this.run.timer = 60;
    this.announce('VICTOIRE !', 'Les trois fléaux sont vaincus !');
    this.finishRun(true);
  }

  // Statistiques de fin de partie (persistantes)
  finishRun(won, silent) {
    for (const h of this.heroes.values()) {
      const u = h.userId && this.db.userById(h.userId);
      if (!u) continue;
      u.stats.runs++;
      u.stats.bestWave = Math.max(u.stats.bestWave, won ? 100 : this.run.cleared);
    }
    this.db.markDirty();
    if (!silent) this.pushFeed(won ? 'Victoire !' : `Défaite à la manche ${this.run.wave}`);
  }

  setWave(n) {
    n = U.clamp(n | 0, 1, 100);
    this.mobs = []; this.projectiles = []; this.zones = [];
    this.run.queue = []; this.run.bossPending = [];
    this.run.cleared = n - 1;
    this.run.wave = n - 1;
    this.run.uprooted = n > 30;
    this.terrainChanged();
    if (this.phase === 'lobby' || this.phase === 'gameover' || this.phase === 'victory') this.phase = 'intermission';
    this.closeVote(true);
    this.startWave(n);
  }

  skipWave() {
    if (this.phase !== 'wave') return;
    this.mobs = []; this.run.queue = []; this.run.bossPending = [];
    this.projectiles = this.projectiles.filter((p) => p.side !== 'mob');
  }

  /* ============================== Héros ============================== */
  heroCount() { return this.heroes.size; }

  joinUser(user) {
    if (this.heroes.has(user.id)) return this.heroes.get(user.id);
    if (this.heroes.size >= this.settings.maxHeroes) return null;
    const h = this.makeHero({ id: user.id, userId: user.id, name: user.pseudo, isBot: false });
    this.refreshHero(h);
    h.hp = h.maxHp;
    this.heroes.set(h.id, h);
    this.rosterVersion++;
    this.pushFeed(`${h.name} rejoint la défense !`);
    this.fx(['text', h.x, h.y - 40, 'Nouveau héros !', GD.PALETTE.ui.gold]);
    return h;
  }

  addBot(opts = {}) {
    const all = GD.CLASS_IDS.filter((c) => c !== 'habitant');
    const cls = opts.cls || U.pick(all);
    const lvl = opts.level || (CLASSES[cls].tier === 2 ? 8 + ((Math.random() * 12) | 0) : 3 + ((Math.random() * 5) | 0));
    const heads = Object.keys(ARMORS).filter((a) => ARMORS[a].slot === 'head');
    const bodies = Object.keys(ARMORS).filter((a) => ARMORS[a].slot === 'body');
    const id = 'bot_' + this.nid;
    const h = this.makeHero({ id, userId: null, name: opts.name || `Bot${this.nid}`, isBot: true });
    h.bot = {
      cls, level: lvl,
      look: { cape: (Math.random() * 10) | 0, skin: (Math.random() * 5) | 0, hair: (Math.random() * 6) | 0 },
      equip: { head: U.pick(heads), body: U.pick(bodies) },
      attrs: (() => { const a = GD.emptyAttrs(); for (let i = 1; i < lvl; i++) a[U.pick(GD.ATTR_IDS)]++; return a; })(),
      ai: { stance: U.pick(['offensive', 'balanced', 'defensive']), target: U.pick(['nearest', 'weakest', 'strongest', 'tower']), retreat: U.pick([0, 25, 50]), ult: U.pick(['asap', 'smart', 'boss']) }
    };
    this.refreshHero(h);
    h.hp = h.maxHp;
    this.heroes.set(id, h);
    this.rosterVersion++;
    return h;
  }

  removeHero(id) {
    const h = this.heroes.get(id);
    if (!h) return;
    this.heroes.delete(id);
    this.allies = this.allies.filter((a) => a.ownerId !== id);
    this.rosterVersion++;
    this.pushFeed(`${h.name} quitte la bataille.`);
  }

  makeHero({ id, userId, name, isBot }) {
    const a = Math.random() * Math.PI * 2;
    return {
      nid: this.nid++, id, userId, name, isBot,
      x: WORLD.CX + Math.cos(a) * 110, y: WORLD.CY + Math.sin(a) * 80,
      facing: a, alive: true, hp: 1, maxHp: 1, ult: 0, atkT: 0, retargetT: 0, target: null,
      buffs: {}, status: {}, timers: { stealth: 0, dash: 3, heal: 2, harvest: 0, summon: 0 },
      respawnT: 0, zombie: false, deathX: 0, deathY: 0, attackAnim: 0, retreating: false, harvesting: false,
      runKills: 0, runGold: 0, runXp: 0, waveMult: 1, choice: null, idleAngle: a, dashing: null, chain: null
    };
  }

  resetHeroForRun(h) {
    h.alive = true; h.zombie = false; h.buffs = {}; h.status = {}; h.ult = 0; h.choice = null; h.dashing = null; h.chain = null;
    h.runKills = 0; h.runGold = 0; h.runXp = 0; h.waveMult = 1;
    const a = Math.random() * Math.PI * 2;
    h.x = WORLD.CX + Math.cos(a) * 110; h.y = WORLD.CY + Math.sin(a) * 80;
    this.refreshHero(h);
    h.hp = h.maxHp;
  }

  // Source des données du héros (profil joueur ou bot)
  heroProfile(h) {
    if (h.isBot) return h.bot;
    return this.db.userById(h.userId);
  }

  // Recalcule les statistiques à partir du profil (classe, niveau, armures, améliorations)
  refreshHero(h) {
    const p = this.heroProfile(h);
    if (!p) return;
    const prevCls = h.cls;
    h.cls = p.cls; h.level = p.level; h.look = p.look; h.equip = p.equip; h.ai = p.ai;
    h.attrs = p.attrs;
    const c = CLASSES[h.cls] || CLASSES.habitant;
    const ratio = h.maxHp > 1 ? h.hp / h.maxHp : 1;
    const st = GD.computeStats({ cls: h.cls, level: h.level, equip: h.equip, attrs: p.attrs, upgrades: this.run.upgrades });
    Object.assign(h, st);
    h.hp = Math.max(1, Math.min(h.maxHp, Math.round(h.maxHp * ratio)));
    if (prevCls && prevCls !== h.cls) {
      this.allies = this.allies.filter((a) => a.ownerId !== h.id);
      h.ult = 0;
      this.fx(['text', h.x, h.y - 46, c.name + ' !', c.color]);
      this.pushFeed(`${h.name} devient ${c.name} !`);
    }
    this.rosterVersion++;
  }

  // Gain d'XP / d'écus persistants
  reward(h, xp, gold) {
    const mult = h.waveMult * (1 + 0.2 * this.run.upgrades.banner) * (this.run.pactActive ? 2 : 1);
    xp = Math.round(xp * mult); gold = Math.round(gold * mult);
    h.runXp += xp; h.runGold += gold;
    const p = this.heroProfile(h);
    if (!p || h.isBot) return;
    p.gold += gold;
    p.xp += xp;
    let leveled = false;
    while (p.level < PROGRESSION.MAX_LEVEL && p.xp >= PROGRESSION.xpForLevel(p.level)) {
      p.xp -= PROGRESSION.xpForLevel(p.level);
      p.level++;
      p.attrPoints = (p.attrPoints || 0) + PROGRESSION.POINTS_PER_LEVEL;
      leveled = true;
    }
    if (leveled) {
      this.refreshHero(h);
      this.fx(['lvl', h.x, h.y, p.level]);
      if (p.level === PROGRESSION.CLASS_LEVEL || p.level === PROGRESSION.SPEC_LEVEL) this.pushFeed(`${h.name} peut faire évoluer sa classe !`);
      this.fx(['text', h.x, h.y - 70, '+1 point de stat', GD.PALETTE.fx.xp]);
    }
    this.db.markDirty();
  }

  /* ============================== Manches ============================== */
  aliveHeroes() {
    const out = [];
    for (const h of this.heroes.values()) if (h.alive) out.push(h);
    return out;
  }

  startWave(n) {
    const r = this.run;
    r.wave = n;
    r.pactActive = r.pactNext;
    r.pactNext = false;
    r.waveTime = 0;
    r.choiceT = Math.min(15, this.settings.choiceInterval);
    this.phase = 'wave';
    for (const h of this.heroes.values()) { h.waveMult = 1; h.choice = null; }
    this.buildWave(n);
    const era = GD.eraOfWave(n);
    const boss = BOSS_WAVES[n];
    if (n === 100) this.announce('MANCHE 100', 'Les trois fléaux se lèvent ensemble…');
    else if (n === 30) this.announce('MANCHE 30', 'Les arbres se déracinent !');
    else if (boss) this.announce(`MANCHE ${n}`, 'Un boss approche…');
    else if (n === era.from) this.announce(`MANCHE ${n}`, era.name);
    else this.announce(`MANCHE ${n}`, r.pactActive ? 'Pacte de sang : ennemis renforcés !' : '');
    if (n === 31) this.pushFeed('La corruption s’étend : attention au poison !');
    if (n === 61) this.pushFeed('La terre s’embrase…');
  }

  waveCleared() {
    const r = this.run;
    r.cleared = Math.max(r.cleared, r.wave);
    const wasBoss = !!BOSS_WAVES[r.wave];
    if (wasBoss) this.terrainChanged();
    // récompenses de fin de manche
    for (const h of this.heroes.values()) {
      this.reward(h, 10 + r.wave * 4, 2 + Math.ceil(r.wave / 2));
      if (!h.alive) { h.alive = true; h.zombie = false; h.hp = Math.round(h.maxHp * 0.5); h.x = WORLD.CX; h.y = WORLD.CY + 90; }
      if (h.zombie) { h.zombie = false; this.rosterVersion++; }
      const u = h.userId && this.db.userById(h.userId);
      if (u) u.stats.bestWave = Math.max(u.stats.bestWave, r.cleared);
    }
    const bonus = Math.round((15 + r.wave * 3) * (r.pactActive ? 2 : 1));
    this.addTreasury(bonus);
    r.pactActive = false;
    if (r.wave >= 100) return this.victory();
    this.phase = 'intermission';
    // Les viewers votent toutes les « voteEvery » manches ; sinon, courte pause
    const voting = this.isVoteWave(r.wave);
    r.timer = voting ? this.settings.intermission : Math.min(8, this.settings.intermission);
    this.announce(`Manche ${r.wave} terminée !`, wasBoss ? 'Le terrain se transforme…' : voting ? 'Votez pour une amélioration !' : `+${bonus} richesse`);
    if (voting) this.openVote();
  }

  isVoteWave(w) {
    const n = Math.max(1, Math.round(this.settings.voteEvery || 2));
    return w > 0 && w % n === 0;
  }

  nextVoteWave() {
    const n = Math.max(1, Math.round(this.settings.voteEvery || 2));
    return (Math.floor(this.run.cleared / n) + 1) * n;
  }

  addTreasury(n) {
    this.run.treasury += n;
    this.run.wealthEarned += n;
  }

  /* ============================== Votes d'équipe ============================== */
  upgradeCost(id) {
    const u = UPGRADES[id];
    return Math.round(u.cost * Math.pow(u.growth, this.run.upgrades[id]));
  }

  openVote() {
    const r = this.run;
    const avail = Object.keys(UPGRADES).filter((id) => {
      const u = UPGRADES[id];
      return !u.challenge && r.upgrades[id] < u.max && r.wealthEarned >= u.unlock;
    });
    // priorité aux améliorations abordables, puis les autres pour faire rêver
    const affordable = U.shuffle(avail.filter((id) => this.upgradeCost(id) <= r.treasury));
    const others = U.shuffle(avail.filter((id) => this.upgradeCost(id) > r.treasury));
    const opts = [...affordable, ...others].slice(0, 3);
    opts.push('pact', 'save');
    r.vote = { options: opts, votes: new Map(), endsAt: Date.now() + r.timer * 1000 };
  }

  castVote(userId, opt) {
    const v = this.run.vote;
    if (!v || this.phase !== 'intermission' || !v.options.includes(opt)) return false;
    if (!this.heroes.has(userId)) return false;
    if (opt !== 'save' && opt !== 'pact' && this.upgradeCost(opt) > this.run.treasury) return false;
    v.votes.set(userId, opt);
    return true;
  }

  voteCounts() {
    const v = this.run.vote;
    const counts = {};
    if (!v) return counts;
    for (const o of v.options) counts[o] = 0;
    for (const o of v.votes.values()) counts[o] = (counts[o] || 0) + 1;
    return counts;
  }

  closeVote(silent) {
    const v = this.run.vote;
    if (!v) return;
    this.run.vote = null;
    if (silent) return;
    // les bots votent au hasard
    for (const h of this.heroes.values()) if (h.isBot && !v.votes.has(h.id)) {
      const ok = v.options.filter((o) => o === 'save' || o === 'pact' || this.upgradeCost(o) <= this.run.treasury);
      v.votes.set(h.id, U.pick(ok));
    }
    const counts = {};
    for (const o of v.votes.values()) counts[o] = (counts[o] || 0) + 1;
    let best = 'save', bestN = 0;
    for (const o of v.options) if ((counts[o] || 0) > bestN) { best = o; bestN = counts[o]; }
    this.applyUpgrade(best);
  }

  applyUpgrade(id) {
    const r = this.run;
    if (id === 'save') { this.pushFeed('L’équipe économise sa richesse.'); return; }
    if (id === 'pact') {
      r.pactNext = true;
      this.pushFeed('💀 Pacte de sang accepté : la prochaine manche sera brutale !');
      return;
    }
    const cost = this.upgradeCost(id);
    if (cost > r.treasury) return;
    r.treasury -= cost;
    r.upgrades[id]++;
    const u = UPGRADES[id];
    this.pushFeed(`${u.icon} ${u.name} niveau ${r.upgrades[id]} !`);
    if (id === 'walls') {
      const add = Math.round(r.tower.max * 0.15);
      r.tower.max += add; r.tower.hp = Math.min(r.tower.max, r.tower.hp + add);
    }
    for (const h of this.heroes.values()) this.refreshHero(h);
  }

  /* ============================== Choix personnels ============================== */
  offerChoices() {
    const now = Date.now();
    const keys = Object.keys(PERSONAL_CHOICES);
    for (const h of this.heroes.values()) {
      if (!h.alive) continue;
      const opts = U.shuffle(keys.filter((k) => k !== 'challenge')).slice(0, 2);
      opts.push('challenge');
      h.choice = { id: now + h.nid, options: U.shuffle(opts), expires: now + this.settings.choiceDuration * 1000 };
      if (h.isBot && Math.random() < 0.7) setTimeout(() => this.applyChoice(h.id, h.choice && h.choice.id, U.pick(opts)), 1000 + Math.random() * 6000);
    }
  }

  applyChoice(heroId, choiceId, opt) {
    const h = this.heroes.get(heroId);
    if (!h || !h.choice || h.choice.id !== choiceId || !h.choice.options.includes(opt) || !h.alive) return false;
    h.choice = null;
    const P = GD.PALETTE.fx;
    switch (opt) {
      case 'fury': h.buffs.fury = 30; this.fx(['text', h.x, h.y - 40, 'FUREUR', P.burn]); break;
      case 'potion':
        this.healHero(h, h.maxHp * 0.7);
        h.status = {};
        break;
      case 'focus': h.ult = 1; this.fx(['text', h.x, h.y - 40, 'ULTIME PRÊT', P.xp]); break;
      case 'shield': h.buffs.shield = 20; this.fx(['text', h.x, h.y - 40, 'BOUCLIER', P.frost]); break;
      case 'swift': h.buffs.swift = 25; this.fx(['text', h.x, h.y - 40, 'CÉLÉRITÉ', P.heal]); break;
      case 'challenge': {
        h.waveMult = 2;
        const pool = this.mobPool(this.run.wave);
        const a = Math.atan2(h.y - WORLD.CY, h.x - WORLD.CX);
        for (let i = 0; i < 3; i++) {
          const p = this.edgePoint(a + (i - 1) * 0.25);
          const m = this.spawnMob(U.pick(pool), p.x, p.y, { elite: true });
          m.forcedTarget = h.id;
        }
        this.fx(['text', h.x, h.y - 40, 'DÉFI ACCEPTÉ', GD.PALETTE.ui.danger]);
        this.pushFeed(`💀 ${h.name} accepte un défi !`);
        break;
      }
      default: return false;
    }
    return true;
  }

  /* ============================== Boucle ============================== */
  start() {
    const dt = 1 / config.TICK_RATE;
    let acc = 0, snapAcc = 0, playerAcc = 0;
    let last = process.hrtime.bigint();
    this.loop = setInterval(() => {
      const now = process.hrtime.bigint();
      let el = Number(now - last) / 1e9;
      last = now;
      if (el > 0.25) el = 0.25;
      acc += el;
      while (acc >= dt) { acc -= dt; this.tick(dt); }
      snapAcc += el; playerAcc += el;
      if (snapAcc >= 1 / config.SNAPSHOT_RATE) { snapAcc = 0; this.broadcastSnapshot(); }
      if (playerAcc >= 1 / config.PLAYER_RATE) { playerAcc = 0; this.broadcastPlayers(); }
    }, 1000 / config.TICK_RATE);
  }

  tick(dt) {
    if (this.paused) return;
    this.time += dt;
    const r = this.run;
    this.mobHash.build(this.mobs);
    switch (this.phase) {
      case 'lobby':
        this.updateHeroes(dt);
        break;
      case 'intermission':
        r.timer -= dt;
        this.updateHeroes(dt);
        this.updateAllies(dt);
        this.updateProjectiles(dt);
        this.updateZones(dt);
        if (r.timer <= 0) {
          this.closeVote();
          if (this.settings.autoNext || r.wave === 0) this.startWave(r.wave + 1);
          else r.timer = 0;
        }
        break;
      case 'wave':
        r.waveTime += dt;
        this.updateSpawns(dt);
        this.updateHeroes(dt);
        this.updateAllies(dt);
        this.updateMobs(dt);
        this.updateTower(dt);
        this.updateProjectiles(dt);
        this.updateZones(dt);
        this.mobs = this.mobs.filter((m) => m.hp > 0);
        r.choiceT -= dt;
        if (r.choiceT <= 0) { r.choiceT = this.settings.choiceInterval; this.offerChoices(); }
        if (r.tower.hp <= 0) { r.tower.hp = 0; this.gameOver(); break; }
        if (!r.queue.length && !r.bossPending.length && !this.mobs.length) this.waveCleared();
        break;
      case 'gameover':
      case 'victory':
        r.timer -= dt;
        this.updateZones(dt);
        if (r.timer <= 0) {
          if (this.settings.autoRestart) this.startRun(1);
          else { this.phase = 'lobby'; this.resetRun(); }
        }
        break;
    }
    // expiration des choix personnels
    const now = Date.now();
    for (const h of this.heroes.values()) if (h.choice && h.choice.expires < now) h.choice = null;
  }

  updateTower(dt) {
    const r = this.run, t = r.tower, up = r.upgrades;
    const wscale = 1 + 0.08 * (r.wave - 1);
    if (up.ballista > 0) {
      t.ballistaT -= dt;
      if (t.ballistaT <= 0) {
        const tgt = this.nearestMob(WORLD.CX, WORLD.CY, 520);
        if (tgt) {
          t.ballistaT = 1.4 / (1 + 0.2 * up.ballista);
          this.shoot({ kind: 'ballista', side: 'hero', x: WORLD.CX, y: WORLD.CY - 70, target: tgt, dmg: 14 * (1 + 0.5 * up.ballista) * wscale, speed: 750, pierce: 2 });
        }
      }
    }
    if (up.catapult > 0) {
      t.catapultT -= dt;
      if (t.catapultT <= 0) {
        const tgt = this.densestMob();
        if (tgt) {
          t.catapultT = 4.5 - 0.4 * up.catapult;
          this.shoot({ kind: 'rock', side: 'hero', x: WORLD.CX, y: WORLD.CY - 70, tx: tgt.x, ty: tgt.y, dmg: 30 * up.catapult * wscale, speed: 420, explode: 95 });
        }
      }
    }
  }

  /* ============================== Combat générique ============================== */
  fx(e) { this.events.push(e); }

  announce(title, sub) { this.fx(['announce', title, sub || '']); }

  pushFeed(text) {
    this.feed.push({ t: Date.now(), text });
    if (this.feed.length > 30) this.feed.shift();
    this.fx(['feed', text]);
  }

  nearestMob(x, y, r, filter) {
    let best = null, bd = r * r;
    for (const m of this.mobs) {
      if (m.hp <= 0 || (filter && !filter(m))) continue;
      const d = (m.x - x) ** 2 + (m.y - y) ** 2;
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  mobsInRadius(x, y, r) { return this.mobHash.query(x, y, r + 40).filter((m) => m.hp > 0 && (m.x - x) ** 2 + (m.y - y) ** 2 <= (r + m.size) ** 2); }

  densestMob() {
    let best = null, bn = 0;
    for (let i = 0; i < this.mobs.length; i += Math.max(1, (this.mobs.length / 40) | 0)) {
      const m = this.mobs[i];
      const n = this.mobsInRadius(m.x, m.y, 90).length;
      if (n > bn) { bn = n; best = m; }
    }
    return best;
  }

  shoot(o) {
    const p = {
      kind: o.kind, side: o.side, x: o.x, y: o.y, dmg: o.dmg, speed: o.speed || 500,
      target: o.target || null, pierce: o.pierce || 1, hit: new Set(), life: o.life || 3,
      owner: o.owner || null, onHit: o.onHit || null, explode: o.explode || 0, crit: o.crit || false,
      tx: o.tx, ty: o.ty, radius: o.radius || 14
    };
    const tx = o.target ? o.target.x : o.tx, ty = o.target ? o.target.y : o.ty;
    const a = o.angle !== undefined ? o.angle : Math.atan2(ty - o.y, tx - o.x);
    p.vx = Math.cos(a) * p.speed; p.vy = Math.sin(a) * p.speed;
    if (o.kind === 'rock' || o.kind === 'fireball') p.life = Math.hypot(tx - o.x, ty - o.y) / p.speed;
    if (o.homing === false) p.target = null;
    this.projectiles.push(p);
    return p;
  }

  updateProjectiles(dt) {
    const keep = [];
    for (const p of this.projectiles) {
      p.life -= dt;
      if (p.target && p.target.hp > 0 && !p.target.dead) {
        const a = Math.atan2(p.target.y - p.y, p.target.x - p.x);
        p.vx = Math.cos(a) * p.speed; p.vy = Math.sin(a) * p.speed;
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      let done = false;
      if (p.explode && p.life <= 0) {
        this.explode(p);
        continue;
      }
      if (p.side === 'hero' && !p.explode) {
        const hits = this.mobHash.query(p.x, p.y, 60);
        for (const m of hits) {
          if (m.hp <= 0 || p.hit.has(m) || (m.x - p.x) ** 2 + (m.y - p.y) ** 2 > (m.size + p.radius) ** 2) continue;
          p.hit.add(m);
          this.damageMob(m, p.dmg, p.owner, { crit: p.crit, onHit: p.onHit, kind: p.kind });
          if (p.hit.size >= p.pierce) { done = true; break; }
        }
      } else if (p.side === 'mob') {
        // touche héros / invocations / tour
        for (const h of this.heroes.values()) {
          if (!h.alive || (h.x - p.x) ** 2 + (h.y - p.y) ** 2 > 18 * 18) continue;
          this.damageHero(h, p.dmg, p.onHit);
          done = true; break;
        }
        if (!done) for (const a of this.allies) {
          if (a.hp <= 0 || (a.x - p.x) ** 2 + (a.y - p.y) ** 2 > (a.size + 6) ** 2) continue;
          this.damageAlly(a, p.dmg); done = true; break;
        }
        if (!done && (p.x - WORLD.CX) ** 2 + (p.y - WORLD.CY) ** 2 < WORLD.TOWER_R ** 2) {
          this.damageTower(p.dmg); done = true;
        }
      }
      if (done || p.life <= 0 || p.x < -100 || p.y < -100 || p.x > WORLD.W + 100 || p.y > WORLD.H + 100) continue;
      keep.push(p);
    }
    this.projectiles = keep;
  }

  explode(p) {
    this.fx(['boom', p.x, p.y, p.explode, p.kind === 'fireball' ? 1 : 0]);
    for (const m of this.mobsInRadius(p.x, p.y, p.explode)) this.damageMob(m, p.dmg, p.owner, { onHit: p.onHit, kind: p.kind });
  }

  updateZones(dt) {
    for (const z of this.zones) {
      z.t -= dt;
      if (z.kind === 'poison' && z.t > 0) {
        z.tick = (z.tick || 0) - dt;
        if (z.tick <= 0) {
          z.tick = 0.5;
          for (const h of this.heroes.values()) if (h.alive && (h.x - z.x) ** 2 + (h.y - z.y) ** 2 < z.r * z.r) this.applyStatus(h, { poison: z.dps, dur: 2 });
        }
      }
      if (z.kind === 'telegraph' && z.t <= 0 && z.onEnd) z.onEnd();
      if (z.kind === 'tline' && z.t <= 0 && z.onEnd) z.onEnd();
    }
    this.zones = this.zones.filter((z) => z.t > 0);
  }

  inSmoke(x, y) {
    for (const z of this.zones) if (z.kind === 'smoke' && (x - z.x) ** 2 + (y - z.y) ** 2 < z.r * z.r) return true;
    return false;
  }

  applyStatus(u, oh) {
    if (!oh) return;
    const s = u.status;
    if (oh.slow) s.slow = { v: Math.max(oh.slow, s.slow && s.slow.t > 0 ? s.slow.v : 0), t: oh.dur || 1.5 };
    if (oh.freeze) s.freeze = { t: oh.freeze };
    if (oh.poison) s.poison = { dps: Math.max(oh.poison, s.poison && s.poison.t > 0 ? s.poison.dps : 0), t: oh.dur || 3 };
    if (oh.burn) s.burn = { dps: Math.max(oh.burn, s.burn && s.burn.t > 0 ? s.burn.dps : 0), t: oh.dur || 3 };
  }

  // Applique les dégâts sur la durée, renvoie le multiplicateur de vitesse
  tickStatus(u, dt, dmgFn) {
    const s = u.status;
    let speed = 1;
    if (s.freeze) { s.freeze.t -= dt; if (s.freeze.t <= 0) delete s.freeze; else speed = 0; }
    if (s.slow) { s.slow.t -= dt; if (s.slow.t <= 0) delete s.slow; else speed *= 1 - s.slow.v; }
    if (s.poison) { s.poison.t -= dt; dmgFn(s.poison.dps * dt, 'poison'); if (s.poison.t <= 0) delete s.poison; }
    if (s.burn) { s.burn.t -= dt; dmgFn(s.burn.dps * dt, 'burn'); if (s.burn.t <= 0) delete s.burn; }
    return speed;
  }

  damageTower(n) {
    const t = this.run.tower;
    t.hp -= n;
    t.lastHit = this.time;
  }

  edgePoint(angle) {
    // point sur le bord de l'écran (légèrement à l'extérieur) dans une direction donnée
    const cx = WORLD.CX, cy = WORLD.CY;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const tx = dx !== 0 ? (dx > 0 ? (WORLD.W + 30 - cx) / dx : (-30 - cx) / dx) : Infinity;
    const ty = dy !== 0 ? (dy > 0 ? (WORLD.H + 30 - cy) / dy : (-30 - cy) / dy) : Infinity;
    const t = Math.min(tx, ty);
    return { x: cx + dx * t, y: cy + dy * t };
  }

  /* ============================== Réseau ============================== */
  rosterPayload() {
    const out = [];
    for (const h of this.heroes.values()) out.push({ n: h.nid, name: h.name, cls: h.cls, lvl: h.level, look: h.look, equip: h.equip, bot: h.isBot });
    return { v: this.rosterVersion, heroes: out };
  }

  snapshot() {
    const r = this.run;
    const round = (v) => Math.round(v);
    const heroes = [];
    for (const h of this.heroes.values()) {
      let f = 0;
      if (!h.alive) f |= HF.DEAD;
      if (h.alive && this.isInvisible(h)) f |= HF.STEALTH;
      if (h.zombie) f |= HF.ZOMBIE;
      if (h.attackAnim > 0) f |= HF.ATTACK;
      if (h.buffs.fury > 0) f |= HF.FURY;
      if (h.buffs.shield > 0) f |= HF.SHIELD;
      if (h.status.slow || h.status.freeze) f |= HF.SLOW;
      if (h.status.poison) f |= HF.POISON;
      if (h.status.burn) f |= HF.BURN;
      if (h.harvesting) f |= HF.HARVEST;
      if (h.ult >= 1 && CLASSES[h.cls].ult) f |= HF.ULT;
      if (h.retreating) f |= HF.RETREAT;
      if (h.dashing) f |= HF.DASH;
      heroes.push([h.nid, round(h.x), round(h.y), Math.ceil((100 * h.hp) / h.maxHp), f, Math.round(h.facing * 100), h.level]);
    }
    const mobs = this.mobs.map((m) => {
      let f = 0;
      if (m.elite) f |= MF.ELITE;
      if (m.boss) f |= MF.BOSS;
      if (m.attackAnim > 0) f |= MF.ATTACK;
      if (m.status.slow) f |= MF.SLOW;
      if (m.status.freeze) f |= MF.FROZEN;
      if (m.status.poison) f |= MF.POISON;
      if (m.status.burn) f |= MF.BURN;
      if (m.charging) f |= MF.CHARGE;
      return [m.nid, MOB_INDEX[m.type], round(m.x), round(m.y), Math.ceil((100 * m.hp) / m.maxHp), f, Math.round(m.facing * 100)];
    });
    const allies = this.allies.map((a) => [a.nid, MOB_INDEX[a.type], round(a.x), round(a.y), Math.ceil((100 * a.hp) / a.maxHp), (a.attackAnim > 0 ? 4 : 0) | (a.zombieOwner ? 1 : 0), Math.round(a.facing * 100)]);
    const proj = this.projectiles.map((p) => [PROJ_INDEX[p.kind], round(p.x), round(p.y), Math.round(Math.atan2(p.vy, p.vx) * 100)]);
    const zones = this.zones.map((z) => [ZONE_INDEX[z.kind], round(z.x), round(z.y), round(z.r), Math.round(z.t * 10), z.x2 !== undefined ? round(z.x2) : 0, z.y2 !== undefined ? round(z.y2) : 0]);
    const bosses = this.mobs.filter((m) => m.boss).map((m) => [MOB_INDEX[m.type], Math.ceil((1000 * m.hp) / m.maxHp)]);
    const ev = this.events;
    this.events = [];
    this.numBudget = 0;
    return {
      t: Math.round(this.time * 1000), ph: this.phase, ps: this.paused ? 1 : 0, w: r.wave,
      tw: [Math.ceil(r.tower.hp), r.tower.max], tr: r.treasury, up: r.upgrades,
      left: this.mobs.length + r.queue.length + r.bossPending.length,
      timer: Math.ceil(r.timer), seed: r.seed, tv: this.terrainVersion, ter: this.terrain, rv: this.rosterVersion,
      vote: r.vote ? { o: r.vote.options, c: this.voteCounts(), cost: Object.fromEntries(r.vote.options.map((o) => [o, UPGRADES[o] && !UPGRADES[o].challenge ? this.upgradeCost(o) : 0])) } : null,
      pact: r.pactActive ? 1 : r.pactNext ? 2 : 0,
      bosses, h: heroes, m: mobs, a: allies, p: proj, z: zones, e: ev
    };
  }

  broadcastSnapshot() {
    const snap = this.snapshot();
    this.io.to('stream').emit('snap', snap);
    if (this.lastRosterSent !== this.rosterVersion) {
      this.lastRosterSent = this.rosterVersion;
      this.io.to('stream').emit('roster', this.rosterPayload());
    }
  }

  publicRunInfo() {
    const r = this.run;
    return {
      phase: this.phase, paused: this.paused, wave: r.wave, cleared: r.cleared, timer: Math.ceil(r.timer),
      tower: { hp: Math.ceil(r.tower.hp), max: r.tower.max }, treasury: r.treasury, wealthEarned: r.wealthEarned,
      upgrades: r.upgrades, heroes: this.heroes.size, mobs: this.mobs.length + r.queue.length + r.bossPending.length,
      voting: !!r.vote, nextVote: this.nextVoteWave(),
      pact: r.pactActive ? 'active' : r.pactNext ? 'next' : null, era: GD.eraOfWave(Math.max(1, r.wave)).name
    };
  }

  playerState(userId) {
    const h = this.heroes.get(userId);
    const r = this.run;
    const out = { run: this.publicRunInfo(), hero: null, choice: null, vote: null };
    if (r.vote) {
      out.vote = {
        options: r.vote.options.map((o) => ({ id: o, cost: UPGRADES[o] && !UPGRADES[o].challenge ? this.upgradeCost(o) : 0, level: r.upgrades[o] || 0 })),
        counts: this.voteCounts(), mine: r.vote.votes.get(userId) || null, endsAt: r.vote.endsAt
      };
    }
    if (h) {
      out.hero = {
        alive: h.alive, hp: Math.ceil(h.hp), maxHp: h.maxHp, ult: Math.min(1, h.ult), hasUlt: !!CLASSES[h.cls].ult,
        respawn: Math.ceil(h.respawnT), zombie: h.zombie, kills: h.runKills, xp: h.runXp, gold: h.runGold,
        buffs: Object.fromEntries(Object.entries(h.buffs).filter(([, v]) => v > 0).map(([k, v]) => [k, Math.ceil(v)])),
        status: Object.keys(h.status), dmg: Math.round(h.dmg), armor: Math.round(h.armor * 100), challenge: h.waveMult > 1
      };
      if (h.choice) out.choice = { id: h.choice.id, options: h.choice.options, expires: h.choice.expires };
    }
    return out;
  }

  broadcastPlayers() {
    for (const s of this.io.sockets.sockets.values()) {
      const u = s.data.userId && this.db.userById(s.data.userId);
      if (!u) continue;
      s.emit('state', this.playerState(u.id));
    }
  }
}

Object.assign(Game.prototype, require('./heroes'), require('./mobs'));
module.exports = Game;
