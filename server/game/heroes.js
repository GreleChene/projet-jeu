'use strict';
/*
 * IA des héros (contrôlés par les choix d'IA des viewers), compétences et ultimes.
 */
const GD = require('../../shared/constants');
const U = require('./util');
const { WORLD, CLASSES, MOBS } = GD;


module.exports = {
  isInvisible(h) {
    return h.buffs.stealth > 0 || this.inSmoke(h.x, h.y);
  },

  updateHeroes(dt) {
    const combat = this.phase === 'wave' || this.phase === 'intermission';
    for (const h of this.heroes.values()) {
      h.attackAnim -= dt;
      for (const k in h.buffs) if (h.buffs[k] > 0) h.buffs[k] -= dt;

      if (!h.alive) {
        continue; // pas de réapparition : seul un vote « Résurrection » (ou un nécromancien) peut le relever
      }
      if (!combat) { this.heroIdle(h, dt, 1); continue; }

      const speedMul = this.tickStatus(h, dt, (d) => this.damageHero(h, d, null, true));
      if (!h.alive) continue;

      if (h.zombie) {
        this.damageHero(h, h.maxHp * 0.01 * dt, null, true);
        if (!h.alive) continue;
      }
      // régénération près de la tour (Infirmerie)
      if ((h.x - WORLD.CX) ** 2 + (h.y - WORLD.CY) ** 2 < 170 * 170) {
        h.hp = Math.min(h.maxHp, h.hp + h.maxHp * (0.008 + 0.012 * this.run.upgrades.infirmary) * dt);
      }
      const c = CLASSES[h.cls];
      if (c.ult && h.ult < 1) h.ult = Math.min(1, h.ult + (dt / (c.ult === 'fortify' ? GD.BALANCE.FORTIFY_ULT_TIME : GD.BALANCE.ULT_TIME)) * (h.ultRate || 1) * (1 + this.run.upgrades.shrine / Math.max(1, GD.UPGRADES.shrine.max)));

      if (h.dashing) { this.updateDash(h, dt); continue; }
      if (h.chain) { this.updateChain(h, dt); continue; }

      this.heroPassives(h, c, dt);
      if (!h.alive) continue;
      this.heroAI(h, c, dt, speedMul);
    }
  },

  heroIdle(h, dt, speedMul) {
    const st = h.ai.stance;
    if (st === 'home') {
      // garde de son habitation : tourne autour d'elle
      const b = this.buildingOfHero(h) || { x: WORLD.CX, y: WORLD.CY };
      h.idleAngle += dt * 0.4;
      const tx = b.x + Math.cos(h.idleAngle) * 42, ty = b.y + 20 + Math.sin(h.idleAngle) * 16;
      if ((h.x - tx) ** 2 + (h.y - ty) ** 2 > 64) this.moveToward(h, tx, ty, h.speed * 0.7 * speedMul, dt);
      return;
    }
    let r = st === 'defensive' ? 115 : st === 'offensive' ? 290 : 195;
    r = Math.min(r, h.leash - 20);
    h.idleAngle += dt * 0.03;
    const tx = WORLD.CX + Math.cos(h.idleAngle) * r * 1.3;
    const ty = WORLD.CY + Math.sin(h.idleAngle) * r * 0.85;
    if ((h.x - tx) ** 2 + (h.y - ty) ** 2 > 64) this.moveToward(h, tx, ty, h.speed * 0.7 * speedMul, dt);
  },

  moveToward(u, tx, ty, speed, dt) {
    const dx = tx - u.x, dy = ty - u.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1) return;
    const s = Math.min(d, speed * dt);
    u.x += (dx / d) * s; u.y += (dy / d) * s;
    u.facing = Math.atan2(dy, dx);
  },

  clampHero(h) {
    const dx = h.x - WORLD.CX, dy = h.y - WORLD.CY;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > h.leash) { h.x = WORLD.CX + (dx / d) * h.leash; h.y = WORLD.CY + (dy / d) * h.leash; }
    h.x = U.clamp(h.x, 16, WORLD.W - 16); h.y = U.clamp(h.y, 24, WORLD.H - 12);
  },

  /* --------------------------- Passifs de classe --------------------------- */
  heroPassives(h, c, dt) {
    const T = h.timers;
    // Ombre : invisibilité périodique
    if (c.stealth) {
      T.stealth += dt;
      if (T.stealth >= c.stealth.every) { T.stealth = 0; h.buffs.stealth = c.stealth.dur; this.fx(['puff', h.x, h.y]); }
    }
    // Flèche : dash derrière l'ennemi le plus faible
    if (c.dash) {
      T.dash -= dt;
      if (T.dash <= 0) {
        const tgt = this.weakestMob(h.x, h.y, c.dash.range);
        if (tgt) { T.dash = c.dash.every; this.dashBehind(h, tgt, 2.2); }
      }
    }
    // Mage de soin : soigne l'allié le plus blessé
    if (c.healer) {
      T.heal -= dt;
      if (T.heal <= 0) {
        T.heal = 3;
        let best = null, br = 0.95;
        for (const o of this.heroes.values()) {
          if (!o.alive || (o.x - h.x) ** 2 + (o.y - h.y) ** 2 > 320 * 320) continue;
          const r = o.hp / o.maxHp;
          if (r < br) { br = r; best = o; }
        }
        if (best) {
          this.healHero(best, best.maxHp * 0.1 + h.dmg * 1.2);
          this.fx(['beam', h.x, h.y, best.x, best.y]);
        }
      }
    }
    // Éleveur / Dompteur : maintien des bêtes
    if (c.summons) {
      T.summon -= dt;
      if (T.summon <= 0) {
        for (const [kind, n] of Object.entries(c.summons)) {
          const have = this.allies.filter((a) => a.ownerId === h.id && a.type === 'ally_' + kind).length;
          if (have < n) { this.spawnAlly(h, 'ally_' + kind, h.x, h.y); T.summon = 8; break; }
        }
      }
    }
  },

  weakestMob(x, y, r) {
    let best = null, bh = Infinity;
    for (const m of this.mobsInRadius(x, y, r)) if (m.hp < bh) { bh = m.hp; best = m; }
    return best;
  },

  dashBehind(h, m, mult) {
    const a = Math.atan2(m.y - h.y, m.x - h.x);
    const sx = h.x, sy = h.y;
    h.x = m.x + Math.cos(a) * (m.size + 14);
    h.y = m.y + Math.sin(a) * (m.size + 14);
    h.x = U.clamp(h.x, 16, WORLD.W - 16); h.y = U.clamp(h.y, 24, WORLD.H - 12);
    h.facing = a + Math.PI;
    h.attackAnim = 0.2;
    this.fx(['dash', sx, sy, h.x, h.y]);
    return this.damageMob(m, h.dmg * this.dmgMul(h) * mult, h, { crit: true });
  },

  dmgMul(h) { return h.buffs.fury > 0 ? 1.4 : 1; },

  /* --------------------------- IA principale --------------------------- */
  // Entre les manches : chaque héros rentre dans le bâtiment de sa classe pour se soigner (s'il est encore debout)
  heroRest(h, dt, speed) {
    const b = this.buildingOfHero(h);
    h.harvesting = false; h.retreating = false;
    if (!b || b.hp <= 0) { h.resting = false; this.heroIdle(h, dt, 1); return; }
    const a = (h.nid * 2.4) % (Math.PI * 2);
    const tx = b.x + Math.cos(a) * 26, ty = b.y + 26 + Math.sin(a) * 10;
    if ((h.x - tx) ** 2 + (h.y - ty) ** 2 > 36) this.moveToward(h, tx, ty, speed, dt);
    h.resting = (h.x - b.x) ** 2 + (h.y - b.y) ** 2 < 70 * 70;
    if (h.resting && h.hp < h.maxHp) {
      h.hp = Math.min(h.maxHp, h.hp + h.maxHp * (b.heal || GD.BALANCE.BUILDING_HEAL) * dt);
      if (Math.random() < dt * 2) this.fx(['heal', Math.round(h.x), Math.round(h.y)]);
    }
  },

  heroAI(h, c, dt, speedMul) {
    if (this.phase === 'intermission' && !this.mobs.length) { this.heroRest(h, dt, h.speed * speedMul); this.clampHero(h); return; }
    h.resting = false;
    const ai = h.ai;
    const ratio = h.hp / h.maxHp;
    if (ai.retreat > 0 && ratio * 100 < ai.retreat) h.retreating = true;
    if (h.retreating && ratio > 0.8) h.retreating = false;
    const speed = h.speed * speedMul * (h.buffs.swift > 0 ? 1.4 : 1);

    h.retargetT -= dt;
    if (h.retargetT <= 0 || !h.target || h.target.hp <= 0) {
      h.retargetT = 0.4 + Math.random() * 0.2;
      h.target = this.chooseTarget(h);
    }
    const t = h.target;
    h.harvesting = false;

    if (h.ult >= 1 && c.ult && this.wantsUlt(h, c)) this.useUlt(h, c);
    if (!h.alive || h.dashing || h.chain) return;

    if (h.retreating) {
      const a = Math.atan2(h.y - WORLD.CY, h.x - WORLD.CX);
      this.moveToward(h, WORLD.CX + Math.cos(a) * 95, WORLD.CY + Math.sin(a) * 75, speed, dt);
      if (t && U.dist(h, t) <= h.range + t.size) this.heroAttack(h, c, t, dt);
      else h.atkT -= dt;
      this.clampHero(h);
      return;
    }

    // Paysans : récolte quand aucune menace proche
    if (c.harvest && ai.stance !== 'home' && (!t || U.dist(h, t) > 260)) {
      this.harvest(h, c, dt, speed);
      h.atkT -= dt;
      this.clampHero(h);
      return;
    }

    if (t) {
      const d = U.dist(h, t);
      const reach = h.range + t.size;
      const ranged = !!c.projectile;
      if (d > reach * 0.92) this.moveToward(h, t.x, t.y, speed, dt);
      else if (ranged && d < reach * 0.4) {
        // recule pour garder la distance
        const a = Math.atan2(h.y - t.y, h.x - t.x);
        this.moveToward(h, h.x + Math.cos(a) * 50, h.y + Math.sin(a) * 50, speed * 0.8, dt);
        h.facing = a + Math.PI;
      } else h.facing = Math.atan2(t.y - h.y, t.x - h.x);
      if (d <= reach + 4) this.heroAttack(h, c, t, dt);
      else h.atkT -= dt;
    } else {
      h.atkT -= dt;
      this.heroIdle(h, dt, speedMul);
    }
    this.clampHero(h);
  },

  chooseTarget(h) {
    const st = h.ai.stance, pr = h.ai.target;
    const leash = h.leash + h.range;
    const hunt = st === 'offensive' ? 5000 : st === 'balanced' ? 520 : 0;
    const defR = st === 'defensive' ? 360 : 420;
    // garde de son habitation : seulement les ennemis proches d'elle
    const home = st === 'home' ? this.buildingOfHero(h) || { x: WORLD.CX, y: WORLD.CY } : null;
    const homeR = 230 + h.range;
    let best = null, bs = Infinity;
    for (const m of this.mobs) {
      if (m.hp <= 0) continue;
      const dt2 = (m.x - WORLD.CX) ** 2 + (m.y - WORLD.CY) ** 2;
      if (dt2 > leash * leash) continue;
      if (m.x < -10 || m.y < -10 || m.x > WORLD.W + 10 || m.y > WORLD.H + 10) continue;
      const dh = Math.sqrt((m.x - h.x) ** 2 + (m.y - h.y) ** 2);
      const dTower = Math.sqrt(dt2);
      if (home) { if ((m.x - home.x) ** 2 + (m.y - home.y) ** 2 > homeR * homeR) continue; }
      else if (dh > hunt && dTower > defR) continue;
      let s;
      switch (pr) {
        case 'weakest': s = m.hp + dh * 0.15; break;
        case 'strongest': s = -(m.boss ? 1e7 : 0) - (m.elite ? 1e6 : 0) - m.maxHp + dh * 0.2; break;
        case 'tower': s = (m.targetId === 'tower' ? 0 : 5000) + dTower; break;
        default: s = dh;
      }
      if (s < bs) { bs = s; best = m; }
    }
    return best;
  },

  heroAttack(h, c, t, dt) {
    h.atkT -= dt;
    if (h.atkT > 0) return;
    const rate = (h.buffs.swift > 0 ? 1.4 : 1) * (h.buffs.rapid > 0 ? 3 : 1);
    h.atkT = h.cd / rate;
    h.attackAnim = 0.22;
    h.facing = Math.atan2(t.y - h.y, t.x - h.x);
    const crit = Math.random() < h.crit;
    const dmg = h.dmg * this.dmgMul(h) * (crit ? 2 : 1);
    let onHit = null;
    if (c.onHit) onHit = { slow: c.onHit.slow, burn: c.onHit.burn ? h.dmg * c.onHit.burn : 0, dur: c.onHit.dur };
    if (c.projectile) {
      this.shoot({ kind: c.projectile, side: 'hero', x: h.x, y: h.y - 10, target: t, dmg, crit, owner: h, onHit, speed: c.projectile === 'orb' || c.projectile === 'holy' ? 480 : 640 });
    } else {
      this.fx(['slash', Math.round(h.x), Math.round(h.y), Math.round(h.facing * 100), c.weapon === 'whip' ? 1 : 0]);
      this.damageMob(t, dmg, h, { crit, onHit });
    }
  },

  harvest(h, c, dt, speed) {
    const types = c.harvest === 'any' ? ['field', 'tree', 'rock'] : [c.harvest];
    const list = this.nodes.filter((n) => types.includes(n.type));
    const node = list[h.nid % list.length];
    const d = U.dist(h, node);
    if (d > 26) { this.moveToward(h, node.x, node.y + 18, speed, dt); return; }
    h.harvesting = true;
    h.facing = Math.atan2(node.y - h.y, node.x - h.x);
    h.timers.harvest += dt;
    if (h.timers.harvest >= GD.BALANCE.HARVEST_INTERVAL) {
      h.timers.harvest = 0;
      h.attackAnim = 0.25;
      const amt = Math.round((GD.BALANCE.HARVEST_BASE + h.level * GD.BALANCE.HARVEST_PER_LEVEL) * (c.harvest === 'any' ? 1 : 1.5) * (h.harvestMult || 1));
      this.addTreasury(amt);
      this.fx(['coin', Math.round(node.x), Math.round(node.y - 10), amt]);
    }
  },

  /* --------------------------- Dégâts / soins --------------------------- */
  damageHero(h, n, onHit, raw) {
    if (!h.alive) return;
    if (!raw) n *= (1 - h.armor) * (h.buffs.shield > 0 ? 0.5 : 1);
    h.hp -= n;
    if (onHit) this.applyStatus(h, onHit);
    if (h.hp <= 0) this.heroDie(h);
  },

  heroDie(h) {
    h.alive = false; h.hp = 0;
    const v = this.run && this.run.vote;
    if (v && !v.options.includes('revive')) v.options.splice(Math.max(0, v.options.indexOf('pact')), 0, 'revive');
    h.deathX = h.x; h.deathY = h.y;
    h.deadAt = this.time;
    h.zombie = false; h.dashing = null; h.chain = null; h.target = null; h.status = {};
    this.fx(['hdeath', Math.round(h.x), Math.round(h.y), h.nid]);
    const u = h.userId && this.db.userById(h.userId);
    if (u) { u.stats.deaths++; this.db.markDirty(); }
  },

  healHero(h, n) {
    if (!h.alive) return;
    const before = h.hp;
    h.hp = Math.min(h.maxHp, h.hp + n);
    const got = Math.round(h.hp - before);
    if (got > 0) this.fx(['num', Math.round(h.x), Math.round(h.y - 30), got, 2]);
  },

  /* --------------------------- Invocations --------------------------- */
  spawnAlly(owner, type, x, y, extra) {
    const d = MOBS[type];
    const a = {
      nid: this.nid++, type, ownerId: owner.id, x: x + U.rand(-20, 20), y: y + U.rand(-20, 20),
      maxHp: Math.round(owner.maxHp * d.hp * (owner.summonMult || 1)), hp: 0, size: d.size, speed: d.speed, range: d.range, cd: d.cd,
      atkT: 0, facing: 0, attackAnim: 0, target: null, retargetT: 0, offset: Math.random() * Math.PI * 2, ...extra
    };
    a.hp = a.maxHp;
    this.allies.push(a);
    this.fx(['puff', Math.round(a.x), Math.round(a.y)]);
    return a;
  },

  damageAlly(a, n) {
    a.hp -= n;
    if (a.hp <= 0) this.fx(['death', Math.round(a.x), Math.round(a.y), GD.MOB_IDS.indexOf(a.type)]);
  },

  updateAllies(dt) {
    for (const a of this.allies) {
      if (a.hp <= 0) continue;
      const o = this.heroes.get(a.ownerId);
      if (!o) { a.hp = 0; continue; }
      a.attackAnim -= dt;
      const anchor = o.alive ? o : { x: WORLD.CX, y: WORLD.CY };
      a.retargetT -= dt;
      if (a.retargetT <= 0 || !a.target || a.target.hp <= 0) {
        a.retargetT = 0.5;
        a.target = null;
        let bd = 280 * 280;
        for (const m of this.mobs) {
          if (m.hp <= 0) continue;
          const d = (m.x - anchor.x) ** 2 + (m.y - anchor.y) ** 2;
          if (d < bd) { bd = d; a.target = m; }
        }
      }
      if (a.target) {
        const t = a.target;
        const d = U.dist(a, t);
        if (d > a.range + t.size) this.moveToward(a, t.x, t.y, a.speed, dt);
        a.atkT -= dt;
        if (d <= a.range + t.size + 4 && a.atkT <= 0) {
          a.atkT = a.cd;
          a.attackAnim = 0.2;
          a.facing = Math.atan2(t.y - a.y, t.x - a.x);
          const dmg = o.dmg * MOBS[a.type].dmg * (o.buffs.beast > 0 ? 1.6 : 1) * (o.summonMult || 1);
          this.damageMob(t, dmg, o, { byAlly: true });
        }
      } else {
        a.offset += dt * 0.5;
        const tx = anchor.x + Math.cos(a.offset) * 45, ty = anchor.y + Math.sin(a.offset) * 30;
        if ((a.x - tx) ** 2 + (a.y - ty) ** 2 > 100) this.moveToward(a, tx, ty, a.speed * 0.8, dt);
      }
      a.x = U.clamp(a.x, 10, WORLD.W - 10); a.y = U.clamp(a.y, 10, WORLD.H - 10);
    }
    this.allies = this.allies.filter((a) => a.hp > 0);
  },

  /* --------------------------- Ultimes --------------------------- */
  wantsUlt(h, c) {
    const mode = h.ai.ult;
    const bossAlive = this.mobs.some((m) => m.boss);
    const emergency = this.run.tower.hp < this.run.tower.max * 0.3;
    if (mode === 'boss' && !bossAlive && !emergency) return false;
    const t = h.target;
    const near = (r) => this.mobsInRadius(h.x, h.y, r).length;
    const asap = mode === 'asap';
    switch (c.ult) {
      case 'whirl': return near(150) >= (asap ? 1 : 3) || (t && t.boss && U.dist(h, t) < 150);
      case 'charge': return !!t && U.dist(h, t) < 360 && (asap || t.boss || near(300) >= 3);
      case 'frostcone': return !!t && U.dist(h, t) < 300 && (asap || near(300) >= 3 || t.boss);
      case 'fireball': return !!t && (asap || t.boss || this.mobsInRadius(t.x, t.y, 150).length >= 3);
      case 'rapidfire': return !!t && (asap || t.boss || this.mobs.length >= 6);
      case 'tripleshot': return !!t && (asap || t.boss || near(450) >= 3);
      case 'chaindash': return !!this.nearestMob(h.x, h.y, 450) && (asap || near(450) >= 2 || (t && t.boss));
      case 'smoke': {
        let allies = 0;
        for (const o of this.heroes.values()) if (o.alive && (o.x - h.x) ** 2 + (o.y - h.y) ** 2 < 170 * 170) allies++;
        return near(250) >= 1 && (asap || allies >= 3 || h.hp < h.maxHp * 0.4);
      }
      case 'massheal': {
        let hurt = 0, critical = false;
        for (const o of this.heroes.values()) {
          if (!o.alive || (o.x - h.x) ** 2 + (o.y - h.y) ** 2 > 350 * 350) continue;
          const r = o.hp / o.maxHp;
          if (r < 0.65) hurt++;
          if (r < 0.35) critical = true;
        }
        return hurt >= (asap ? 1 : 2) || critical;
      }
      case 'harvestheal': {
        let hurt = 0;
        for (const o of this.heroes.values()) if (o.alive && o.hp < o.maxHp * 0.7) hurt++;
        return hurt >= (asap ? 1 : Math.max(2, Math.ceil(this.heroes.size * 0.2)));
      }
      case 'towerheal': return this.run.tower.hp < this.run.tower.max * (asap ? 0.95 : 0.85);
      case 'fortify': return this.phase === 'wave';
      case 'beastcall': return this.allies.some((a) => a.ownerId === h.id) && near(300) >= (asap ? 1 : 2);
      case 'revive': {
        for (const o of this.heroes.values()) if (!o.alive) return true;
        return asap && near(300) >= 2;
      }
    }
    return false;
  },

  useUlt(h, c) {
    h.ult = 0;
    h.attackAnim = 0.4;
    const t = h.target;
    const dmg = h.dmg * this.dmgMul(h);
    this.fx(['ult', Math.round(h.x), Math.round(h.y), h.nid, c.ultName]);
    switch (c.ult) {
      case 'whirl':
        this.fx(['whirl', Math.round(h.x), Math.round(h.y), 150]);
        for (const m of this.mobsInRadius(h.x, h.y, 150)) this.damageMob(m, dmg * 2.5, h, {});
        break;
      case 'charge': {
        const a = t ? Math.atan2(t.y - h.y, t.x - h.x) : h.facing;
        let ex = h.x + Math.cos(a) * 340, ey = h.y + Math.sin(a) * 340;
        const dx = ex - WORLD.CX, dy = ey - WORLD.CY, d = Math.hypot(dx, dy);
        if (d > h.leash) { ex = WORLD.CX + (dx / d) * h.leash; ey = WORLD.CY + (dy / d) * h.leash; }
        h.facing = a;
        h.dashing = { sx: h.x, sy: h.y, ex: U.clamp(ex, 16, WORLD.W - 16), ey: U.clamp(ey, 24, WORLD.H - 12), t: 0, dur: 0.4, hit: new Set(), dmg: h.baseDmg * 2 * this.dmgMul(h) };
        break;
      }
      case 'frostcone': {
        const a = t ? Math.atan2(t.y - h.y, t.x - h.x) : h.facing;
        h.facing = a;
        this.fx(['cone', Math.round(h.x), Math.round(h.y), Math.round(a * 100), 330]);
        for (const m of this.mobsInRadius(h.x, h.y, 330)) {
          if (Math.abs(U.angleDiff(Math.atan2(m.y - h.y, m.x - h.x), a)) < 0.62) {
            this.damageMob(m, dmg * 2, h, { onHit: { freeze: m.boss ? 0.8 : 2.5 } });
          }
        }
        break;
      }
      case 'fireball':
        if (t) this.shoot({ kind: 'fireball', side: 'hero', x: h.x, y: h.y - 10, tx: t.x, ty: t.y, dmg: dmg * 4, explode: 150, speed: 520, owner: h, onHit: { burn: h.dmg * 0.4, dur: 4 } });
        break;
      case 'massheal':
        this.fx(['healring', Math.round(h.x), Math.round(h.y), 350]);
        for (const o of this.heroes.values()) if (o.alive && (o.x - h.x) ** 2 + (o.y - h.y) ** 2 < 350 * 350) this.healHero(o, o.maxHp * 0.5);
        for (const a of this.allies) if ((a.x - h.x) ** 2 + (a.y - h.y) ** 2 < 350 * 350) a.hp = Math.min(a.maxHp, a.hp + a.maxHp * 0.5);
        break;
      case 'beastcall':
        h.buffs.beast = 8;
        this.fx(['healring', Math.round(h.x), Math.round(h.y), 200]);
        for (const a of this.allies) if (a.ownerId === h.id) { a.hp = a.maxHp; this.fx(['text', Math.round(a.x), Math.round(a.y - 20), 'GRRR !', c.color]); }
        h.timers.summon = 0;
        break;
      case 'revive': {
        let best = null;
        for (const o of this.heroes.values()) if (!o.alive && (!best || o.deadAt < best.deadAt)) best = o;
        if (best) {
          best.alive = true; best.zombie = true; best.status = {};
          best.hp = best.maxHp * 0.75; best.x = best.deathX; best.y = best.deathY;
          this.fx(['revive', Math.round(best.x), Math.round(best.y)]);
          this.pushFeed(`🧟 ${h.name} relève ${best.name} d’entre les morts !`);
        } else {
          for (let i = 0; i < 3; i++) this.spawnAlly(h, 'ally_skeleton', h.x, h.y);
        }
        break;
      }
      case 'rapidfire': h.buffs.rapid = 6; break;
      case 'tripleshot': {
        const a = t ? Math.atan2(t.y - h.y, t.x - h.x) : h.facing;
        for (const off of [-0.12, 0, 0.12]) this.shoot({ kind: 'arrow', side: 'hero', x: h.x, y: h.y - 10, angle: a + off, tx: 0, ty: 0, dmg: dmg * 1.5, owner: h, speed: 850, pierce: 2, life: 0.7, homing: false, radius: 18 });
        break;
      }
      case 'smoke':
        this.zones.push({ kind: 'smoke', x: h.x, y: h.y, r: 170, t: 7 });
        break;
      case 'chaindash':
        h.chain = { n: 0, wait: 0 };
        break;
      case 'harvestheal':
        this.fx(['healring', Math.round(h.x), Math.round(h.y), 900]);
        for (const o of this.heroes.values()) if (o.alive) this.healHero(o, o.maxHp * 0.35);
        break;
      case 'towerheal': {
        const tw = this.run.tower;
        tw.hp = Math.min(tw.max, tw.hp + tw.max * 0.12);
        // le bûcheron répare aussi les bâtiments encore debout
        for (const b of this.run.buildings) if (b.hp > 0) b.hp = Math.min(b.max, b.hp + b.max * 0.3);
        this.fx(['towerheal', WORLD.CX, WORLD.CY]);
        break;
      }
      case 'fortify': {
        const tw = this.run.tower;
        const add = Math.max(1, Math.round(tw.max * GD.BALANCE.FORTIFY_PCT));
        tw.max += add; tw.hp += add;
        this.fx(['towerheal', WORLD.CX, WORLD.CY]);
        this.fx(['text', WORLD.CX, WORLD.CY - 120, `+${add} PV max`, GD.PALETTE.ui.gold]);
        break;
      }
    }
  },

  updateDash(h, dt) {
    const D = h.dashing;
    D.t += dt;
    const k = Math.min(1, D.t / D.dur);
    h.x = D.sx + (D.ex - D.sx) * k; h.y = D.sy + (D.ey - D.sy) * k;
    for (const m of this.mobsInRadius(h.x, h.y, 50)) {
      if (D.hit.has(m)) continue;
      D.hit.add(m);
      this.damageMob(m, D.dmg, h, {});
    }
    if (k >= 1) { h.dashing = null; this.fx(['whirl', Math.round(h.x), Math.round(h.y), 70]); }
  },

  updateChain(h, dt) {
    const C = h.chain;
    C.wait -= dt;
    if (C.wait > 0) return;
    const m = this.nearestMob(h.x, h.y, 500);
    if (!m || C.n > 60) { h.chain = null; return; }
    C.n++;
    const killed = this.dashBehind(h, m, 2.6);
    if (killed) C.wait = 0.16;
    else h.chain = null;
  }
};
