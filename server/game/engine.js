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

const { WORLD, CLASSES, MOBS, MOB_IDS, UPGRADES, PROGRESSION, BOSS_WAVES } = GD;
const MOB_INDEX = Object.fromEntries(MOB_IDS.map((id, i) => [id, i]));
const { PROJ_KINDS, ZONE_KINDS, HF, MF } = GD.NET;
const PROJ_INDEX = Object.fromEntries(PROJ_KINDS.map((k, i) => [k, i]));
const ZONE_INDEX = Object.fromEntries(ZONE_KINDS.map((k, i) => [k, i]));
const HAZARD_KINDS = ['ice', 'toxic', 'lava'];
const BUILDING_INDEX = Object.fromEntries(GD.BUILDINGS.map((b, i) => [b.family, i]));


const DEFAULT_SETTINGS = {
  voteEvery: 2, // vote des viewers toutes les N manches
  difficulty: 1, // multiplicateur global
  intermission: 4, // secondes d'entracte entre deux manches (les votes ont lieu pendant les manches)
  autoNext: true, // enchaîne les manches automatiquement
  autoRestart: false, // relance une partie après une défaite
  joinWindow: 180, // secondes pendant lesquelles on peut rejoindre après le lancement (0 = toute la partie)
  prepTime: 15, // secondes de préparation avant la 1re manche
  maxHeroes: 200,
  maxAliveMobs: 260
};


class Game {
  constructor(db, io) {
    this.db = db;
    this.io = io;
    const saved = { ...(db.data.settings.game || {}) };
    if (!saved.timingV2) { if (saved.prepTime === 30) delete saved.prepTime; saved.timingV2 = true; }
    if (!saved.timingV3) { delete saved.intermission; delete saved.pause; saved.timingV3 = true; } // entracte unique (votes pendant les manches)
    this.settings = { ...DEFAULT_SETTINGS, ...saved };
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
    this.speed = 1; // accélération du temps (tests admin : x1, x2, x3)
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
      tower: { hp: GD.BALANCE.TOWER_BASE_HP, max: GD.BALANCE.TOWER_BASE_HP, ballistaT: 0, catapultT: 0 },
      // habitations : une par héros, du type de sa classe (refuge et soin entre les manches)
      buildings: [],
      treasury: 0,
      wealthEarned: 0,
      upgrades: Object.fromEntries(Object.keys(UPGRADES).map((k) => [k, 0])),
      pactNext: false,
      pactActive: false,
      queue: [],
      spawnT: 0,
      bossPending: [],
      waveTime: 0,
      timer: 0, // compte à rebours de l'entracte
      vote: null,
      joinUntil: 0,
      startedAt: Date.now(),
      mode: this.nextMode || 'classic', // classic | quick
      difficulty: this.nextDifficulty || 'normal' // facile | normal | difficile
    };
    this.nodes = Terrain.resourceNodes(this.run.seed);
    this.mobs = []; this.allies = []; this.projectiles = []; this.zones = [];
    for (const h of this.heroes.values()) this.resetHeroForRun(h);
    this.terrainChanged();
  }

  terrainChanged() {
    this.terrain = this.run.mode === 'quick' ? Terrain.terrainStateQuick(this.run.cleared, this.run.uprooted) : Terrain.terrainState(this.run.cleared, this.run.uprooted);
    this.terrainVersion = (this.terrainVersion || 0) + 1;
  }

  saveSettings() {
    this.db.data.settings.game = this.settings;
    this.db.markDirty();
  }

  // Seuls les héros présents au lancement (ou arrivés pendant la fenêtre d'inscription) participent
  removePlayerHeroes() {
    for (const h of [...this.heroes.values()]) if (!h.isBot) { this.heroes.delete(h.id); this.allies = this.allies.filter((a) => a.ownerId !== h.id); }
    this.rosterVersion++;
  }

  canJoin() {
    return (this.phase === 'intermission' || this.phase === 'wave') && Date.now() < this.run.joinUntil;
  }

  openJoin(seconds) {
    const s = Number(seconds);
    this.run.joinUntil = s > 0 ? Date.now() + s * 1000 : Infinity;
    this.announce('Inscriptions ouvertes !', s > 0 ? `Tape !join dans le chat (${Math.round(s)} s)` : 'Tape !join dans le chat');
  }

  closeJoin() { this.run.joinUntil = 0; this.pushFeed('Les inscriptions à la bataille sont fermées.'); }

  maxWave() { return (GD.MODES[this.run.mode] || GD.MODES.classic).waves; }
  // Contenu (monstres, boss, terrain) : manche équivalente du classique
  eqWave(w) { return GD.equivalentWave(this.run.mode, w); }
  // Puissance (PV, dégâts, nombre, récompenses) : suit le nombre réel de manches jouées
  powerWave(w) { return Math.max(1, Math.round(w * ((GD.MODES[this.run.mode] || GD.MODES.classic).powerScale || 1))); }

  /*
   * Partie rapide : un boss prévu pour une manche classique avancée arrive plus tôt.
   * On ramène ses PV et dégâts de base à ceux du boss classique correspondant à la puissance de la manche.
   */
  bossFactor(type) {
    if (this.run.mode !== 'quick') return { hp: 1, dmg: 1 };
    const pw = this.powerWave(this.run.wave);
    const d0 = MOBS[type];
    if (!d0.boss) {
      // monstres d'une ère plus avancée que la puissance de la manche : un peu affaiblis (×0,75 par ère d'écart)
      // monstres « en avance » sur la puissance de la manche (ère plus avancée, ou apparition prévue plus tard) : affaiblis
      const powerEra = Math.min(3, Math.ceil(pw / 30));
      let k = Math.pow(0.75, Math.max(0, (d0.era || 1) - powerEra));
      if ((d0.era || 1) === powerEra && d0.from > pw) k *= Math.max(0.45, 1 - (d0.from - pw) * 0.05);
      return { hp: k, dmg: k };
    }
    const refWave = Math.min(100, Math.max(5, Math.floor(pw / 5) * 5));
    const ref = MOBS[(BOSS_WAVES[refWave] || ['sanglier_geant'])[0]], d = MOBS[type];
    // plusieurs boss en même temps (finale) : chacun est un peu moins résistant
    const together = (BOSS_WAVES[this.eqWave(this.run.wave)] || [type]).length;
    return { hp: Math.min(1, ref.hp / d.hp) / Math.sqrt(together), dmg: Math.min(1, ref.dmg / d.dmg) };
  }
  modeInfo() {
    const M = GD.MODES[this.run.mode] || GD.MODES.classic, D = GD.DIFFICULTIES[this.run.difficulty] || GD.DIFFICULTIES.normal;
    return { mode: this.run.mode, modeName: M.name, difficulty: this.run.difficulty, difficultyName: D.name, maxWave: M.waves };
  }

  // opts : { mode: 'classic' | 'quick', difficulty: 'facile' | 'normal' | 'difficile' }
  startRun(fromWave = 1, opts = {}) {
    if (opts.mode && GD.MODES[opts.mode]) this.nextMode = opts.mode;
    if (opts.difficulty && GD.DIFFICULTIES[opts.difficulty]) this.nextDifficulty = opts.difficulty;
    this.removePlayerHeroes();
    this.resetRun();
    this.run.cleared = Math.max(0, Math.min(this.maxWave() - 1, (fromWave | 0) - 1));
    this.run.wave = this.run.cleared;
    // si on démarre plus loin (test), on donne quelques écus et d'améliorations cohérentes
    if (this.run.cleared > 0) this.run.treasury = this.run.wealthEarned = this.run.cleared * 25;
    this.terrainChanged();
    this.phase = 'intermission';
    this.run.timer = Math.max(5, this.settings.prepTime);
    this.paused = false;
    this.openJoin(this.settings.joinWindow);
    this.announce('La bataille va commencer !', 'Rejoins la défense : tape !join dans le chat');
  }

  stopRun() {
    this.finishRun(false, true);
    this.removePlayerHeroes();
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
    // récapitulatif des récompenses de chaque héros (affiché sur le stream et la page joueur)
    const results = [];
    for (const h of this.heroes.values()) {
      const pay = this.payout(h) || { xp: h.runXp, gold: h.runGold, glacons: h.runGlacons || 0, levels: 0 };
      results.push({ id: h.id, name: h.name, cls: h.cls, bot: !!h.isBot, kills: h.runKills || 0, ...pay });
      if (!h.isBot && this.onRunEnd) this.onRunEnd(h.userId, { won, wave: this.run.wave, kills: h.runKills || 0, ...pay });
    }
    results.sort((a, b) => b.kills - a.kills);
    this.run.results = results;
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
    n = U.clamp(n | 0, 1, this.maxWave());
    this.mobs = []; this.projectiles = []; this.zones = [];
    this.run.queue = []; this.run.bossPending = [];
    this.run.cleared = n - 1;
    this.run.wave = n - 1;
    this.run.uprooted = this.eqWave(n) > 30;
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

  // Renvoie le héros, ou { error } si impossible
  joinUser(user) {
    if (this.heroes.has(user.id)) return this.heroes.get(user.id);
    if (this.phase === 'lobby' || this.phase === 'gameover' || this.phase === 'victory') return { error: 'Aucune bataille en cours : attends que l’admin en lance une.' };
    if (!this.canJoin()) return { error: 'Les inscriptions pour cette bataille sont fermées.' };
    if (this.heroes.size >= this.settings.maxHeroes) return { error: 'La bataille est complète.' };
    const h = this.makeHero({ id: user.id, userId: user.id, name: user.pseudo, isBot: false });
    this.lockProfile(h, user);
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
    const cls = CLASSES[opts.cls] ? opts.cls : U.pick(all);
    const lvl = opts.level ? U.clamp(opts.level | 0, 1, PROGRESSION.MAX_LEVEL) : (CLASSES[cls].tier === 2 ? 8 + ((Math.random() * 12) | 0) : CLASSES[cls].tier === 1 ? 3 + ((Math.random() * 5) | 0) : 1 + ((Math.random() * 3) | 0));
    // équipement : pièces utilisables par la classe, rareté plus haute avec le niveau
    const gear = {};
    for (const slot of GD.SLOTS) {
      const opt = Object.keys(GD.TEMPLATES).filter((k) => GD.TEMPLATES[k].slot === slot && GD.canUse(k, cls));
      if (!opt.length || Math.random() < 0.15) continue;
      let r = GD.rollRarity();
      for (let i = 0; i < Math.floor(lvl / 15); i++) r = Math.max(r, GD.rollRarity());
      gear[slot] = { t: U.pick(opt), r };
    }
    const id = 'bot_' + this.nid;
    const h = this.makeHero({ id, userId: null, name: opts.name || `Bot${this.nid}`, isBot: true });
    h.bot = {
      cls, level: lvl,
      look: GD.randomLook(),
      gear,
      skills: (() => {
        // bots : initiation, puis la branche de leur spécialisation (ultime compris)
        const sk = {};
        const c = CLASSES[cls];
        let pts = Math.floor(lvl / PROGRESSION.SKILL_EVERY);
        const base = c.tier === 0 ? null : c.tier === 1 ? cls : c.parent;
        if (base && pts > 0) { sk[`init_${base}`] = Math.min(GD.SKILL_MAX_RANK, pts); pts -= sk[`init_${base}`]; }
        if (c.tier !== 2) return sk;
        for (const id of [1, 2, 3, 4, 5, 'ult'].map((i) => `${cls}_${i}`)) { sk[id] = 1; pts--; }
        for (let i = 0; i < 30 && pts > 0; i++) { const id = `${cls}_${1 + (i % 5)}`; if (sk[id] < GD.SKILL_MAX_RANK) { sk[id]++; pts--; } }
        return sk;
      })(),
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
    this.payout(h);
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
      buffs: {}, status: {}, timers: { stealth: 0, dash: 3, heal: 2, harvest: 0, summon: 0, aura: 0, quake: 3, hawk: 1, trap: 2, storm: 0 },
      zombie: false, deathX: 0, deathY: 0, attackAnim: 0, retreating: false, harvesting: false,
      runKills: 0, runGold: 0, runXp: 0, idleAngle: a, dashing: null, chain: null
    };
  }

  resetHeroForRun(h) {
    h.alive = true; h.zombie = false; h.buffs = {}; h.status = {}; h.ult = 0; h.dashing = null; h.chain = null;
    h.runKills = 0; h.runGold = 0; h.runXp = 0; h.runGlacons = 0; h.paid = false;
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

  // Profil utilisé pour les statistiques : figé au moment où le joueur rejoint la bataille
  statsProfile(h) {
    if (h.isBot) return h.bot;
    return h.lock || this.db.userById(h.userId);
  }

  lockProfile(h, u) {
    const clone = (o) => JSON.parse(JSON.stringify(o || {}));
    h.lock = { cls: u.cls, level: u.level, attrs: clone(u.attrs), skills: clone(u.skills), house: clone(GD.houseOf(u)), gear: this.db.gearOf(u) };
  }

  // Recalcule les statistiques à partir du profil (classe, niveau, armures, améliorations)
  refreshHero(h) {
    const p = this.statsProfile(h);
    const live = this.heroProfile(h);
    if (!p || !live) return;
    const prevCls = h.cls;
    // apparence et comportement (IA) restent modifiables ; classe, niveau, stats, équipement et habitation sont figés
    h.cls = p.cls; h.level = p.level; h.look = live.look; h.ai = live.ai;
    h.gear = GD.gearFor(p.cls, h.isBot ? p.gear : h.lock ? h.lock.gear : this.db.gearOf(p));
    h.attrs = p.attrs;
    const c = CLASSES[h.cls] || CLASSES.habitant;
    const ratio = h.maxHp > 1 ? h.hp / h.maxHp : 1;
    const st = GD.computeStats({ cls: h.cls, level: h.level, gear: h.gear, skills: p.skills, attrs: p.attrs, upgrades: this.run.upgrades });
    Object.assign(h, st);
    h.hp = Math.max(1, Math.min(h.maxHp, Math.round(h.maxHp * ratio)));
    // amélioration spéciale de l'habitation (selon la classe actuelle)
    const fam = GD.familyOf(h.cls), sp = GD.HOUSE_SPECIALS[fam], lvl = GD.houseSpecial(p, fam) * (sp ? sp.per : 0);
    h.xpMult = 1; h.summonMult = 1; h.auraMult = 1;
    if (fam === 'soldat') h.armor = Math.min(0.75, h.armor + lvl);
    else if (fam === 'mage') h.ultRate += lvl;
    else if (fam === 'paysan') h.harvestMult += lvl;
    else if (fam === 'habitant') h.xpMult = 1 + lvl;
    else if (fam === 'eleveur') h.summonMult = 1 + lvl;
    else if (fam === 'menestrel') h.auraMult = 1 + lvl;
    const hb = this.run.buildings.find((b) => b.owners.includes(h.id));
    if (hb && hb.family === fam) this.recomputeBuilding(hb, true);
    if (prevCls && prevCls !== h.cls) {
      this.allies = this.allies.filter((a) => a.ownerId !== h.id);
      h.ult = 0;
      this.fx(['text', h.x, h.y - 46, c.name + ' !', c.color]);
      this.pushFeed(`${h.name} devient ${c.name} !`);
    }
    this.rosterVersion++;
  }

  // Gain d'XP et de Grêlons (monnaie personnelle persistante)
  reward(h, xp, gold) {
    const M = GD.MODES[this.run.mode] || GD.MODES.classic, D = GD.DIFFICULTIES[this.run.difficulty] || GD.DIFFICULTIES.normal;
    const mult = (1 + 0.2 * this.run.upgrades.banner) * (this.run.pactActive ? 2 : 1) * M.rewards * D.rewards;
    xp = Math.round(xp * mult * (h.xpMult || 1)); gold = Math.round(gold * mult);
    // tout est mis de côté et versé à la fin de la partie (payout)
    h.runXp += xp; h.runGold += gold;
    this.savePending(h);
  }

  // Les récompenses en attente sont aussi enregistrées dans le profil : un redémarrage du serveur ne les perd pas
  savePending(h) {
    if (h.isBot || h.paid) return;
    const p = this.db.userById(h.userId);
    if (!p) return;
    p.pending = { xp: h.runXp, gold: h.runGold, glacons: h.runGlacons || 0, run: this.run.id };
    this.db.markDirty();
  }

  // Verse des récompenses restées en attente (partie interrompue par un redémarrage)
  settlePending(p) {
    const r = p.pending;
    delete p.pending;
    if (!r) return;
    p.gold += r.gold || 0;
    p.glacons = (p.glacons || 0) + (r.glacons || 0);
    this.grantXp(p, r.xp || 0);
    this.db.markDirty();
  }

  // Versement des récompenses de la partie (fin de partie, ou départ du héros)
  payout(h) {
    if (h.isBot || h.paid) return;
    h.paid = true;
    const p = this.db.userById(h.userId);
    if (!p) return;
    delete p.pending;
    p.gold += h.runGold;
    p.glacons = (p.glacons || 0) + (h.runGlacons || 0);
    const levels = this.grantXp(p, h.runXp);
    this.db.markDirty();
    const res = { xp: h.runXp, gold: h.runGold, glacons: (h.runGlacons || 0) + levels * PROGRESSION.GLACONS_PER_LEVEL, levels };
    if (this.onPayout) this.onPayout(p, res);
    return res;
  }

  // Ajoute de l'XP à un profil joueur (montées de niveau + points de stat). Utilisé aussi par l'admin.
  grantXp(p, xp) {
    p.xp += Math.max(0, Math.round(xp));
    const before = p.level;
    while (p.level < PROGRESSION.MAX_LEVEL && p.xp >= PROGRESSION.xpForLevel(p.level)) {
      p.xp -= PROGRESSION.xpForLevel(p.level);
      p.level++;
    }
    if (p.level >= PROGRESSION.MAX_LEVEL) p.xp = 0;
    this.db.syncAttrPoints(p);
    if (p.level > before) p.glacons = (p.glacons || 0) + (p.level - before) * PROGRESSION.GLACONS_PER_LEVEL;
    this.db.markDirty();
    const gained = p.level - before;
    const h = this.heroes.get(p.id);
    if (gained > 0 && h) {
      this.refreshHero(h);
      this.fx(['lvl', h.x, h.y, p.level]);
      this.fx(['text', h.x, h.y - 70, `+${gained} point${gained > 1 ? 's' : ''} de stat · +${gained * PROGRESSION.GLACONS_PER_LEVEL} 🧊`, GD.PALETTE.fx.xp]);
      if (before < PROGRESSION.CLASS_LEVEL && p.level >= PROGRESSION.CLASS_LEVEL) this.pushFeed(`${h.name} peut choisir sa classe !`);
    }
    return gained;
  }

  /* ============================== Manches ============================== */
  aliveHeroes() {
    const out = [];
    for (const h of this.heroes.values()) if (h.alive) out.push(h);
    return out;
  }

  startWave(n) {
    const r = this.run;
    // le vote de la manche précédente (resté ouvert pendant l'entracte) s'applique au début de cette manche
    const voted = this.closeVote();
    r.wave = n;
    r.pactActive = r.pactNext;
    r.pactNext = false;
    r.waveTime = 0;
    this.phase = 'wave';
    // Les viewers votent pendant la manche et l'entracte (toutes les « voteEvery » manches) ; le résultat s'applique au début de la manche suivante
    if (this.isVoteWave(n)) this.openVote();
    this.buildWave(n);
    this.spawnHazards(n);
    const eq = this.eqWave(n);
    const era = GD.eraFor(r.mode, n), prevEra = GD.eraFor(r.mode, n - 1);
    const boss = BOSS_WAVES[eq];
    if (eq === 100) this.announce(`MANCHE ${n}`, 'Les trois fléaux se lèvent ensemble…');
    else if (eq === 30) this.announce(`MANCHE ${n}`, 'Les arbres se déracinent !');
    else if (boss) this.announce(`MANCHE ${n}`, 'Un boss approche…');
    else if (n === 1 || era !== prevEra) this.announce(`MANCHE ${n}`, era.name);
    else this.announce(`MANCHE ${n}`, r.pactActive ? 'Pacte de sang : ennemis renforcés !' : voted || '');
    if (voted) this.pushFeed(voted);
    if (era !== prevEra && era.id === 'poison') this.pushFeed('La corruption s’étend : attention au poison !');
    if (era !== prevEra && era.id === 'fire') this.pushFeed('La terre s’embrase…');
  }

  waveCleared() {
    const r = this.run;
    this.zones = this.zones.filter((z) => !HAZARD_KINDS.includes(z.kind));
    r.cleared = Math.max(r.cleared, r.wave);
    const bossCount = (BOSS_WAVES[this.eqWave(r.wave)] || []).length;
    const wasBoss = bossCount > 0;
    if (wasBoss || r.mode === 'quick') this.terrainChanged(); // partie rapide : corruption à chaque manche
    // récompenses de fin de manche
    for (const h of this.heroes.values()) {
      const B = GD.BALANCE;
      const pw = this.powerWave(r.wave);
      this.reward(h, B.WAVE_XP_BASE + pw * B.WAVE_XP_PER_WAVE, B.WAVE_GRELONS_BASE + Math.ceil(pw * B.WAVE_GRELONS_PER_WAVE));
      // un glaçon (coffre) par boss vaincu
      if (bossCount) {
        const n = bossCount * GD.GLACONS.PER_BOSS;
        h.runGlacons = (h.runGlacons || 0) + n;
        this.savePending(h);
        this.fx(['text', Math.round(h.x), Math.round(h.y) - 80, `+${n} 🧊`, '#bfe6ff']);
      }
      if (h.zombie) { h.zombie = false; this.rosterVersion++; }
      const u = h.userId && this.db.userById(h.userId);
      if (u) u.stats.bestWave = Math.max(u.stats.bestWave, r.cleared);
    }
    // Infirmerie : réanime des héros morts au hasard à chaque fin de manche (1 au niveau requis, 2 au niveau supérieur)
    const inf = r.upgrades.infirmary, B = GD.BALANCE;
    const revives = inf >= B.INFIRMARY_REVIVE2_LEVEL ? 2 : inf >= B.INFIRMARY_REVIVE_LEVEL ? 1 : 0;
    const dead = U.shuffle([...this.heroes.values()].filter((h) => !h.alive)).slice(0, revives);
    for (const h of dead) { this.reviveHero(h); this.pushFeed(`⛑️ L’infirmerie réanime ${h.name} !`); }
    const bonus = Math.round((GD.BALANCE.WAVE_ECUS_BASE + this.powerWave(r.wave) * GD.BALANCE.WAVE_ECUS_PER_WAVE) * (r.pactActive ? 2 : 1));
    this.addTreasury(bonus);
    r.pactActive = false;
    if (r.wave >= this.maxWave()) { this.closeVote(true); return this.victory(); }
    // le vote reste ouvert pendant l'entracte : il est appliqué au début de la manche suivante
    this.phase = 'intermission';
    r.timer = this.settings.intermission;
    this.announce(`Manche ${r.wave} terminée !`, wasBoss ? 'Le terrain se transforme…' : `+${bonus} écus`);
  }

  // partie rapide : vote à chaque manche ; classique : réglage de l'admin
  voteEvery() { return Math.max(1, Math.round((GD.MODES[this.run.mode] || {}).voteEvery || this.settings.voteEvery || 2)); }

  isVoteWave(w) {
    const n = this.voteEvery();
    return w > 0 && w % n === 0;
  }

  nextVoteWave() {
    const n = this.voteEvery();
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
      return !u.challenge && !u.revive && id !== 'walls' && r.upgrades[id] < u.max && r.wealthEarned >= u.unlock;
    });
    // priorité aux améliorations abordables, puis les autres pour faire rêver
    const affordable = U.shuffle(avail.filter((id) => this.upgradeCost(id) <= r.treasury));
    const others = U.shuffle(avail.filter((id) => this.upgradeCost(id) > r.treasury));
    const opts = [...affordable, ...others].slice(0, 3);
    // les PV de la tour peuvent toujours être améliorés par vote
    if (r.upgrades.walls < UPGRADES.walls.max) opts.unshift('walls');
    // un héros est mort : l'équipe peut voter sa résurrection
    if ([...this.heroes.values()].some((h) => !h.alive)) opts.push('revive');
    opts.push('pact', 'save');
    r.vote = { options: opts, votes: new Map(), endsAt: null }; // se termine avec la manche
  }

  // fromChat : vote d'un spectateur du chat Twitch (sans héros)
  castVote(userId, opt, fromChat) {
    const v = this.run.vote;
    if (!v || (this.phase !== 'wave' && this.phase !== 'intermission') || !v.options.includes(opt)) return false;
    if (!fromChat && !this.heroes.has(userId)) return false;
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
    const u = UPGRADES[best];
    return best === 'save' ? 'Vote : l’équipe garde ses écus' : `Vote : ${u ? u.icon + ' ' + u.name : best}`;
  }

  reviveHero(h) {
    h.alive = true; h.zombie = false; h.status = {};
    h.hp = Math.round(h.maxHp * GD.BALANCE.REVIVE_HP);
    const a = Math.random() * Math.PI * 2;
    h.x = WORLD.CX + Math.cos(a) * 90; h.y = WORLD.CY + 70 + Math.sin(a) * 30;
    this.fx(['revive', Math.round(h.x), Math.round(h.y)]);
  }

  applyUpgrade(id) {
    const r = this.run;
    if (id === 'save') { this.pushFeed('L’équipe garde ses écus.'); return; }
    if (id === 'pact') {
      r.pactNext = true;
      this.pushFeed('💀 Pacte de sang accepté : la prochaine manche sera brutale !');
      return;
    }
    const cost = this.upgradeCost(id);
    if (cost > r.treasury) return;
    if (id === 'revive') {
      const dead = [...this.heroes.values()].filter((h) => !h.alive);
      if (!dead.length) return;
      r.treasury -= cost;
      r.upgrades.revive++;
      const h = U.pick(dead);
      this.reviveHero(h);
      this.pushFeed(`💖 L’équipe réanime ${h.name} !`);
      return;
    }
    r.treasury -= cost;
    r.upgrades[id]++;
    const u = UPGRADES[id];
    this.pushFeed(`${u.icon} ${u.name} niveau ${r.upgrades[id]} !`);
    if (id === 'walls') {
      const add = Math.max(1, Math.round(r.tower.max * GD.BALANCE.TOWER_WALLS_PCT));
      r.tower.max += add; r.tower.hp = Math.min(r.tower.max, r.tower.hp + add);
    }
    for (const h of this.heroes.values()) this.refreshHero(h);
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
      acc += el * (this.speed || 1); // x2 / x3 : plusieurs pas de simulation par intervalle
      // une erreur dans la simulation est journalisée sans faire tomber le serveur
      while (acc >= dt) {
        acc -= dt;
        try { this.tick(dt); } catch (e) {
          const now = Date.now();
          if (!this.lastErr || now - this.lastErr > 10000) { this.lastErr = now; console.error('Erreur de simulation :', e); }
        }
      }
      snapAcc += el; playerAcc += el;
      try {
        if (snapAcc >= 1 / config.SNAPSHOT_RATE) { snapAcc = 0; this.broadcastSnapshot(); }
        if (playerAcc >= 1 / config.PLAYER_RATE) { playerAcc = 0; this.broadcastPlayers(); }
      } catch (e) { console.error('Erreur d’envoi :', e.message); }
    }, 1000 / config.TICK_RATE);
  }

  tick(dt) {
    if (this.paused) return;
    this.time += dt;
    const r = this.run;
    // temps de jeu de la partie en cours (hors pause, s'arrête à la fin de la partie)
    if (this.phase === 'wave' || this.phase === 'intermission') r.playTime = (r.playTime || 0) + dt;
    this.updateBuildingPresence();
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
        this.updateBuildingSpecials(dt);
        this.updateProjectiles(dt);
        this.updateZones(dt);
        this.mobs = this.mobs.filter((m) => m.hp > 0);
        if (r.tower.hp <= 0) { r.tower.hp = 0; this.gameOver(); break; }
        if (!r.queue.length && !r.bossPending.length && !this.mobs.length) this.waveCleared();
        break;
      case 'gameover':
      case 'victory':
        r.timer -= dt;
        this.updateZones(dt);
        if (r.timer <= 0) {
          if (this.settings.autoRestart) this.startRun(1);
          else { this.phase = 'lobby'; this.removePlayerHeroes(); this.resetRun(); }
        }
        break;
    }
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
      tx: o.tx, ty: o.ty, radius: o.radius || 14, extra: o.extra || null
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
          this.damageMob(m, p.dmg, p.owner, { crit: p.crit, onHit: p.onHit, kind: p.kind, extra: p.extra });
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
        if (!done) for (const b of this.run.buildings) {
          if (b.hp <= 0 || (b.x - p.x) ** 2 + (b.y - p.y) ** 2 > b.size ** 2) continue;
          this.damageBuilding(b, p.dmg); done = true; break;
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
      if (HAZARD_KINDS.includes(z.kind)) this.hazardTick(z, dt);
      if (z.owner && z.t > 0) this.heroZoneTick(z, dt);
      if (z.kind === 'telegraph' && z.t <= 0 && z.onEnd) z.onEnd();
      if (z.kind === 'tline' && z.t <= 0 && z.onEnd) z.onEnd();
    }
    this.zones = this.zones.filter((z) => z.t > 0);
  }

  /*
   * Zones dangereuses du biome : apparaissent au hasard sur les tuiles du biome correspondant
   * (glace = ralentit, poison et lave = perte de PV périodique), sans se chevaucher.
   */
  spawnHazards(w) {
    this.zones = this.zones.filter((z) => !HAZARD_KINDS.includes(z.kind));
    const B = GD.BALANCE;
    const want = Math.min(B.HAZARD_MAX, (GD.MODES[this.run.mode] || GD.MODES.classic).hazardMax, Math.floor(B.HAZARD_BASE + this.eqWave(w) * B.HAZARD_PER_WAVE));
    const KIND = { frost: 'ice', poison: 'toxic', fire: 'lava' };
    const placed = [];
    const avoid = [{ x: WORLD.CX, y: WORLD.CY, r: 190 }, ...this.run.buildings.map((b) => ({ x: b.x, y: b.y, r: 60 }))];
    for (let tries = 0; tries < 400 && placed.length < want; tries++) {
      const r = U.rand(55, 105);
      const x = U.rand(70 + r, WORLD.W - 70 - r), y = U.rand(60 + r, WORLD.H - 60 - r);
      const biome = Terrain.tileBiome(Math.floor(x / WORLD.TILE), Math.floor(y / WORLD.TILE), this.terrain, this.run.seed);
      const kind = KIND[biome];
      if (!kind) continue;
      if ([...avoid, ...placed].some((o) => (o.x - x) ** 2 + (o.y - y) ** 2 < (o.r + r + 20) ** 2)) continue;
      placed.push({ kind, x, y, r, t: 999, tick: kind === 'toxic' ? B.HAZARD_POISON_EVERY : B.HAZARD_LAVA_EVERY });
    }
    this.zones.push(...placed);
  }

  hazardTick(z, dt) {
    const B = GD.BALANCE;
    z.t = 999;
    const inside = [];
    for (const h of this.heroes.values()) if (h.alive && (h.x - z.x) ** 2 + ((h.y - z.y) / 0.6) ** 2 < z.r * z.r) inside.push(h);
    if (z.kind === 'ice') { for (const h of inside) this.applyStatus(h, { slow: B.HAZARD_ICE_SLOW, dur: 0.3 }); return; }
    z.tick -= dt;
    if (z.tick > 0) return;
    const lava = z.kind === 'lava';
    z.tick = lava ? B.HAZARD_LAVA_EVERY : B.HAZARD_POISON_EVERY;
    for (const h of inside) {
      const n = h.maxHp * (lava ? B.HAZARD_LAVA_PCT : B.HAZARD_POISON_PCT);
      this.damageHero(h, n, null, true);
      this.fx(['num', Math.round(h.x), Math.round(h.y - 30), Math.max(1, Math.round(n)), lava ? 3 : 4]);
    }
  }

  // Zones posées par les héros (trappeur, alchimiste)
  heroZoneTick(z, dt) {
    const o = z.owner;
    if (z.kind === 'trap') {
      // piège à mâchoires : se referme sur le premier monstre qui passe
      const m = this.mobsInRadius(z.x, z.y, z.r)[0];
      if (!m) return;
      const T = CLASSES[o.cls].traps || { root: 2, mult: 3 };
      const root = T.root + ((o.mods && o.mods.trapRoot) || 0);
      this.damageMob(m, o.dmg * T.mult * this.dmgMul(o), o, { onHit: m.boss ? { slow: 0.6, dur: root } : { freeze: root } });
      this.fx(['snap', Math.round(z.x), Math.round(z.y)]);
      z.t = 0;
      return;
    }
    z.tick = (z.tick || 0) - dt;
    if (z.tick > 0) return;
    if (z.kind === 'thorns') {
      z.tick = 0.5;
      for (const m of this.mobsInRadius(z.x, z.y, z.r)) {
        this.applyStatus(m, { slow: 0.6, dur: 0.7 });
        this.damageMob(m, o.dmg * 0.4, o, { dot: true });
      }
    } else if (z.kind === 'acid') {
      z.tick = 1;
      for (const m of this.mobsInRadius(z.x, z.y, z.r)) { this.addVenom(m, o, 3); m.status.acid = { t: 1.5, v: 0.3 }; }
    }
  }

  // Ajoute des doses de venin (alchimiste)
  addVenom(m, h, n) {
    const c = CLASSES[h.cls].venom;
    if (!c || m.hp <= 0) return;
    const mods = h.mods || {};
    const prev = m.status.venom && m.status.venom.t > 0 ? m.status.venom.n : 0;
    m.status.venom = { n: Math.min(c.max + (mods.venomMax || 0), prev + n), dps: h.dmg * c.pct * (1 + (mods.venomMul || 0)), t: c.dur, boss: c.boss };
    m.lastHitBy = h;
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
    // venin de l'alchimiste : doses cumulées, renforcé contre les boss
    if (s.venom) { s.venom.t -= dt; dmgFn(s.venom.n * s.venom.dps * (u.boss ? s.venom.boss : 1) * dt, 'poison'); if (s.venom.t <= 0) delete s.venom; }
    for (const k of ['mark', 'acid', 'blind', 'charm']) if (s[k]) { s[k].t -= dt; if (s[k].t <= 0) delete s[k]; }
    return speed;
  }

  buildingOfHero(h) { return this.run.buildings.find((b) => b.owners.includes(h.id)) || null; }

  /*
   * Habitations : une par héros, du type de sa classe, au maximum BUILDINGS_PER_CLASS par classe.
   * Au-delà, le joueur partage l'habitation la moins occupée de sa classe : leurs PV fusionnent
   * (chaque occupant apporte BUILDING_HP). Elles sont placées au hasard (classes mélangées).
   */
  updateBuildingPresence() {
    const r = this.run, B = GD.BALANCE;
    let changed = false;
    // départs (ou changements de classe) : l'habitation perd la part de PV de l'occupant
    for (const b of r.buildings) {
      const before = b.owners.length;
      b.owners = b.owners.filter((id) => { const h = this.heroes.get(id); return h && GD.familyOf(h.cls) === b.family; });
      if (b.owners.length !== before) { changed = true; if (b.owners.length) this.recomputeBuilding(b, false); }
    }
    if (changed) r.buildings = r.buildings.filter((b) => b.owners.length);
    // une place s'est libérée dans une classe : un occupant d'une habitation partagée récupère la sienne
    for (const family of new Set(r.buildings.map((b) => b.family))) {
      const mine = r.buildings.filter((b) => b.family === family);
      const shared = mine.find((b) => b.owners.length > 1);
      if (shared && mine.length < B.BUILDINGS_PER_CLASS) {
        shared.owners.pop();
        this.recomputeBuilding(shared, false);
      }
    }
    const housed = new Set(r.buildings.flatMap((b) => b.owners));
    if (housed.size === this.heroes.size) return;
    for (const h of this.heroes.values()) {
      if (housed.has(h.id)) continue;
      const family = GD.familyOf(h.cls);
      const mine = r.buildings.filter((b) => b.family === family);
      if (mine.length >= B.BUILDINGS_PER_CLASS) {
        // partage : l'habitation la moins occupée de sa classe, ses PV augmentent
        const b = mine.sort((x, y) => x.owners.length - y.owners.length || y.hp / y.max - x.hp / x.max)[0];
        b.owners.push(h.id);
        this.recomputeBuilding(b, true);
        this.fx(['bbuild', Math.round(b.x), Math.round(b.y)]);
        continue;
      }
      const def = GD.BUILDINGS.find((x) => x.family === family) || GD.BUILDINGS[1];
      const pos = GD.placeBuilding(family, [...r.buildings, ...this.nodes]);
      const variant = GD.BUILDING_VARIANTS[h.cls];
      const b = { id: this.nid++, owners: [h.id], family, variant: variant ? variant.key : null, name: variant ? variant.name : def.name, ...pos, hp: 0, max: 0, size: 28, isBuilding: true, special: 0, fireT: 1, trapT: 0 };
      this.recomputeBuilding(b, true);
      r.buildings.push(b);
      if (this.phase !== 'lobby') this.fx(['bbuild', Math.round(b.x), Math.round(b.y)]);
    }
  }

  /*
   * PV max = somme des PV de chaque occupant (améliorations « Murs renforcés » comprises).
   * gain = true : les PV ajoutés sont aussi soignés (nouvel occupant, amélioration achetée) ;
   * sinon les PV restent proportionnels (départ d'un occupant). Une habitation détruite le reste.
   */
  recomputeBuilding(b, gain) {
    const profiles = b.owners.map((id) => this.statsProfile(this.heroes.get(id)));
    const newMax = profiles.reduce((a, p) => a + GD.houseHp(p), 0);
    if (gain) { if (b.hp > 0 || b.max === 0) b.hp = Math.min(newMax, b.hp + Math.max(0, newMax - b.max)); }
    else b.hp = b.max > 0 ? (b.hp * newMax) / b.max : newMax;
    b.max = newMax;
    // soin = moyenne des occupants (pas de double soin) ; spéciale = meilleur niveau des occupants
    b.heal = profiles.reduce((a, p) => a + GD.houseHeal(p), 0) / Math.max(1, profiles.length);
    b.special = Math.max(0, ...profiles.map((p) => GD.houseSpecial(p, b.family)));
  }

  // Effets des habitations : la tour de guet tire, le repaire ralentit (selon l'amélioration spéciale)
  updateBuildingSpecials(dt) {
    const S = GD.HOUSE_SPECIALS;
    for (const b of this.run.buildings) {
      if (b.hp <= 0 || !b.special) continue;
      if (b.family === 'archer') {
        b.fireT -= dt;
        if (b.fireT > 0) continue;
        const t = this.nearestMob(b.x, b.y, 340);
        if (!t) continue;
        b.fireT = Math.max(1.2, 2.6 - 0.25 * b.special);
        const owner = this.heroes.get(b.owners[0]);
        this.shoot({ kind: 'arrow', side: 'hero', x: b.x, y: b.y - 40, target: t, dmg: 3 * b.special * (1 + 0.08 * (this.run.wave - 1)), speed: 700, owner });
      } else if (b.family === 'assassin') {
        b.trapT -= dt;
        if (b.trapT > 0) continue;
        b.trapT = 0.5;
        for (const m of this.mobsInRadius(b.x, b.y, 120)) this.applyStatus(m, { slow: S.assassin.per * b.special, dur: 0.8 });
      }
    }
  }

  ownersLabel(b) {
    const names = b.owners.map((id) => (this.heroes.get(id) || {}).name).filter(Boolean);
    return names.length <= 2 ? names.join(' et ') : `${names[0]}, ${names[1]} et ${names.length - 2} autre(s)`;
  }

  damageBuilding(b, n) {
    if (b.hp <= 0) return;
    b.hp -= n;
    if (b.hp <= 0) {
      b.hp = 0;
      this.fx(['bdestroy', Math.round(b.x), Math.round(b.y)]);
      const who = this.ownersLabel(b);
      this.pushFeed(`🔥 ${b.name} de ${who} détruite ! ${b.owners.length > 1 ? 'Ils ne pourront' : 'Il ne pourra'} plus s’y soigner.`);
    }
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
    for (const h of this.heroes.values()) out.push({ n: h.nid, name: h.name, cls: h.cls, lvl: h.level, look: h.look, gear: h.gear, bot: h.isBot });
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
      if (h.buffs.fury > 0 || h.buffs.frenzy > 0) f |= HF.FURY;
      if (h.buffs.song > 0) f |= HF.SONG;
      if (h.buffs.anthem > 0) f |= HF.ANTHEM;
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
      if (m.status.poison || m.status.venom) f |= MF.POISON;
      if (m.status.charm) f |= MF.CHARM;
      if (m.status.mark || m.status.acid) f |= MF.MARK;
      if (m.status.blind) f |= MF.BLIND;
      if (m.status.burn) f |= MF.BURN;
      if (m.charging) f |= MF.CHARGE;
      return [m.nid, MOB_INDEX[m.type], round(m.x), round(m.y), Math.ceil((100 * m.hp) / m.maxHp), f, Math.round(m.facing * 100)];
    });
    const allies = this.allies.map((a) => [a.nid, MOB_INDEX[a.type], round(a.x), round(a.y), Math.ceil((100 * a.hp) / a.maxHp), (a.attackAnim > 0 ? 4 : 0) | (a.zombieOwner ? 1 : 0) | (a.charmed ? 2 : 0), Math.round(a.facing * 100)]);
    const proj = this.projectiles.map((p) => [PROJ_INDEX[p.kind], round(p.x), round(p.y), Math.round(Math.atan2(p.vy, p.vx) * 100)]);
    const zones = this.zones.map((z) => [ZONE_INDEX[z.kind], round(z.x), round(z.y), round(z.r), Math.round(z.t * 10), z.x2 !== undefined ? round(z.x2) : 0, z.y2 !== undefined ? round(z.y2) : 0]);
    const bosses = this.mobs.filter((m) => m.boss).map((m) => [MOB_INDEX[m.type], Math.ceil((1000 * m.hp) / m.maxHp), Math.ceil(m.hp), Math.ceil(m.maxHp)]);
    const ev = this.events;
    this.events = [];
    this.numBudget = 0;
    return {
      t: Math.round(this.time * 1000), ph: this.phase, ps: this.paused ? 1 : 0, sp: this.speed, gt: Math.floor(r.playTime || 0), w: r.wave,
      tw: [Math.ceil(r.tower.hp), r.tower.max], tr: r.treasury, up: r.upgrades,
      left: this.mobs.length + r.queue.length + r.bossPending.length,
      timer: Math.ceil(r.timer), seed: r.seed, tv: this.terrainVersion, ter: this.terrain, rv: this.rosterVersion,
      vote: r.vote ? { o: r.vote.options, c: this.voteCounts(), cost: Object.fromEntries(r.vote.options.map((o) => [o, UPGRADES[o] && !UPGRADES[o].challenge ? this.upgradeCost(o) : 0])) } : null,
      pact: r.pactActive ? 1 : r.pactNext ? 2 : 0,
      // habitations : [index du type, x, y, PV %, nids des occupants]
      era: GD.eraFor(r.mode, Math.max(1, r.wave)).name, mi: this.modeInfo(),
      bd: r.buildings.map((b) => [BUILDING_INDEX[b.family], Math.round(b.x), Math.round(b.y), Math.ceil((100 * b.hp) / b.max), b.owners.map((id) => (this.heroes.get(id) || {}).nid), b.variant || 0]),
      jn: this.canJoin() ? (Number.isFinite(r.joinUntil) ? Math.ceil((r.joinUntil - Date.now()) / 1000) : -1) : 0,
      bosses, h: heroes,
      res: (this.phase === 'gameover' || this.phase === 'victory') && r.results ? r.results.slice(0, 12).map((x) => [x.name, x.cls, x.kills, x.xp, x.gold, x.glacons, x.levels]) : undefined, m: mobs, a: allies, p: proj, z: zones, e: ev
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
      phase: this.phase, paused: this.paused, speed: this.speed, wave: r.wave, cleared: r.cleared, timer: Math.ceil(r.timer),
      tower: { hp: Math.ceil(r.tower.hp), max: r.tower.max }, treasury: r.treasury, wealthEarned: r.wealthEarned,
      upgrades: r.upgrades, heroes: this.heroes.size, mobs: this.mobs.length + r.queue.length + r.bossPending.length,
      canJoin: this.canJoin(), joinEndsAt: Number.isFinite(r.joinUntil) ? r.joinUntil : null,
      voting: !!r.vote, nextVote: this.nextVoteWave(), voteEvery: this.voteEvery(),
      pact: r.pactActive ? 'active' : r.pactNext ? 'next' : null, era: GD.eraFor(r.mode, Math.max(1, r.wave)).name, ...this.modeInfo()
    };
  }

  playerState(userId) {
    const h = this.heroes.get(userId);
    const r = this.run;
    const out = { run: this.publicRunInfo(), hero: null, vote: null };
    const u = this.db.userById(userId);
    if (u) out.profile = { level: u.level, xp: u.xp, xpNext: PROGRESSION.xpForLevel(u.level), attrPoints: u.attrPoints || 0, glacons: u.glacons || 0 };
    if (r.vote) {
      out.vote = {
        options: r.vote.options.map((o) => ({ id: o, cost: UPGRADES[o] && !UPGRADES[o].challenge ? this.upgradeCost(o) : 0, level: r.upgrades[o] || 0 })),
        counts: this.voteCounts(), mine: r.vote.votes.get(userId) || null, endsAt: r.vote.endsAt
      };
    }
    if (h) {
      out.hero = {
        alive: h.alive, hp: Math.ceil(h.hp), maxHp: h.maxHp, ult: Math.min(1, h.ult), hasUlt: !!CLASSES[h.cls].ult,
        zombie: h.zombie, kills: h.runKills, xp: h.runXp, gold: h.runGold,
        buffs: Object.fromEntries(Object.entries(h.buffs).filter(([, v]) => v > 0).map(([k, v]) => [k, Math.ceil(v)])),
        status: Object.keys(h.status), dmg: Math.round(h.dmg), armor: Math.round(h.armor * 100), glacons: h.runGlacons || 0,
        resting: !!h.resting,
        building: (() => { const b = this.buildingOfHero(h); return b ? { name: b.name, hp: Math.ceil(b.hp), max: b.max, shared: b.owners.length } : null; })()
      };
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
