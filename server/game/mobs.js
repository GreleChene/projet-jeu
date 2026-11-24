'use strict';
/*
 * Monstres : composition des vagues, IA, capacités des boss, dégâts et récompenses.
 */
const GD = require('../../shared/constants');
const Terrain = require('../../shared/terrain');
const U = require('./util');
const { WORLD, MOBS, MOB_IDS, BOSS_WAVES, CLASSES } = GD;

module.exports = {
  /* --------------------------- Composition des vagues --------------------------- */
  mobPool(w) {
    const pool = [];
    const add = (era, weightMul) => {
      for (const id of MOB_IDS) {
        const d = MOBS[id];
        if (d.boss || d.ally || d.era !== era || d.from > w || !d.w) continue;
        for (let i = 0; i < Math.round(d.w * weightMul); i++) pool.push(id);
      }
    };
    if (w <= 30) add(1, 1);
    else if (w <= 60) { add(2, 1); add(1, 0.3); }
    else if (w <= 90) { add(3, 1); add(2, 0.3); }
    else { add(1, 1); add(2, 1); add(3, 1); }
    // les ères suivantes n'ont pas encore tous leurs monstres au début : on complète
    if (!pool.length) add(1, 1);
    return pool;
  },

  // w = manche de puissance (voir powerWave)
  scaling(w) {
    const B = GD.BALANCE;
    const D = GD.DIFFICULTIES[this.run.difficulty] || GD.DIFFICULTIES.normal;
    const n = Math.max(1, this.heroes.size);
    const diff = this.settings.difficulty;
    const pact = this.run.pactActive ? 1.5 : 1;
    const curve = 1 + B.WAVE_HP_LINEAR * (w - 1) + B.WAVE_HP_QUAD * (w - 1) ** 2;
    const extra = Math.pow(n - 1, B.HERO_SCALE_EXP); // héros en plus, avec une progression légèrement plus que proportionnelle
    const mods = D.mobHp * diff * pact * (1 + B.HP_PER_HERO * extra);
    return {
      hp: curve * mods,
      // les boss suivent une courbe plus douce (exposant < 1), sinon ils deviennent démesurés en fin de partie
      bossCurveHp: Math.pow(curve, B.BOSS_WAVE_EXP) * mods,
      dmg: (1 + B.WAVE_DMG * (w - 1)) * B.MOB_DMG * D.mobDmg * Math.sqrt(diff) * (1 + B.DMG_PER_HERO * extra),
      bossHp: B.BOSS_HP_BASE + B.BOSS_HP_PER_HERO * (1 + Math.min(extra, 120)),
      count: Math.min(B.MOB_COUNT_HERO_CAP, 1 + B.MOB_COUNT_PER_HERO * extra) * pact * D.mobCount * Math.sqrt(diff)
    };
  },

  buildWave(realWave) {
    const r = this.run;
    const w = this.eqWave(realWave); // contenu : manche équivalente du classique (types de monstres, boss)
    const pw = this.powerWave(realWave); // puissance : selon les manches réellement jouées
    const sc = this.scaling(pw);
    const pool = this.mobPool(w);
    // au-delà de MAX_WAVE_MOBS, on renforce les monstres au lieu d'en ajouter
    const B = GD.BALANCE, MAX_WAVE_MOBS = B.MAX_WAVE_MOBS;
    let total = Math.round((B.MOB_COUNT_BASE + B.MOB_COUNT_PER_WAVE * pw) * sc.count);
    if (total > MAX_WAVE_MOBS) { r.hpBoost = total / MAX_WAVE_MOBS; total = MAX_WAVE_MOBS; } else r.hpBoost = 1;
    const eliteChance = Math.min(B.ELITE_MAX, B.ELITE_BASE + pw * B.ELITE_PER_WAVE);
    r.queue = [];
    for (let i = 0; i < total; i++) r.queue.push({ type: U.pick(pool), elite: Math.random() < eliteChance });
    // les manches durent plus longtemps quand il y a plus de joueurs (et plus de monstres)
    const heroes = Math.max(1, this.heroes.size);
    const duration = Math.min(B.WAVE_DURATION_MAX, B.WAVE_DURATION_BASE + pw * B.WAVE_DURATION_PER_WAVE + Math.pow(Math.max(0, heroes - 1), B.HERO_SCALE_EXP) * B.WAVE_DURATION_PER_HERO);
    r.packInterval = 2.2;
    r.packSize = Math.max(1, Math.ceil(total / (duration / r.packInterval)));
    r.spawnT = 1.5;
    r.waveTotal = total;
    r.bossPending = (BOSS_WAVES[w] || []).slice();

    // Manche 30 : tous les sapins se déracinent !
    if (w === 30 && !r.uprooted) {
      const trees = Terrain.frostTrees(this.terrain, r.seed);
      r.uprooted = true;
      this.terrainChanged();
      const quick = this.run.mode === 'quick';
      const max = Math.min(trees.length, quick ? 4 + this.heroes.size * 2 : 12 + this.heroes.size * 3, 70);
      U.shuffle(trees);
      for (let i = 0; i < trees.length; i++) {
        if (i < max) this.spawnMob('treant', trees[i].x, trees[i].y, {});
        this.fx(['uproot', Math.round(trees[i].x), Math.round(trees[i].y)]);
      }
    }
  },

  updateSpawns(dt) {
    const r = this.run;
    r.spawnT -= dt;
    if (r.queue.length && r.spawnT <= 0 && this.mobs.length < this.settings.maxAliveMobs) {
      r.spawnT = r.packInterval;
      const a = Math.random() * Math.PI * 2;
      const sc = this.scaling(this.powerWave(r.wave));
      for (let i = 0; i < r.packSize && r.queue.length; i++) {
        const q = r.queue.pop();
        const p = this.edgePoint(a + U.rand(-0.15, 0.15));
        this.spawnMob(q.type, p.x + U.rand(-30, 30), p.y + U.rand(-30, 30), { elite: q.elite, sc });
      }
    }
    // Le boss arrive en fin de manche
    if (!r.queue.length && r.bossPending.length && this.mobs.length <= Math.max(3, r.waveTotal * 0.1)) {
      const list = r.bossPending;
      r.bossPending = [];
      const base = Math.random() * Math.PI * 2;
      list.forEach((id, i) => {
        const p = this.edgePoint(base + (i * Math.PI * 2) / list.length);
        this.spawnMob(id, p.x, p.y, {});
        this.fx(['bossin', MOB_IDS.indexOf(id)]);
        this.pushFeed(`⚠️ ${MOBS[id].name} entre dans la bataille !`);
      });
      this.announce(list.map((id) => MOBS[id].name).join(' · '), list.length > 1 ? 'Ils arrivent tous ensemble !' : 'BOSS');
    }
  },

  spawnMob(type, x, y, opts = {}) {
    const d = MOBS[type];
    const sc = opts.sc || this.scaling(this.powerWave(Math.max(1, this.run.wave)));
    const elite = !!opts.elite && !d.boss;
    const bf = d.ally ? { hp: 1, dmg: 1 } : this.bossFactor(type); // partie rapide : adaptation à la puissance de la manche
    const hpMul = (d.boss ? sc.bossCurveHp * sc.bossHp : sc.hp * (this.run.hpBoost || 1)) * bf.hp * (elite ? GD.BALANCE.ELITE_HP : 1);
    const m = {
      nid: this.nid++, type, x, y, boss: !!d.boss, elite,
      maxHp: Math.round(d.hp * hpMul), hp: 0,
      dmg: d.dmg * sc.dmg * bf.dmg * (d.boss ? GD.BALANCE.BOSS_DMG : 1) * (elite ? GD.BALANCE.ELITE_DMG : 1), speed: d.speed * U.rand(0.92, 1.08), range: d.range, cd: d.cd,
      size: d.size * (elite ? 1.3 : 1), atkT: U.rand(0, d.cd), facing: Math.atan2(WORLD.CY - y, WORLD.CX - x),
      status: {}, target: null, targetId: 'tower', retargetT: 0, attackAnim: 0, auraT: 0, charging: null,
      abil: (d.abilities || []).map((a) => ({ ...a, t: a.cd * 0.5 }))
    };
    m.hp = m.maxHp;
    this.mobs.push(m);
    return m;
  },

  /* --------------------------- IA des monstres --------------------------- */
  updateMobs(dt) {
    const tmp = [];
    for (const m of this.mobs) {
      if (m.hp <= 0) continue;
      const d = MOBS[m.type];
      m.attackAnim -= dt;
      const speedMul = this.tickStatus(m, dt, (n) => this.damageMob(m, n, m.lastHitBy, { dot: true }));
      if (m.hp <= 0) continue;

      if (d.aura) {
        m.auraT -= dt;
        if (m.auraT <= 0) {
          m.auraT = 0.5;
          const r2 = (d.aura.radius + m.size) ** 2;
          for (const h of this.heroes.values()) if (h.alive && (h.x - m.x) ** 2 + (h.y - m.y) ** 2 < r2) this.applyStatus(h, { burn: d.aura.burn * (1 + 0.04 * this.run.wave), dur: 1.5 });
        }
      }
      if (m.charging) { this.updateMobCharge(m, dt); continue; }
      if (speedMul === 0) continue; // gelé
      // charmé (enchanteresse) : n'attaque plus et erre
      if (m.status.charm) {
        m.wanderA = (m.wanderA === undefined ? Math.random() * Math.PI * 2 : m.wanderA) + U.rand(-2, 2) * dt;
        this.moveToward(m, m.x + Math.cos(m.wanderA) * 20, m.y + Math.sin(m.wanderA) * 20, m.speed * 0.3 * speedMul, dt);
        continue;
      }

      for (const ab of m.abil) {
        ab.t -= dt;
        if (ab.t <= 0) { ab.t = ab.cd * U.rand(0.9, 1.1); this.mobAbility(m, ab); }
      }
      if (m.charging) continue;

      // choix de la cible
      m.retargetT -= dt;
      if (m.retargetT <= 0 || (m.target && (!this.unitAlive(m.target) || this.unitHidden(m.target)))) {
        m.retargetT = 0.5;
        m.target = this.mobChooseTarget(m, d);
        m.targetId = m.target ? 'unit' : 'tower';
      }
      let tx, ty, reach;
      if (m.target) { tx = m.target.x; ty = m.target.y; reach = m.range + (m.target.size || 12); }
      else { tx = WORLD.CX; ty = WORLD.CY; reach = m.range + WORLD.TOWER_R; }
      const dist = Math.hypot(tx - m.x, ty - m.y);
      if (dist > reach) this.moveToward(m, tx, ty, m.speed * speedMul, dt);
      else m.facing = Math.atan2(ty - m.y, tx - m.x);
      m.atkT -= dt;
      if (dist <= reach + 4 && m.atkT <= 0) {
        m.atkT = m.cd;
        m.attackAnim = 0.25;
        // aveuglé (fauconnier) : une attaque sur deux est ratée
        if (m.status.blind && Math.random() < 0.5) this.fx(['text', Math.round(m.x), Math.round(m.y - m.size - 12), 'raté', '#cfd6e0']);
        else this.mobAttack(m, d);
      }
      // séparation douce
      if (!m.boss) {
        this.mobHash.query(m.x, m.y, m.size * 2, tmp);
        for (const o of tmp) {
          if (o === m) continue;
          const dx = m.x - o.x, dy = m.y - o.y;
          const min = (m.size + o.size) * 0.8;
          const dd = dx * dx + dy * dy;
          if (dd > 0.01 && dd < min * min) {
            const k = ((min - Math.sqrt(dd)) / Math.sqrt(dd)) * 0.3;
            m.x += dx * k; m.y += dy * k;
          }
        }
        tmp.length = 0;
      }
      // ne pas entrer dans la tour
      const tdx = m.x - WORLD.CX, tdy = m.y - WORLD.CY;
      const td = Math.hypot(tdx, tdy), tmin = WORLD.TOWER_R + m.size * 0.6;
      if (td < tmin && td > 0) { m.x = WORLD.CX + (tdx / td) * tmin; m.y = WORLD.CY + (tdy / td) * tmin; }
    }
  },

  unitAlive(u) { return u.alive !== undefined ? u.alive : u.hp > 0; },
  unitHidden(u) { return u.nid && this.heroes.get(u.id) === u && this.isInvisible(u); },

  mobChooseTarget(m, d) {
    const aggro = m.boss ? 280 : d.ranged ? d.range + 60 : 150;
    let best = null, bd = aggro * aggro;
    for (const h of this.heroes.values()) {
      if (!h.alive) continue;
      const dd = (h.x - m.x) ** 2 + (h.y - m.y) ** 2;
      if (dd < bd && !this.isInvisible(h)) { bd = dd; best = h; }
    }
    for (const a of this.allies) {
      if (a.hp <= 0) continue;
      const dd = (a.x - m.x) ** 2 + (a.y - m.y) ** 2;
      if (dd < bd) { bd = dd; best = a; }
    }
    return best || this.buildingOnPath(m);
  },

  // Bâtiment situé sur le chemin direct du monstre vers la tour (pas de détour)
  buildingOnPath(m) {
    const dx = WORLD.CX - m.x, dy = WORLD.CY - m.y;
    const L = Math.hypot(dx, dy);
    if (L < 1) return null;
    const ux = dx / L, uy = dy / L;
    let best = null, bt = Infinity;
    for (const b of this.run.buildings) {
      if (b.hp <= 0) continue;
      const px = b.x - m.x, py = b.y - m.y;
      const t = px * ux + py * uy;
      if (t < -b.size || t > L) continue;
      if (Math.abs(px * uy - py * ux) < b.size + m.size + 18 && t < bt) { bt = t; best = b; }
    }
    return best;
  },

  hitUnit(u, dmg, onHit) {
    if (u.isBuilding) this.damageBuilding(u, dmg);
    else if (this.heroes.get(u.id) === u) this.damageHero(u, dmg, onHit);
    else this.damageAlly(u, dmg);
  },

  scaledOnHit(oh) {
    if (!oh) return null;
    const k = 1 + 0.05 * this.run.wave;
    return { slow: oh.slow, dur: oh.dur, poison: oh.poison ? oh.poison * k : 0, burn: oh.burn ? oh.burn * k : 0 };
  },

  mobAttack(m, d) {
    const t = m.target;
    if (d.explode) {
      // champignon explosif : explose au contact
      const ex = d.explode;
      this.fx(['boom', Math.round(m.x), Math.round(m.y), ex.radius, 2]);
      this.zones.push({ kind: 'poison', x: m.x, y: m.y, r: ex.radius, t: 4, dps: ex.poison * (1 + 0.05 * this.run.wave) });
      for (const h of this.heroes.values()) if (h.alive && (h.x - m.x) ** 2 + (h.y - m.y) ** 2 < ex.radius ** 2) this.damageHero(h, m.dmg, this.scaledOnHit({ poison: ex.poison, dur: ex.dur }));
      for (const a of this.allies) if ((a.x - m.x) ** 2 + (a.y - m.y) ** 2 < ex.radius ** 2) this.damageAlly(a, m.dmg);
      if (!t) this.damageTower(m.dmg);
      m.hp = 0;
      return;
    }
    if (d.ranged) {
      const tx = t ? t.x : WORLD.CX, ty = t ? t.y : WORLD.CY;
      this.shoot({ kind: d.ranged, side: 'mob', x: m.x, y: m.y - 6, tx, ty, dmg: m.dmg, speed: 360, homing: false, onHit: this.scaledOnHit(d.onHit), life: 2.5 });
      return;
    }
    if (t) this.hitUnit(t, m.dmg, this.scaledOnHit(d.onHit));
    else this.damageTower(m.dmg);
  },

  mobAbility(m, ab) {
    const d = MOBS[m.type];
    switch (ab.type) {
      case 'slam': {
        const r = ab.radius;
        let any = (m.x - WORLD.CX) ** 2 + (m.y - WORLD.CY) ** 2 < (r + WORLD.TOWER_R) ** 2;
        for (const h of this.heroes.values()) if (h.alive && (h.x - m.x) ** 2 + (h.y - m.y) ** 2 < (r + 40) ** 2) { any = true; break; }
        if (!any) { ab.t = 1; return; }
        const x = m.x, y = m.y;
        this.zones.push({
          kind: 'telegraph', x, y, r, t: 1.1,
          onEnd: () => {
            if (m.hp <= 0) return;
            this.fx(['slam', Math.round(x), Math.round(y), r, ab.poison ? 2 : ab.burn ? 1 : 0]);
            const oh = { slow: ab.slow, dur: 2.5, poison: ab.poison, burn: ab.burn };
            for (const h of this.heroes.values()) if (h.alive && (h.x - x) ** 2 + (h.y - y) ** 2 < r * r) this.damageHero(h, m.dmg * ab.dmg, this.scaledOnHit(oh));
            for (const a of this.allies) if ((a.x - x) ** 2 + (a.y - y) ** 2 < r * r) this.damageAlly(a, m.dmg * ab.dmg);
            if ((x - WORLD.CX) ** 2 + (y - WORLD.CY) ** 2 < (r + WORLD.TOWER_R) ** 2) this.damageTower(m.dmg * ab.dmg);
            if (ab.poison) this.zones.push({ kind: 'poison', x, y, r: r * 0.7, t: 4, dps: ab.poison * (1 + 0.05 * this.run.wave) });
          }
        });
        break;
      }
      case 'summon': {
        if (this.mobs.length > this.settings.maxAliveMobs) return;
        // invocations proportionnées à la taille de l'équipe (petit groupe = moins de renforts)
        const hn = this.heroes.size;
        const n = Math.max(1, Math.round(ab.count * Math.min(1, Math.max(0.4, hn / 8)))) + Math.floor(hn / 10);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          this.spawnMob(ab.mob, m.x + Math.cos(a) * (m.size + 20), m.y + Math.sin(a) * (m.size + 20), {});
        }
        this.fx(['summon', Math.round(m.x), Math.round(m.y), Math.round(m.size * 2)]);
        break;
      }
      case 'volley': {
        const off = Math.random() * Math.PI;
        for (let i = 0; i < ab.count; i++) {
          const a = off + (i / ab.count) * Math.PI * 2;
          this.shoot({ kind: ab.proj, side: 'mob', x: m.x, y: m.y, angle: a, tx: 0, ty: 0, dmg: m.dmg * ab.dmg, speed: 280, homing: false, onHit: this.scaledOnHit(d.onHit || { slow: ab.proj === 'frost' ? 0.3 : 0, dur: 1.5 }), life: 3.5 });
        }
        break;
      }
      case 'charge': {
        const t = m.target;
        const tx = t ? t.x : WORLD.CX, ty = t ? t.y : WORLD.CY;
        const a = Math.atan2(ty - m.y, tx - m.x);
        const len = Math.min(380, Math.hypot(tx - m.x, ty - m.y) + 60);
        const ex = m.x + Math.cos(a) * len, ey = m.y + Math.sin(a) * len;
        m.charging = { phase: 'wind', t: 0.8, sx: m.x, sy: m.y, ex, ey, hit: new Set(), mult: ab.dmg };
        m.facing = a;
        this.zones.push({ kind: 'tline', x: m.x, y: m.y, x2: ex, y2: ey, r: m.size, t: 0.8 });
        break;
      }
    }
  },

  updateMobCharge(m, dt) {
    const C = m.charging;
    if (C.phase === 'wind') {
      C.t -= dt;
      if (C.t <= 0) { C.phase = 'run'; C.t = 0; C.dur = 0.45; }
      return;
    }
    C.t += dt;
    const k = Math.min(1, C.t / C.dur);
    m.x = C.sx + (C.ex - C.sx) * k; m.y = C.sy + (C.ey - C.sy) * k;
    const r = m.size + 16;
    for (const h of this.heroes.values()) {
      if (!h.alive || C.hit.has(h) || (h.x - m.x) ** 2 + (h.y - m.y) ** 2 > r * r) continue;
      C.hit.add(h);
      this.damageHero(h, m.dmg * C.mult);
    }
    const td = Math.hypot(m.x - WORLD.CX, m.y - WORLD.CY);
    if (td < WORLD.TOWER_R + m.size) {
      this.damageTower(m.dmg * C.mult);
      this.fx(['slam', Math.round(m.x), Math.round(m.y), m.size * 2, 0]);
      m.charging = null;
      return;
    }
    if (k >= 1) m.charging = null;
  },

  /* --------------------------- Dégâts & morts --------------------------- */
  damageMob(m, amount, owner, opts = {}) {
    if (m.hp <= 0) return false;
    // marque du faucon et acide : dégâts reçus augmentés
    if (m.status.mark) amount *= 1 + m.status.mark.v;
    if (m.status.acid) amount *= 1 + m.status.acid.v;
    m.hp -= amount;
    // Barbare : se soigne d'une part des dégâts infligés
    if (owner && owner.cls && !opts.dot && !opts.byAlly && owner.alive) {
      const rc = CLASSES[owner.cls] && CLASSES[owner.cls].rage;
      if (rc) owner.hp = Math.min(owner.maxHp, owner.hp + amount * (rc.leech + ((owner.mods && owner.mods.leech) || 0)));
    }
    if (opts.extra && owner && m.hp > 0) {
      if (opts.extra.venom) this.addVenom(m, owner, 1);
      const ch = opts.extra.charm;
      if (ch && !m.boss && Math.random() < ch.chance) { m.status.charm = { t: ch.dur }; this.fx(['charm', Math.round(m.x), Math.round(m.y - m.size - 10)]); }
    }
    if (owner && !opts.dot) m.lastHitBy = owner;
    if (opts.onHit) {
      const oh = opts.onHit;
      this.applyStatus(m, m.boss && oh.freeze ? { ...oh, freeze: Math.min(oh.freeze, 0.8) } : oh);
    }
    if (owner && owner.ult !== undefined && owner.ultUnlocked && !opts.dot && !opts.byAlly && !opts.splash) owner.ult = Math.min(1, owner.ult + 0.004);
    if (!opts.dot && (opts.crit || m.boss || Math.random() < 0.25)) {
      this.numBudget = (this.numBudget || 0) + 1;
      if (this.numBudget < 30) this.fx(['num', Math.round(m.x), Math.round(m.y - m.size - 6), Math.round(amount), opts.crit ? 1 : 0]);
    }
    if (m.hp <= 0) { this.onMobDeath(m, owner); return true; }
    return false;
  },

  onMobDeath(m, killer) {
    const d = MOBS[m.type];
    this.fx(['death', Math.round(m.x), Math.round(m.y), MOB_IDS.indexOf(m.type), m.boss ? 1 : 0]);
    const mult = m.elite ? 4 : 1;
    // écus d'élimination, de moins en moins généreux au fil de la partie (fractions cumulées)
    const B = GD.BALANCE, decay = 1 / (1 + this.powerWave(this.run.wave) / B.ECUS_LATE_DECAY);
    this.run.ecuFrac = (this.run.ecuFrac || 0) + d.gold * (m.elite ? 3 : 1) * B.KILL_ECUS * decay;
    const whole = Math.floor(this.run.ecuFrac);
    if (whole > 0) { this.run.ecuFrac -= whole; this.addTreasury(whole); }
    const hero = killer && this.heroes.get(killer.id) === killer ? killer : null;
    if (hero) {
      hero.runKills++;
      this.reward(hero, d.xp * mult, d.gold * mult);
      const u = hero.userId && this.db.userById(hero.userId);
      if (u) { u.stats.kills++; if (m.boss) u.stats.bossKills++; }
    }
    if (m.boss) {
      this.pushFeed(hero ? `🏆 ${hero.name} achève ${d.name} !` : `🏆 ${d.name} est vaincu !`);
      // récompense collective
      for (const h of this.heroes.values()) if (h !== hero) this.reward(h, d.xp * 0.5, d.gold * 0.5);
    }
  }
};
