'use strict';
/*
 * IA des héros (contrôlés par les choix d'IA des viewers), compétences et ultimes.
 */
const GD = require('../../shared/constants');
const U = require('./util');
const { WORLD, CLASSES, MOBS } = GD;


// Bonus de spécialisation du héros (compétences sur mesure)
const md = (h, k) => (h.mods && h.mods[k]) || 0;
// Plafond d'invocations du héros : 6, jusqu'à 9 avec la compétence d'après-ultime
const summonCap = (h) => Math.min(GD.SUMMON_CAP_MAX, GD.SUMMON_CAP + md(h, 'summonCap'));

module.exports = {
  summonCap(h) { return summonCap(h); },
  // Invocations voulues : [[type, nombre]] selon les nœuds débloqués et le plafond (6, puis 9)
  summonPlan(h, c) {
    if (!c.pets) return Object.entries(c.summons || {});
    const ranks = h.summonRanks || {};
    const want = {};
    for (const k of c.pets) if (ranks[k]) want[k] = ranks[k] >= GD.SUMMON_SECOND_RANK ? 2 : 1; // 1 créature, 2 au rang 3
    // au-delà de 6 (compétence d'après-ultime), une créature de plus par type, dans l'ordre extraPets
    let extra = summonCap(h) - GD.SUMMON_CAP;
    for (let i = 0; extra > 0 && i < 12; i++) { const k = (c.extraPets || [])[i % (c.extraPets || [1]).length]; if (want[k]) { want[k]++; extra--; } }
    return Object.entries(want);
  },
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
      if (c.ult && h.ultUnlocked && h.ult < 1) h.ult = Math.min(1, h.ult + (dt / GD.BALANCE.ULT_TIME) * (h.ultRate || 1) * (1 + this.run.upgrades.shrine / Math.max(1, GD.UPGRADES.shrine.max)));

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
    // Ménestrel : aura qui accélère (et renforce) les héros proches
    if (c.aura) {
      T.aura -= dt;
      if (T.aura <= 0) {
        T.aura = 0.5;
        const mul = (h.auraMult || 1) * (1 + md(h, 'auraPow')), r = c.aura.r * Math.sqrt(h.auraMult || 1) * (1 + md(h, 'auraR'));
        for (const o of this.heroes.values()) {
          if (!o.alive || (o.x - h.x) ** 2 + (o.y - h.y) ** 2 > r * r) continue;
          if (!(o.buffs.song > 0)) { o.songAtk = 0; o.songDmg = 0; }
          o.buffs.song = 0.8;
          o.songAtk = Math.max(o.songAtk || 0, c.aura.atkspd * mul);
          o.songDmg = Math.max(o.songDmg || 0, (c.aura.dmg || 0) * mul);
        }
      }
    }
    // Tambour de guerre : onde de choc qui repousse et étourdit
    if (c.quake) {
      T.quake += dt;
      const qr = c.quake.r * (1 + md(h, 'quakeR'));
      if (T.quake >= Math.max(2, c.quake.every - md(h, 'quakeCd'))) {
        const near = this.mobsInRadius(h.x, h.y, qr);
        if (near.length) {
          T.quake = 0;
          this.fx(['shock', Math.round(h.x), Math.round(h.y), Math.round(qr), 0]);
          for (const m of near) {
            const a = Math.atan2(m.y - h.y, m.x - h.x);
            if (!m.boss) { m.x += Math.cos(a) * c.quake.push; m.y += Math.sin(a) * c.quake.push; this.applyStatus(m, { freeze: c.quake.stun + md(h, 'quakeStun') }); }
            else this.applyStatus(m, { slow: 0.5, dur: 1 });
          }
        }
      }
    }
    // Trappeur : pose des pièges sur le chemin des monstres
    if (c.traps) {
      T.trap -= dt;
      if (T.trap <= 0) {
        const t = h.target && h.target.hp > 0 ? h.target : this.nearestMob(h.x, h.y, 500);
        const mine = this.zones.filter((z) => z.kind === 'trap' && z.owner === h);
        if (t && mine.length < c.traps.max + md(h, 'trapMax')) {
          T.trap = c.traps.every;
          // sur le chemin du monstre vers la tour, un peu devant lui
          const a = Math.atan2(WORLD.CY - t.y, WORLD.CX - t.x), ahead = Math.min(90, Math.max(0, U.dist(t, { x: WORLD.CX, y: WORLD.CY }) - 120));
          this.zones.push({ kind: 'trap', x: t.x + Math.cos(a) * ahead, y: t.y + Math.sin(a) * ahead, r: 30, t: 45, owner: h });
        } else T.trap = 1;
      }
    }
    // Barbare : fin de la frénésie, épuisement
    if (h.frenzyOn && !(h.buffs.frenzy > 0)) { h.frenzyOn = false; this.applyStatus(h, { slow: 0.5, dur: 2 }); }
    // Ombre : invisibilité périodique
    if (c.stealth) {
      T.stealth += dt;
      if (T.stealth >= c.stealth.every) { T.stealth = 0; h.buffs.stealth = c.stealth.dur + md(h, 'stealthDur'); this.fx(['puff', h.x, h.y]); }
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
          this.healHero(best, (best.maxHp * 0.1 + h.dmg * 1.2) * (1 + md(h, 'healMul')));
          this.fx(['beam', h.x, h.y, best.x, best.y]);
        }
      }
    }
    // Éleveur / Dompteur : maintien des bêtes
    if (c.summons || c.pets) {
      T.summon -= dt;
      if (T.summon <= 0) {
        T.summon = 1;
        let total = this.allies.filter((a) => a.ownerId === h.id && !a.charmed).length;
        for (const [kind, n] of this.summonPlan(h, c)) {
          if (total >= summonCap(h)) break;
          const have = this.allies.filter((a) => a.ownerId === h.id && a.type === 'ally_' + kind).length;
          if (have < n) { this.spawnAlly(h, 'ally_' + kind, h.x, h.y); total++; T.summon = kind === 'rat' || kind === 'pigeon' ? 3 : 8; break; }
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

  dmgMul(h) {
    let k = h.buffs.fury > 0 ? 1.4 : 1;
    if (h.buffs.song > 0) k *= 1 + (h.songDmg || 0);
    if (h.buffs.anthem > 0) k *= 1 + (h.anthemDmg || 0.3);
    if (h.buffs.frenzy > 0) k *= 1 + md(h, 'ultDmg');
    if (h.buffs.rapid > 0) k *= 1 + md(h, 'ultDmg');
    // Barbare : rage selon les PV manquants (bonus maximal sous 30 % de PV)
    const rc = CLASSES[h.cls] && CLASSES[h.cls].rage;
    if (rc) k *= 1 + rc.max * Math.min(1, Math.max(0, 1 - h.hp / h.maxHp) / 0.7);
    return k;
  },

  /* --------------------------- IA principale --------------------------- */
  // Entre les manches : chaque héros rentre dans le bâtiment de sa classe pour se soigner (s'il est encore debout)
  heroRest(h, dt, speed) {
    const b = this.buildingOfHero(h);
    h.retreating = false;
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

    if (h.ult >= 1 && c.ult && h.ultUnlocked && this.wantsUlt(h, c)) this.useUlt(h, c);
    if (!h.alive || h.dashing || h.chain) return;

    if (h.retreating) {
      const a = Math.atan2(h.y - WORLD.CY, h.x - WORLD.CX);
      this.moveToward(h, WORLD.CX + Math.cos(a) * 95, WORLD.CY + Math.sin(a) * 75, speed, dt);
      if (t && U.dist(h, t) <= h.range + t.size) this.heroAttack(h, c, t, dt);
      else h.atkT -= dt;
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
    const rate = (h.buffs.swift > 0 ? 1.4 : 1) * (h.buffs.rapid > 0 ? 3 : 1) * (h.buffs.song > 0 ? 1 + (h.songAtk || 0) : 1)
      * (h.buffs.anthem > 0 ? 1.2 : 1) * (h.buffs.frenzy > 0 ? 1.5 : 1);
    h.atkT = h.cd / rate;
    h.attackAnim = 0.22;
    h.facing = Math.atan2(t.y - h.y, t.x - h.x);
    const crit = Math.random() < h.crit;
    const dmg = h.dmg * this.dmgMul(h) * (crit ? 2 : 1);
    let onHit = null;
    if (c.onHit) onHit = { slow: c.onHit.slow ? Math.min(0.8, c.onHit.slow * (1 + md(h, 'frostMul'))) : 0, burn: c.onHit.burn ? h.dmg * c.onHit.burn * (1 + md(h, 'burnMul')) : 0, dur: c.onHit.dur };
    const extra = c.venom ? { venom: true } : c.charm ? { charm: { chance: c.charm.chance + md(h, 'charmChance'), dur: c.charm.dur + md(h, 'charmDur') } } : null;
    if (c.projectile) {
      const slow = c.projectile === 'orb' || c.projectile === 'holy' || c.projectile === 'note' || c.projectile === 'charm' || c.projectile === 'flask';
      // les notes du ménestrel traversent les monstres alignés
      const pierce = c.pierce || 1;
      this.shoot({ kind: c.projectile, side: 'hero', x: h.x, y: h.y - 10, target: pierce > 1 ? null : t, tx: t.x, ty: t.y, homing: pierce > 1 ? false : undefined, life: pierce > 1 ? (h.range + 80) / 520 : undefined, pierce, dmg, crit, owner: h, onHit, extra, speed: slow ? 520 : 640, radius: pierce > 1 ? 20 : undefined });
    } else {
      this.fx(['slash', Math.round(h.x), Math.round(h.y), Math.round(h.facing * 100), c.weapon === 'whip' ? 1 : 0]);
      this.damageMob(t, dmg, h, { crit, onHit, extra });
      // coups qui touchent aussi les ennemis proches (tambour, frénésie du berserker)
      const splash = c.splash || (h.buffs.frenzy > 0 ? 70 : 0);
      if (splash) {
        if (c.splash) this.fx(['shock', Math.round(t.x), Math.round(t.y), splash, 1]);
        for (const m of this.mobsInRadius(t.x, t.y, splash)) if (m !== t) this.damageMob(m, dmg * 0.6, h, { splash: true });
      }
    }
  },

  /* --------------------------- Dégâts / soins --------------------------- */
  damageHero(h, n, onHit, raw) {
    if (!h.alive) return;
    if (!raw) n *= (1 - h.armor) * (h.buffs.shield > 0 ? 0.5 : 1);
    h.hp -= n;
    if (onHit) this.applyStatus(h, onHit);
    if (h.hp <= 0 && h.buffs.frenzy > 0) h.hp = 1; // frénésie : ne tombe pas
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
      pow: 1 + GD.SUMMON_RANK_POWER * Math.max(0, ((owner.summonRanks || {})[type.slice(5)] || 1) - 1),
      maxHp: Math.round(owner.maxHp * d.hp * (owner.summonMult || 1) * (1 + GD.SUMMON_RANK_POWER * Math.max(0, ((owner.summonRanks || {})[type.slice(5)] || 1) - 1))), hp: 0, size: d.size, speed: d.speed, range: d.range, cd: d.cd,
      atkT: 0, facing: 0, attackAnim: 0, target: null, retargetT: 0, offset: Math.random() * Math.PI * 2, ...extra
    };
    a.hp = a.maxHp;
    this.allies.push(a);
    this.fx(['puff', Math.round(a.x), Math.round(a.y)]);
    return a;
  },

  damageAlly(a, n) {
    if (a.hp <= 0) return;
    a.hp -= n;
    if (a.hp > 0) return;
    // un monstre charmé qui meurt compte comme une élimination pour l'enchanteresse
    if (a.charmed) this.endCharm(a);
    else this.fx(['death', Math.round(a.x), Math.round(a.y), GD.MOB_IDS.indexOf(a.type)]);
  },

  endCharm(a) {
    a.hp = 0;
    const m = a.charmed.mob;
    m.x = a.x; m.y = a.y; m.hp = 0;
    const o = this.heroes.get(a.ownerId);
    this.onMobDeath(m, o || null);
  },

  updateAllies(dt) {
    for (const a of this.allies) {
      if (a.hp <= 0) continue;
      const o = this.heroes.get(a.ownerId);
      if (!o) { a.hp = 0; continue; }
      a.attackAnim -= dt;
      if (a.charmed) { a.charmed.t -= dt; if (a.charmed.t <= 0) { this.endCharm(a); continue; } }
      // nuée de rapaces : les oiseaux foncent sur les ennemis les plus proches d'eux
      const raptor = o.buffs.raptor > 0;
      const anchor = raptor ? a : o.alive ? o : { x: WORLD.CX, y: WORLD.CY };
      a.retargetT -= dt;
      if (a.retargetT <= 0 || !a.target || a.target.hp <= 0) {
        a.retargetT = 0.5;
        a.target = null;
        let bd = (raptor ? 700 : 280) ** 2;
        for (const m of this.mobs) {
          if (m.hp <= 0) continue;
          const d = (m.x - anchor.x) ** 2 + (m.y - anchor.y) ** 2;
          if (d < bd) { bd = d; a.target = m; }
        }
      }
      if (a.target) {
        const t = a.target;
        const d = U.dist(a, t);
        if (d > a.range + t.size) this.moveToward(a, t.x, t.y, a.speed * (raptor ? 1.5 : 1), dt);
        else a.facing = Math.atan2(t.y - a.y, t.x - a.x);
        a.atkT -= dt;
        if (d <= a.range + t.size + 4 && a.atkT <= 0) {
          a.atkT = a.cd;
          a.attackAnim = 0.2;
          a.facing = Math.atan2(t.y - a.y, t.x - a.x);
          const dmg = a.charmed ? a.power : o.dmg * MOBS[a.type].dmg * (o.buffs.beast > 0 ? 1.5 + md(o, 'ultDmg') : 1) * (raptor ? 1.5 : 1) * (o.summonMult || 1) * (a.pow || 1);
          const ad = MOBS[a.type];
          if (ad.ranged && !a.charmed) this.shoot({ kind: 'arrow', side: 'hero', x: a.x, y: a.y - 14, target: t, dmg, owner: o, speed: 620 });
          else this.damageMob(t, dmg, o, { byAlly: true, onHit: ad.onHit || null });
          const oc = CLASSES[o.cls];
          if (a.type === 'ally_falcon' && oc.mark && t.hp > 0) t.status.mark = { t: oc.mark.dur, v: oc.mark.v + md(o, 'mark') };
          if (raptor && t.hp > 0) t.status.blind = { t: 1e6 }; // aveuglé définitivement
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
      case 'beastcall': return this.allies.some((a) => a.ownerId === h.id) && near(300) >= (asap ? 1 : 2);
      case 'revive': {
        for (const o of this.heroes.values()) if (!o.alive) return true;
        return asap && near(300) >= 2;
      }
      case 'anthem': {
        let allies = 0;
        for (const o of this.heroes.values()) if (o.alive) allies++;
        return asap ? near(400) >= 1 : bossAlive || this.mobs.length >= 8 || (allies >= 3 && near(300) >= 3);
      }
      case 'thunder': {
        const n = near(300);
        return asap ? n >= 1 : n >= 5 || (!!t && t.boss && U.dist(h, t) < 300) || (emergency && n >= 1);
      }
      case 'enchant': {
        const cand = this.mobsInRadius(h.x, h.y, 320);
        return asap ? cand.length >= 1 : cand.length >= 6 || cand.some((m) => m.elite || m.boss);
      }
      case 'frenzy': {
        const n = near(150);
        return asap ? n >= 1 : (h.hp < h.maxHp * 0.4 && n >= 1) || n >= 5 || (!!t && t.boss && U.dist(h, t) < 150);
      }
      case 'hawkstorm': return this.allies.some((a) => a.ownerId === h.id && !a.charmed) && (asap ? this.mobs.length > 0 : near(500) >= 3 || bossAlive);
      case 'thorns': return asap ? !!t : this.mobs.length >= 6 || bossAlive;
      case 'acid': {
        if (asap) return !!t;
        if (t && t.boss) return true;
        const d = this.densestMob();
        return !!d && this.mobsInRadius(d.x, d.y, 90).length >= 4;
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
    // améliorations de l'ultime (compétences d'après-ultime)
    const UD = 1 + md(h, 'ultDmg'), UA = 1 + md(h, 'ultArea'), UT = md(h, 'ultDur'), UH = md(h, 'ultHeal'), UC = md(h, 'ultCount');
    switch (c.ult) {
      case 'whirl': {
        const r = 150 * UA;
        this.fx(['whirl', Math.round(h.x), Math.round(h.y), Math.round(r)]);
        for (const m of this.mobsInRadius(h.x, h.y, r)) this.damageMob(m, dmg * 2.5 * UD, h, {});
        break;
      }
      case 'charge': {
        const a = t ? Math.atan2(t.y - h.y, t.x - h.x) : h.facing;
        let ex = h.x + Math.cos(a) * 340 * UA, ey = h.y + Math.sin(a) * 340 * UA;
        const dx = ex - WORLD.CX, dy = ey - WORLD.CY, d = Math.hypot(dx, dy);
        if (d > h.leash) { ex = WORLD.CX + (dx / d) * h.leash; ey = WORLD.CY + (dy / d) * h.leash; }
        h.facing = a;
        h.dashing = { sx: h.x, sy: h.y, ex: U.clamp(ex, 16, WORLD.W - 16), ey: U.clamp(ey, 24, WORLD.H - 12), t: 0, dur: 0.4, hit: new Set(), dmg: h.baseDmg * 2 * UD * this.dmgMul(h) };
        break;
      }
      case 'frostcone': {
        // cône : 150 % des dégâts + gel
        const a = t ? Math.atan2(t.y - h.y, t.x - h.x) : h.facing, r = 330 * UA;
        h.facing = a;
        this.fx(['cone', Math.round(h.x), Math.round(h.y), Math.round(a * 100), Math.round(r)]);
        for (const m of this.mobsInRadius(h.x, h.y, r)) {
          if (Math.abs(U.angleDiff(Math.atan2(m.y - h.y, m.x - h.x), a)) < 0.62) this.damageMob(m, dmg * 1.5, h, { onHit: { freeze: 2.5 + UT } });
        }
        break;
      }
      case 'fireball':
        // 300 % des dégâts de base du héros en zone
        if (t) this.shoot({ kind: 'fireball', side: 'hero', x: h.x, y: h.y - 10, tx: t.x, ty: t.y, dmg: h.baseDmg * 3 * UD, explode: Math.round(150 * UA), speed: 520, owner: h, onHit: { burn: h.dmg * 0.4, dur: 4 } });
        break;
      case 'massheal':
        // tous les alliés : 75 % de leurs PV max (+ bouclier béni)
        this.fx(['healring', Math.round(h.x), Math.round(h.y), 900]);
        for (const o of this.heroes.values()) if (o.alive) { this.healHero(o, o.maxHp * (0.75 + UH)); if (UT > 0) o.buffs.shield = Math.max(o.buffs.shield || 0, UT); }
        for (const a of this.allies) if (!a.charmed) a.hp = Math.min(a.maxHp, a.hp + a.maxHp * (0.75 + UH));
        break;
      case 'beastcall':
        // soigne ses bêtes, +50 % de dégâts pendant 10 s
        h.buffs.beast = 10 + UT;
        this.fx(['healring', Math.round(h.x), Math.round(h.y), 200]);
        for (const a of this.allies) if (a.ownerId === h.id && !a.charmed) { a.hp = a.maxHp; this.fx(['text', Math.round(a.x), Math.round(a.y - 20), 'GRRR !', c.color]); }
        h.timers.summon = 0;
        break;
      case 'hawkstorm':
        // ses oiseaux sont soignés et foncent sur les ennemis : aveuglement définitif, +50 % de dégâts pendant 5 s
        h.buffs.raptor = 5 + UT;
        for (const a of this.allies) if (a.ownerId === h.id && !a.charmed) a.hp = a.maxHp;
        this.fx(['healring', Math.round(h.x), Math.round(h.y), 220]);
        h.timers.summon = 0;
        break;
      case 'revive': {
        // ramène un allié à 60 % de ses PV ; sinon relève 3 créatures
        let best = null;
        for (const o of this.heroes.values()) if (!o.alive && (!best || o.deadAt < best.deadAt)) best = o;
        if (best) {
          best.alive = true; best.zombie = false; best.status = {};
          best.hp = best.maxHp * Math.min(1, 0.6 + UH); best.x = best.deathX; best.y = best.deathY;
          this.fx(['revive', Math.round(best.x), Math.round(best.y)]);
          this.pushFeed(`💀 ${h.name} ramène ${best.name} à la vie !`);
        } else {
          const kinds = Object.keys(h.summonRanks || {});
          let total = this.allies.filter((a) => a.ownerId === h.id && !a.charmed).length;
          for (let i = 0; i < 3 && kinds.length && total < summonCap(h); i++, total++) this.spawnAlly(h, 'ally_' + U.pick(kinds), h.x, h.y);
        }
        break;
      }
      case 'rapidfire': h.buffs.rapid = 6 + UT; break;
      case 'tripleshot': {
        const a = t ? Math.atan2(t.y - h.y, t.x - h.x) : h.facing, n = 3 + UC;
        for (let i = 0; i < n; i++) this.shoot({ kind: 'arrow', side: 'hero', x: h.x, y: h.y - 10, angle: a + (i - (n - 1) / 2) * 0.12, tx: 0, ty: 0, dmg: dmg * 1.5 * UD, owner: h, speed: 850, pierce: 2, life: 0.7, homing: false, radius: 18 });
        break;
      }
      case 'smoke':
        this.zones.push({ kind: 'smoke', x: h.x, y: h.y, r: 170 * UA, t: 7 + UT });
        break;
      case 'chaindash':
        h.chain = { n: 0, wait: 0, max: 5 + UC, mult: 2.6 * UD };
        break;
      case 'anthem':
        // les hymnes ne se cumulent pas : la durée est renouvelée, le bonus le plus fort est gardé
        for (const o of this.heroes.values()) if (o.alive) { o.anthemDmg = Math.max(o.buffs.anthem > 0 ? o.anthemDmg || 0 : 0, 0.3 + md(h, 'ultDmg')); o.buffs.anthem = 8 + UT; }
        this.fx(['anthem', Math.round(h.x), Math.round(h.y)]);
        break;
      case 'thunder': {
        // autour du héros : 300 % des dégâts, étourdissement
        const r = 300 * UA;
        this.fx(['shock', Math.round(h.x), Math.round(h.y), Math.round(r), 2]);
        for (const m of this.mobsInRadius(h.x, h.y, r)) {
          if (m.boss) this.applyStatus(m, { slow: 0.5, dur: 2.5 });
          else if (!(m.thunderImm > this.time)) { this.applyStatus(m, { freeze: 2.5 }); m.thunderImm = this.time + 6.5; } // pas d'étourdissement en chaîne
          this.damageMob(m, dmg * 3 * UD, h, {});
        }
        break;
      }
      case 'enchant': {
        // les boss touchés sont seulement étourdis ; les autres monstres sont charmés
        const near = this.mobsInRadius(h.x, h.y, 320).filter((m) => m.hp > 0);
        for (const m of near) if (m.boss) { m.status.freeze = { t: 2.5 + UT * 0.5 }; this.fx(['text', Math.round(m.x), Math.round(m.y - m.size - 16), 'étourdi', '#ff7ad9']); }
        const cand = near.filter((m) => !m.boss).sort((a, b) => b.maxHp - a.maxHp).slice(0, 6 + UC);
        for (const m of cand) {
          this.mobs = this.mobs.filter((x) => x !== m);
          this.allies.push({
            nid: this.nid++, type: m.type, ownerId: h.id, x: m.x, y: m.y, maxHp: m.maxHp, hp: m.hp, size: m.size, speed: m.speed, range: Math.min(m.range, 60), cd: m.cd,
            atkT: 0, facing: m.facing, attackAnim: 0, target: null, retargetT: 0, offset: Math.random() * Math.PI * 2,
            charmed: { t: 10 + UT, mob: m }, power: Math.max(m.dmg * 2, h.dmg)
          });
          this.fx(['charm', Math.round(m.x), Math.round(m.y - m.size - 10)]);
        }
        if (cand.length) this.pushFeed(`💗 ${h.name} envoûte ${cand.length} monstre${cand.length > 1 ? 's' : ''} !`);
        break;
      }
      case 'frenzy':
        h.buffs.frenzy = 8 + UT; h.frenzyOn = true;
        this.fx(['text', Math.round(h.x), Math.round(h.y - 60), 'FRÉNÉSIE !', c.color]);
        break;
      case 'thorns': {
        // ralentit seulement (ne blesse plus), sur le flanc le plus menacé
        const m = this.nearestMob(WORLD.CX, WORLD.CY, 5000) || t;
        if (!m) break;
        const a = Math.atan2(m.y - WORLD.CY, m.x - WORLD.CX), d = Math.min(U.dist(m, { x: WORLD.CX, y: WORLD.CY }), 380);
        this.zones.push({ kind: 'thorns', x: WORLD.CX + Math.cos(a) * Math.max(160, d), y: WORLD.CY + Math.sin(a) * Math.max(160, d), r: 220 * UA, t: 10 + UT, owner: h });
        break;
      }
      case 'acid': {
        const spots = [];
        const pool = this.mobs.filter((m) => m.hp > 0);
        for (let i = 0; i < 5 + UC && pool.length; i++) {
          let best = null, bn = 0;
          for (let j = 0; j < pool.length; j += Math.max(1, (pool.length / 40) | 0)) {
            const m = pool[j];
            if (spots.some((s) => (s.x - m.x) ** 2 + (s.y - m.y) ** 2 < 150 * 150)) continue;
            const n = this.mobsInRadius(m.x, m.y, 90).length + (m.boss ? 10 : 0);
            if (n > bn) { bn = n; best = m; }
          }
          if (!best) break;
          spots.push({ x: best.x, y: best.y });
        }
        for (const s of spots) {
          this.zones.push({ kind: 'acid', x: s.x, y: s.y, r: 90, t: 6 + UT, owner: h });
          this.fx(['boom', Math.round(s.x), Math.round(s.y), 90, 2]);
        }
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
    if (!m || C.n >= (C.max || 5)) { h.chain = null; return; } // 5 enchaînements au plus (plus avec « Danse infinie »)
    C.n++;
    const killed = this.dashBehind(h, m, C.mult || 2.6);
    if (killed) C.wait = 0.16;
    else h.chain = null;
  }
};
