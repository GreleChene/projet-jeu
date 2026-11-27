/*
 * Expéditions des mini-jeux (vue du dessus, temps réel) — partagé serveur / page / outils.
 *  - genRoom : contenu d'une salle, déterministe (même graine → même salle côté serveur et côté page)
 *  - sac / seau-charrette : cases de 15 ressources ou d'un butin de monstre
 *  - createSim / stepSim : simulation d'une salle (héros, parade, monstres, gardiens, projectiles,
 *    familiers, récolte, renforts). Utilisée par la page (le jeu) et par tools/sim/minijeux.js (bot).
 * Le serveur ne simule pas : il valide les rapports (monstres tués, récoltes, ramassages) et garde l'inventaire.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./constants'), require('./terrain'));
  else root.Expedition = factory(root.GameData, root.Terrain);
})(typeof self !== 'undefined' ? self : this, function (GD, T) {
  'use strict';
  const { MINI, MOBS } = GD;
  const A = MINI.ARENA, H = MINI.HERO;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const rngFor = (seed, room, salt) => T.mulberry32(((seed | 0) ^ Math.imul(room + 7, 2654435761) ^ Math.imul(salt + 3, 40503)) | 0);
  const SIDES = ['n', 'e', 's', 'w'];
  const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };
  const IN = { x0: A.WALL + 18, x1: A.W - A.WALL - 18, y0: A.WALL + 18, y1: A.H - A.WALL - 18 }; // intérieur jouable

  /* ============================== Génération des salles ============================== */
  // monstres de départ d'une salle normale ou riche, et délai des renforts (un peu plus long en profondeur)
  const startMobs = (room) => Math.min(MINI.MOBS_MAX, MINI.START_MOBS + Math.floor((room - 1) / MINI.MOBS_EVERY));
  const reinfAfter = (room) => MINI.REINFORCE.after + MINI.REINF_PER_MOB * (startMobs(room) - MINI.START_MOBS);
  function roomType(seed, room) {
    if (room % MINI.BOSS_EVERY === 0) return 'gardien';
    if (room % MINI.ELITE_EVERY === 0) return 'elite';
    if (room <= 1) return 'normal';
    const r = rngFor(seed, room, 11)(), RO = MINI.ROOMS;
    if (r < RO.repos.chance) return 'repos';
    if (r < RO.repos.chance + RO.riche.chance) return 'riche';
    return 'normal';
  }
  // Ouvertures (forêt, clairière) : on entre par le côté opposé à la sortie de la salle précédente
  function sidesFor(seed, room) {
    let entry = null, exit = null;
    for (let r = 1; r <= room; r++) {
      entry = r > 1 ? OPP[exit] : null;
      const opts = SIDES.filter((s) => s !== entry);
      exit = opts[Math.floor(rngFor(seed, r, 5)() * opts.length)];
    }
    return { entry, exit };
  }
  const sidePoint = (side, off, inset) => {
    const cx = A.W / 2 + off, cy = A.H / 2 + off * 0.6;
    if (side === 'n') return { x: cx, y: inset };
    if (side === 's') return { x: cx, y: A.H - inset };
    if (side === 'w') return { x: inset, y: cy };
    return { x: A.W - inset, y: cy };
  };
  const resKind = (mode) => GD.RES_IDS.indexOf(MINI.MODES[mode].res);

  // Statistiques d'un monstre selon la profondeur (les monstres du jeu servent de modèles)
  function mobStats(type, room, kind) {
    const d = MOBS[type];
    const boss = kind === 'boss', elite = kind === 'elite';
    const hpW = boss ? 1.4 : clamp(Math.sqrt(d.hp / 60), 0.6, 2), dmgW = boss ? 1.3 : clamp(Math.sqrt(d.dmg / 8), 0.7, 1.6);
    const hp = Math.round(30 * (1 + 0.16 * (room - 1)) * hpW * (boss ? 9 : elite ? 2.5 : 1));
    return {
      type, name: d.name + (elite ? ' d’élite' : ''), hp, max: hp, elite, boss,
      dmg: Math.round(9 * (1 + 0.09 * (room - 1)) * dmgW * (boss ? 1.4 : elite ? 1.3 : 1)),
      speed: Math.round(clamp(d.speed || 60, 50, 130) * 1.15 * (boss ? 0.85 : 1)),
      ranged: boss ? null : d.ranged || null,
      cd: Math.max(0.75, d.cd || 1),
      r: boss ? 30 : Math.round(clamp(d.size || 12, 9, 22) * (elite ? 1.35 : 1.05)),
      dot: d.onHit && (d.onHit.poison || d.onHit.burn) ? (d.onHit.burn ? 'burn' : 'poison') : null,
      xp: Math.round((boss ? 150 : d.xp || 5) * (1 + 0.12 * room) * (elite ? 5 : 1))
    };
  }

  // Contenu d'une salle. gen = améliorations figées au départ { luck, bounty, jackpot, fortune }
  function genRoom(mode, seed, room, gen) {
    gen = gen || {};
    const R = rngFor(seed, room, 1), M = MINI.MODES[mode], type = roomType(seed, room), RT = MINI.ROOMS[type];
    const tier = Math.min(2, Math.floor((room - 1) / MINI.DECOR_ROOMS));
    const { decor, sub } = GD.miniDecor(room, seed);
    const rnd = (a, b) => a + R() * (b - a);
    const sides = sidesFor(seed, room);
    const entry = M.exit === 'side' && sides.entry ? { ...sidePoint(sides.entry, 0, A.WALL + 46), side: sides.entry } : { x: A.W / 2, y: A.H / 2, side: null };
    const taken = [{ x: entry.x, y: entry.y, r: 110 }];
    const free = (r, minEntry) => {
      for (let k = 0; k < 80; k++) {
        const p = { x: rnd(IN.x0 + r + 10, IN.x1 - r - 10), y: rnd(IN.y0 + r + 10, IN.y1 - r - 10) };
        if (dist(p, entry) < (minEntry || 0)) continue;
        if (taken.some((q) => dist(p, q) < q.r + r + 14)) continue;
        taken.push({ ...p, r });
        return p;
      }
      const p = { x: rnd(IN.x0 + 40, IN.x1 - 40), y: rnd(IN.y0 + 40, IN.y1 - 40) };
      taken.push({ ...p, r });
      return p;
    };
    // sortie : une cavité au sol (caverne) ou une ouverture dans un des côtés (forêt, clairière)
    let exit;
    if (M.exit === 'hole') { const p = free(34, 260); exit = { kind: 'hole', x: p.x, y: p.y, r: 30 }; }
    else { const off = Math.round(rnd(-150, 150)); exit = { kind: 'side', side: sides.exit, off, ...sidePoint(sides.exit, off, A.WALL / 2), w: 110 }; taken.push({ ...sidePoint(sides.exit, off, A.WALL + 40), r: 70 }); }
    // fontaine (salle de repos)
    const fountain = type === 'repos' ? { ...free(40, 160), r: 34 } : null;
    // points de récolte
    const nN = Math.round(Math.floor(rnd(RT.nodes[0], RT.nodes[1] + 1)) * (1 + 0.08 * (gen.luck || 0)));
    const nodes = [];
    for (let i = 0; i < nN; i++) {
      const p = free(26, 90);
      const gold = R() < 0.04 * (gen.jackpot || 0) ? 1.5 + 0.5 * (gen.fortune || 0) : 0;
      nodes.push({ i, x: Math.round(p.x), y: Math.round(p.y), k: resKind(mode), r: 24, gold, amt: Math.max(2, Math.round((3.2 + 0.32 * (room - 1)) * (1 + 0.15 * (gen.bounty || 0)) * (gold || 1))) });
    }
    // monstres déjà présents dans la salle (avec leurs butins tirés d'avance)
    const T3 = M.trophies, pickC = () => T3.common[Math.floor(R() * T3.common.length)];
    const pool = M.mobs[tier], mobs = [];
    const add = (type2, kind) => {
      const st = mobStats(type2, room, kind), p = free(st.r + 6, kind === 'boss' ? 300 : 240);
      const D = MINI.DROPS;
      const drops = kind === 'boss' ? [T3.rare, ...Array.from({ length: D.bossCommons }, pickC)]
        : kind === 'elite' ? [...Array.from({ length: D.eliteCommons }, pickC), ...(R() < D.eliteRare ? [T3.rare] : [])]
          : R() < D.normal ? [pickC()] : [];
      if ((kind === 'boss' || kind === 'elite') && R() < D.petPotion[kind]) drops.push('fiole'); // potion de familier (rare)
      mobs.push({ i: mobs.length, ...st, x: Math.round(p.x), y: Math.round(p.y), drops, abil: kind === 'boss' ? M.bosses[tier].abil : null });
    };
    if (type === 'gardien') add(M.bosses[tier].type, 'boss');
    if (type === 'elite') add(pool[Math.floor(R() * pool.length)], 'elite');
    const nM = type === 'repos' ? 0 : type === 'gardien' ? 2 : type === 'elite' ? Math.min(3, 1 + Math.floor(room / 10)) : startMobs(room);
    for (let k = 0; k < nM; k++) add(pool[Math.floor(R() * pool.length)], '');
    // pas sous les panneaux d'informations de la page (en haut à gauche, au centre et à droite)
    taken.push({ x: 165, y: 75, r: 150 }, { x: A.W / 2, y: 40, r: 70 }, { x: A.W - 130, y: 55, r: 110 });
    const cp = free(30, 130), cart = { x: Math.round(cp.x), y: Math.round(cp.y) };
    return { mode, room, type, decor, sub, tier, seed, entry, exit, fountain, nodes, mobs, cart,
      exitDelay: RT.exit, boss: type === 'gardien' || type === 'elite' ? 0 : -1 };
  }

  // Renforts (et invocations des gardiens) : déterministes, numérotés à partir de REINF0 ; ils ne lâchent jamais de butin
  const REINF0 = 100;
  function reinfSpec(mode, seed, room, tier, idx) {
    const R = rngFor(seed, room, 1000 + idx), M = MINI.MODES[mode], pool = M.mobs[tier], T3 = M.trophies;
    const type = pool[Math.floor(R() * pool.length)];
    const p = sidePoint(SIDES[Math.floor(R() * 4)], (R() - 0.5) * 300, A.WALL + 30);
    return { i: REINF0 + idx, ...mobStats(type, room, ''), xp: 0, drops: [], reinf: true, x: Math.round(p.x), y: Math.round(p.y), abil: null };
  }
  // monstre d'une salle par son numéro (renforts compris)
  const mobAt = (R, i) => (i >= REINF0 ? reinfSpec(R.mode, R.seed, R.room, R.tier, i - REINF0) : R.mobs[i]);

  /* ============================== Sac et seau / charrette ============================== */
  const SLOT = MINI.HARVEST.slot;
  const carrySlots = (pets) => Math.round((pets || []).reduce((s, p) => s + (GD.petPower(p.kind, p.rarity).carry || 0), 0) * 30);
  const bagCap = (up, pets) => MINI.BAG.base + MINI.BAG.per * ((up || {}).sac || 0) + carrySlots(pets);
  const cartCap = (up) => MINI.CART.base + MINI.CART.per * ((up || {}).chariot || 0);
  const hasPocket = (up) => ((up || {}).sac || 0) >= MINI.UPGRADES.sac.max;
  // ajoute des ressources (piles de 15) ; renvoie la quantité réellement rangée
  function addRes(items, cap, res, n) {
    let left = n;
    for (const s of items) if (s.r === res && s.n < SLOT && left > 0) { const k = Math.min(SLOT - s.n, left); s.n += k; left -= k; }
    while (left > 0 && items.length < cap) { const k = Math.min(SLOT, left); items.push({ r: res, n: k }); left -= k; }
    return n - left;
  }
  const resRoom = (items, cap, res) => items.reduce((s, x) => s + (x.r === res ? SLOT - x.n : 0), 0) + (cap - items.length) * SLOT;
  function addTrophy(items, cap, t) { if (items.length >= cap) return false; items.push({ t }); return true; }
  // déplace une case (ou ce qui rentre) d'un contenant à l'autre
  function moveSlot(from, i, to, cap) {
    const s = from[i];
    if (!s) return false;
    if (s.t) { if (to.length >= cap) return false; to.push({ t: s.t }); from.splice(i, 1); return true; }
    const moved = addRes(to, cap, s.r, s.n);
    s.n -= moved;
    if (s.n <= 0) from.splice(i, 1);
    return moved > 0;
  }
  function moveAll(from, to, cap) { let any = false; for (let i = from.length - 1; i >= 0; i--) any = moveSlot(from, i, to, cap) || any; return any; }
  function totals(items) {
    const o = { res: {}, tro: {} };
    for (const s of items || []) { if (s.t) o.tro[s.t] = (o.tro[s.t] || 0) + 1; else o.res[s.r] = (o.res[s.r] || 0) + s.n; }
    return o;
  }
  // Mort : tout le non-renvoyé est perdu, sauf 25 % des ressources du sac (et la poche sécurisée en entier)
  function deathSplit(bag, pocket) {
    const kept = { res: {}, tro: {} }, lost = { res: {}, tro: {} };
    const val = (s) => (s.t ? (MINI.TROPHIES[s.t] && MINI.TROPHIES[s.t].rare ? 1e4 : 1e3) : s.n);
    const order = bag.map((s, i) => i).sort((a, b) => val(bag[b]) - val(bag[a]));
    const safe = new Set(pocket ? order.slice(0, MINI.BAG.pocket) : []);
    const resLeft = {};
    bag.forEach((s, i) => {
      if (safe.has(i)) { if (s.t) kept.tro[s.t] = (kept.tro[s.t] || 0) + 1; else kept.res[s.r] = (kept.res[s.r] || 0) + s.n; return; }
      if (s.t) { lost.tro[s.t] = (lost.tro[s.t] || 0) + 1; return; }
      resLeft[s.r] = (resLeft[s.r] || 0) + s.n;
    });
    for (const [r, n] of Object.entries(resLeft)) {
      const k = Math.floor(n * MINI.DEATH_KEEP);
      if (k) kept.res[r] = (kept.res[r] || 0) + k;
      if (n - k) lost.res[r] = (lost.res[r] || 0) + n - k;
    }
    return { kept, lost };
  }

  /* ============================== Simulation d'une salle ============================== */
  // style d'attaque selon la classe : corps à corps (arc), tir (projectile de la classe) ou magie (projectile + explosion)
  function heroStyle(cls) {
    const C = GD.CLASSES[cls] || GD.CLASSES.habitant, fam = GD.familyOf(cls);
    if (fam === 'mage' || fam === 'menestrel') return { style: 'magic', proj: C.projectile || 'orb' };
    if (C.projectile) return { style: 'shot', proj: C.projectile };
    return { style: 'melee', proj: null };
  }
  // o : { room, cls, hp, max, dmg, crit, armor, shield, buff, pets, potions, bag, bagCap, cart, killed, harv, picked, extra, rewardDone }
  function createSim(o) {
    const R = o.room, st = heroStyle(o.cls);
    const killed = new Set(o.killed || []), picked = o.picked || {}, harv = o.harv || {};
    const s = {
      t: 0, room: R, mode: R.mode, style: st.style, proj: st.proj, timeScale: 1,
      hero: { x: R.entry.x, y: R.entry.y, r: H.radius, hp: o.hp, max: o.max, dmg: o.dmg, crit: o.crit, armor: o.armor, buff: o.buff || { dmg: 0, crit: 0 },
        speed: o.speed || MINI.BASE.speed, haste: o.haste || 0, staminaMax: o.stamina || MINI.BASE.stamina, stamina: o.stamina || MINI.BASE.stamina, sprinting: false, restT: 9, shieldMax: o.shield, shield: o.shield, shieldUp: false, shieldAt: -9, broken: 0, idle: 9, atkCd: 0.3, skillCd: 0, face: 0, aimX: R.entry.x + 1, aimY: R.entry.y,
        iframes: 0, swing: 0, hurt: 0, moving: false, dead: false, guardUsed: false, lootFrac: 0 },
      mobs: R.mobs.map((m) => ({ ...m, home: { x: m.x, y: m.y }, aggro: false, wake: 0.6 + m.i * 0.25, cdT: 0.5 + Math.random() * 0.6, wind: 0, target: -1, retarget: 0, frozen: 0, stun: 0,
        mark: 0, markT: 0, weak: 0, weakT: 0, pdot: null, dead: killed.has(m.i), hit: 0, wander: Math.random() * 6, abilT: {}, act: null })),
      nodes: R.nodes.map((n) => ({ ...n, left: Math.max(0, n.amt - (harv[n.i] || 0)), shake: 0 })),
      drops: [], pets: [], projs: [], events: [], ops: [],
      exitOpen: false, exitAt: R.boss >= 0 ? (o.rewardDone ? 0 : Infinity) : R.exitDelay, exitOpenedAt: 0, reinfT: 0, reinfN: 0,
      fountainLeft: R.fountain ? MINI.FOUNTAIN.time : 0,
      bag: o.bag, bagCap: o.bagCap, cart: o.cart, potions: o.potions || 0, killed,
      needReward: false, dead: false, exitReached: false
    };
    // butins des monstres déjà tués (pas encore ramassés) et tas de ressources des récompenses
    for (const m of R.mobs) if (killed.has(m.i)) m.drops.forEach((t, j) => { const id = `m${m.i}_${j}`; if (!picked[id]) s.drops.push({ id, t, x: m.x + (j - 1) * 18, y: m.y + 10 }); });
    for (const i of killed) if (i >= REINF0) {
      const m = mobAt(R, i);
      s.reinfN = Math.max(s.reinfN, i - REINF0 + 1);
      m.drops.forEach((t, j) => { const id = `m${i}_${j}`; if (!picked[id]) s.drops.push({ id, t, x: m.x, y: m.y + 10 }); });
    }
    for (const x of o.extra || []) { const left = x.n - (picked[x.id] || 0); if (left > 0) s.drops.push({ id: x.id, r: x.res, n: left, x: x.x, y: x.y }); }
    // familiers
    (o.pets || []).forEach((p, i) => {
      const fx = GD.petPower(p.kind, p.rarity), M2 = MOBS[p.kind];
      s.pets.push({ ...p, idx: i, x: R.entry.x - 40 - i * 30, y: R.entry.y + 20, fx, ranged: !!fx.ranged, proj: fx.ranged ? (M2 && M2.ranged) || 'arrow' : null,
        atkCd: 1 + i * 0.4, healT: 4, aoeT: 3, harvT: 2, hurt: 0, swing: 0 });
    });
    // seau / charrette (s'il est là)
    if (s.cart) { const cp = R.cart || { x: R.entry.x - 60, y: R.entry.y + 30 }; s.cart.x = cp.x; s.cart.y = cp.y; s.cart.moving = false; }
    if (s.exitAt <= 0) openExit(s);
    return s;
  }
  const ev = (s, k, o) => { s.events.push({ k, ...(o || {}) }); };
  const petsAlive = (s) => s.pets.filter((p) => p.hp > 0);
  const fxSum = (s, k) => petsAlive(s).reduce((a, p) => a + (p.fx[k] || 0), 0);
  const heroDmg = (s) => s.hero.dmg * (1 + (s.hero.buff.dmg || 0) + fxSum(s, 'rally'));
  function openExit(s) { if (s.exitOpen) return; s.exitOpen = true; s.exitOpenedAt = s.t; ev(s, 'exit'); }

  function damageMob(s, m, dmg, o) {
    if (m.dead) return;
    const d = Math.max(1, Math.round(dmg * (1 + (m.mark || 0))));
    m.hp -= d; m.hit = 0.15; m.aggro = true;
    ev(s, 'dmg', { x: m.x, y: m.y - m.r * 2, n: d, crit: o && o.crit, pet: o && o.pet, parry: o && o.parry });
    if (m.hp <= 0) killMob(s, m);
  }
  function killMob(s, m) {
    m.dead = true; m.hp = 0;
    ev(s, 'kill', { x: m.x, y: m.y, boss: m.boss || m.elite });
    s.killed.add(m.i);
    m.drops.forEach((t, j) => s.drops.push({ id: `m${m.i}_${j}`, t, x: m.x + (j - (m.drops.length - 1) / 2) * 20, y: m.y + 8 }));
    if ((m.boss || m.elite) && s.room.boss >= 0) s.needReward = true;
  }
  // Coup reçu par le héros (src : { mob } ou { proj })
  function hurtHero(s, raw, src) {
    const h = s.hero;
    if (h.dead || h.iframes > 0) return 'none';
    if (h.shieldUp) {
      if (s.t - h.shieldAt <= MINI.SHIELD.parryWindow) { // parade parfaite : aucun dégât, coup renvoyé
        ev(s, 'parry', { x: h.x, y: h.y });
        if (src.mob && !src.proj) damageMob(s, src.mob, raw, { parry: true });
        return 'parry';
      }
      const b = Math.min(h.shield, raw);
      h.shield -= b; raw -= b; h.idle = 0;
      ev(s, 'block', { x: h.x, y: h.y, n: b });
      if (h.shield <= 0) { h.shieldUp = false; h.broken = MINI.SHIELD.breakTime; ev(s, 'shieldBreak', { x: h.x, y: h.y }); }
      if (raw <= 0) return 'block';
    }
    let d = Math.max(1, Math.round(raw * (1 - h.armor)));
    if (!h.guardUsed) {
      const g = Math.min(1, fxSum(s, 'guard'));
      if (g > 0) { h.guardUsed = true; const a = Math.round(d * g); d -= a; ev(s, 'guard', { x: h.x, y: h.y, n: a }); }
    }
    if (d <= 0) return 'guard';
    h.hp -= d; h.iframes = 0.25; h.hurt = 0.25;
    ev(s, 'hurt', { x: h.x, y: h.y, n: d });
    if (src.mob && src.mob.dot && Math.random() < 0.5) h.dot = { k: src.mob.dot, dps: Math.max(1, src.mob.dmg * 0.15), t: 2 };
    if (h.hp <= 0) { h.hp = 0; h.dead = true; s.dead = true; ev(s, 'death', { x: h.x, y: h.y }); }
    return 'hit';
  }
  function hurtPet(s, p, raw) {
    if (p.hp <= 0) return;
    p.hp = Math.max(0, Math.round(p.hp - raw)); p.hurt = 0.25;
    ev(s, 'petHurt', { x: p.x, y: p.y, n: Math.round(raw), ko: p.hp <= 0 });
  }
  // cible d'un monstre : le héros, ou parfois un familier (20 %, plus avec la provocation ; à distance : seulement les tireurs)
  function chooseTarget(s, m) {
    const ok = petsAlive(s).filter((p) => !p.ranged || m.ranged);
    const chance = Math.min(0.6, GD.PETS.HIT_CHANCE + ok.reduce((a, p) => a + (p.fx.taunt || 0), 0));
    if (ok.length && Math.random() < chance) {
      const w = ok.map((p) => 1 + 4 * (p.fx.taunt || 0));
      let x = Math.random() * w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < ok.length; i++) { x -= w[i]; if (x <= 0) return ok[i].idx; }
      return ok[ok.length - 1].idx;
    }
    return -1;
  }
  const targetOf = (s, m) => (m.target >= 0 && s.pets[m.target] && s.pets[m.target].hp > 0 ? s.pets[m.target] : s.hero);
  function moveToward(u, tx, ty, sp, dt, stop) {
    const dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy);
    if (d <= (stop || 0) || d < 0.5) return false;
    const k = Math.min(d - (stop || 0), sp * dt) / d;
    u.x += dx * k; u.y += dy * k;
    return true;
  }
  // garde les corps dans l'arène et hors des points de récolte
  function keepIn(s, u, r) {
    u.x = clamp(u.x, IN.x0 + r - 18, IN.x1 - r + 18); u.y = clamp(u.y, IN.y0 + r - 18, IN.y1 - r + 18);
    const C = s.cart;
    if (C && C.here && C.x !== undefined && u !== C) {
      const dx = u.x - C.x, dy = u.y - C.y, d = Math.hypot(dx, dy), m = 20 + r - 4;
      if (d < m && d > 0.01) { u.x = C.x + (dx / d) * m; u.y = C.y + (dy / d) * m; }
    }
    for (const n of s.nodes) {
      if (n.left <= 0) continue;
      const dx = u.x - n.x, dy = u.y - n.y, d = Math.hypot(dx, dy), m = n.r + r - 4;
      if (d < m && d > 0.01) { u.x = n.x + (dx / d) * m; u.y = n.y + (dy / d) * m; }
    }
  }
  function shoot(s, owner, x, y, tx, ty, o) {
    const a = Math.atan2(ty - y, tx - x), sp = o.speed;
    s.projs.push({ owner, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: o.range / sp, dmg: o.dmg, kind: o.kind, crit: o.crit, src: o.src, pet: o.pet, r: o.r || 8, scale: o.scale || 1 });
  }
  function spawnReinf(s, n) {
    for (let k = 0; k < n; k++) {
      const m = reinfSpec(s.mode, s.room.seed, s.room.room, s.room.tier, s.reinfN++);
      s.mobs.push({ ...m, home: { x: m.x, y: m.y }, aggro: true, cdT: 1, wind: 0, target: -1, retarget: 0,
        frozen: 0, stun: 0, mark: 0, markT: 0, weak: 0, weakT: 0, pdot: null, dead: false, hit: 0, wander: 0, abilT: {}, act: null });
    }
    ev(s, 'reinforce');
  }

  // input : { mx, my (déplacement -1..1), ax, ay (visée, coordonnées de l'arène), attack, shield (maintenus), skill, potion (appuis) }
  function stepSim(s, dtReal, input) {
    const dt = Math.min(0.05, dtReal) * (s.timeScale == null ? 1 : s.timeScale);
    if (dt <= 0 || s.dead || s.exitReached) return;
    s.t += dt;
    const h = s.hero, inp = input || {};
    /* --- héros --- */
    h.iframes = Math.max(0, h.iframes - dt); h.hurt = Math.max(0, h.hurt - dt); h.swing = Math.max(0, h.swing - dt);
    h.atkCd -= dt; h.skillCd -= dt; h.broken = Math.max(0, h.broken - dt);
    if (h.dot) { h.dot.t -= dt; h.hp -= h.dot.dps * dt; if (h.dot.t <= 0) h.dot = null; if (h.hp <= 0) { h.hp = 0; h.dead = true; s.dead = true; ev(s, 'death', { x: h.x, y: h.y }); return; } }
    // bouclier (clic droit maintenu) : parade parfaite si un coup arrive juste après l'avoir levé
    if (inp.shield && h.broken <= 0 && h.shield > 0) { if (!h.shieldUp) { h.shieldUp = true; h.shieldAt = s.t; ev(s, 'raise'); } }
    else h.shieldUp = false;
    if (!h.shieldUp) { h.idle += dt; if (h.idle > MINI.SHIELD.regenDelay) h.shield = Math.min(h.shieldMax, h.shield + h.shieldMax * MINI.SHIELD.regen * dt); }
    // déplacement
    let mx = inp.mx || 0, my = inp.my || 0;
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    // sprint (Maj) : ×1,5 tant qu'il reste de l'endurance ; elle remonte après une courte pause
    const SP = MINI.SPRINT;
    h.sprinting = !!inp.sprint && ml > 0.1 && !h.shieldUp && h.stamina > (h.sprinting ? 0 : SP.min);
    if (h.sprinting) { h.stamina = Math.max(0, h.stamina - SP.drain * dt); h.restT = 0; }
    else { h.restT += dt; if (h.restT > SP.delay) h.stamina = Math.min(h.staminaMax, h.stamina + SP.regen * dt); }
    const sp = h.speed * (h.shieldUp ? MINI.SHIELD.slow : 1) * (h.sprinting ? SP.mult : 1);
    h.x += mx * sp * dt; h.y += my * sp * dt; h.moving = ml > 0.1;
    // la sortie (ouverture d'un côté) permet de franchir le mur
    const ex = s.room.exit;
    if (s.exitOpen && ex.kind === 'side') {
      const along = ex.side === 'n' || ex.side === 's' ? Math.abs(h.x - ex.x) : Math.abs(h.y - ex.y);
      const out = ex.side === 'n' ? h.y < A.WALL : ex.side === 's' ? h.y > A.H - A.WALL : ex.side === 'w' ? h.x < A.WALL : h.x > A.W - A.WALL;
      if (along < ex.w / 2 - 8 && out) { s.exitReached = true; ev(s, 'leave'); return; }
      if (along < ex.w / 2 - 8) { h.x = clamp(h.x, 4, A.W - 4); h.y = clamp(h.y, 4, A.H - 4); } else keepIn(s, h, h.r);
    } else keepIn(s, h, h.r);
    if (s.exitOpen && ex.kind === 'hole' && dist(h, ex) < ex.r - 4) { s.exitReached = true; ev(s, 'leave'); return; }
    if (inp.ax !== undefined) { h.aimX = inp.ax; h.aimY = inp.ay; }
    h.face = Math.atan2(h.aimY - h.y, h.aimX - h.x);
    // attaque / récolte (même bouton)
    if (inp.attack && h.atkCd <= 0 && !h.shieldUp) {
      const node = harvestTarget(s);
      if (node) harvest(s, node);
      else attack(s);
    }
    // compétence (E)
    if (inp.skill && h.skillCd <= 0 && !h.shieldUp) skill(s);
    // potion (A)
    if (inp.potion && s.potions > 0 && h.hp < h.max) {
      s.potions--; h.hp = Math.min(h.max, h.hp + Math.round(h.max * MINI.POTION_HEAL)); s.ops.push(['pot']);
      ev(s, 'potion', { x: h.x, y: h.y });
    }
    // fontaine (salle de repos)
    const F = s.room.fountain;
    if (F && s.fountainLeft > 0 && dist(h, F) < F.r + 40 && h.hp < h.max) {
      const k = Math.min(dt, s.fountainLeft);
      s.fountainLeft -= k; h.hp = Math.min(h.max, h.hp + MINI.FOUNTAIN.hps * k);
      if (Math.random() < dt * 4) ev(s, 'heal', { x: h.x, y: h.y });
    }
    // ramassage des butins et des tas de ressources
    for (let i = s.drops.length - 1; i >= 0; i--) {
      const d = s.drops[i];
      if (dist(h, d) > h.r + 16) continue;
      if (d.t) {
        if (addTrophy(s.bag, s.bagCap, d.t)) { s.ops.push(['p', d.id, 1]); s.drops.splice(i, 1); ev(s, 'pickup', { x: d.x, y: d.y, t: d.t }); }
        else bagFull(s);
      } else {
        const got = addRes(s.bag, s.bagCap, d.r, d.n);
        if (got > 0) { s.ops.push(['p', d.id, got]); d.n -= got; ev(s, 'pickup', { x: d.x, y: d.y, r: d.r, n: got }); if (d.n <= 0) s.drops.splice(i, 1); }
        else bagFull(s);
      }
    }
    /* --- seau / charrette : suit le héros --- */
    /* --- monstres --- */
    for (const m of s.mobs) if (!m.dead) stepMob(s, m, dt);
    // les monstres ne s'empilent pas
    const alive = s.mobs.filter((m) => !m.dead);
    for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i], b = alive[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, m = (a.r + b.r) * 0.9;
      if (d < m) { const k = (m - d) / 2 / d; a.x -= dx * k; a.y -= dy * k; b.x += dx * k; b.y += dy * k; }
    }
    /* --- familiers --- */
    for (const p of s.pets) stepPet(s, p, dt);
    /* --- projectiles --- */
    stepProjs(s, dt);
    /* --- sortie et renforts --- */
    if (!s.exitOpen && s.t >= s.exitAt) openExit(s);
    // renforts : 20 s après l'entrée dans la salle, puis toutes les 5 s ; jamais en salle d'élite ou de gardien
    if (s.room.boss < 0 && s.t >= reinfAfter(s.room.room) && s.t >= s.reinfT) { const R2 = MINI.REINFORCE; s.reinfT = s.t + R2.every; spawnReinf(s, R2.count); }
  }
  function bagFull(s) { if (!s.fullT || s.t > s.fullT) { s.fullT = s.t + 1.2; ev(s, 'bagfull', { x: s.hero.x, y: s.hero.y }); } }

  // point de récolte visé : sous le curseur, ou devant le héros, à portée
  function harvestTarget(s) {
    const h = s.hero;
    let best = null, bd = Infinity;
    for (const n of s.nodes) {
      if (n.left <= 0) continue;
      const dh = dist(h, n);
      if (dh > H.harvestReach + n.r * 0.5) continue;
      const dAim = Math.hypot(h.aimX - n.x, h.aimY - n.y);
      const ang = Math.abs(Math.atan2(Math.sin(Math.atan2(n.y - h.y, n.x - h.x) - h.face), Math.cos(Math.atan2(n.y - h.y, n.x - h.x) - h.face)));
      if (dAim > n.r + 34 && ang > 0.8) continue;
      // un monstre plus proche dans la même direction passe avant la récolte
      if (s.mobs.some((m) => !m.dead && dist(h, m) < dh && Math.hypot(h.aimX - m.x, h.aimY - m.y) < m.r + 30)) continue;
      if (dAim < bd) { bd = dAim; best = n; }
    }
    return best;
  }
  function harvest(s, n) {
    const h = s.hero, res = GD.RES_IDS[n.k];
    h.atkCd = H.atkCd / (1 + h.haste); h.swing = 0.22;
    h.lootFrac += MINI.HARVEST.perHit * (1 + fxSum(s, 'loot'));
    const want = Math.min(n.left, Math.floor(h.lootFrac));
    if (want <= 0) return;
    const got = addRes(s.bag, s.bagCap, res, want);
    if (got <= 0) { h.lootFrac = Math.min(h.lootFrac, MINI.HARVEST.perHit); return bagFull(s); }
    h.lootFrac -= got; n.left -= got; n.shake = 0.2;
    s.ops.push(['h', n.i, got]);
    ev(s, 'harvest', { x: n.x, y: n.y, r: res, n: got, gold: !!n.gold });
    if (n.left <= 0) ev(s, 'depleted', { x: n.x, y: n.y });
  }
  function attack(s) {
    const h = s.hero, crit = Math.random() < h.crit + (h.buff.crit || 0), dmg = heroDmg(s) * (crit ? 2 : 1);
    if (s.style === 'melee') {
      h.atkCd = H.atkCd / (1 + h.haste); h.swing = 0.22;
      ev(s, 'swing', { x: h.x, y: h.y, a: h.face });
      for (const m of s.mobs) {
        if (m.dead) continue;
        const d = dist(h, m), a = Math.atan2(m.y - h.y, m.x - h.x), da = Math.abs(Math.atan2(Math.sin(a - h.face), Math.cos(a - h.face)));
        if (d <= H.meleeRange + m.r && (da <= H.meleeArc || d < m.r + h.r + 6)) damageMob(s, m, dmg, { crit });
      }
    } else {
      h.atkCd = H.shotCd / (1 + h.haste); h.swing = 0.18;
      ev(s, 'shoot', { x: h.x, y: h.y });
      shoot(s, 'hero', h.x + Math.cos(h.face) * 16, h.y - 18 + Math.sin(h.face) * 16, h.aimX, h.aimY - 18, { speed: H.shotSpeed, range: H.shotRange, dmg: dmg * H.shotDmg, kind: s.proj, crit });
    }
  }
  function skill(s) {
    const h = s.hero, base = heroDmg(s);
    h.skillCd = H.skillCd; h.swing = 0.3;
    if (s.style === 'melee') { // tourbillon autour du héros
      ev(s, 'skill', { kind: 'whirl', x: h.x, y: h.y, r: 95 });
      for (const m of s.mobs) if (!m.dead && dist(h, m) <= 95 + m.r) damageMob(s, m, base * 2.2, {});
    } else if (s.style === 'shot') { // volée de 3 projectiles en éventail
      ev(s, 'skill', { kind: 'volley', x: h.x, y: h.y });
      for (let k = -1; k <= 1; k++) {
        const a = h.face + k * 0.16;
        shoot(s, 'hero', h.x, h.y - 18, h.x + Math.cos(a) * 300, h.y - 18 + Math.sin(a) * 300, { speed: H.shotSpeed, range: H.shotRange, dmg: base * 1.1 * H.shotDmg, kind: s.proj, scale: 1.4 });
      }
    } else { // explosion là où l'on vise
      const d = Math.min(300, Math.hypot(h.aimX - h.x, h.aimY - h.y)), x = h.x + Math.cos(h.face) * d, y = h.y + Math.sin(h.face) * d;
      ev(s, 'skill', { kind: 'nova', x, y, r: 95 });
      for (const m of s.mobs) if (!m.dead && Math.hypot(m.x - x, m.y - y) <= 95 + m.r) damageMob(s, m, base * 2 * H.shotDmg, {});
    }
  }

  function stepMob(s, m, dt) {
    m.hit = Math.max(0, m.hit - dt);
    if (m.markT > 0 && (m.markT -= dt) <= 0) m.mark = 0;
    if (m.weakT > 0 && (m.weakT -= dt) <= 0) m.weak = 0;
    if (m.pdot) { m.pdot.t -= dt; m.pdot.acc = (m.pdot.acc || 0) + m.pdot.dps * dt; if (m.pdot.acc >= 1) { const n = Math.floor(m.pdot.acc); m.pdot.acc -= n; m.hp -= n; if (m.hp <= 0) { killMob(s, m); return; } } if (m.pdot.t <= 0) m.pdot = null; }
    if (m.frozen > 0) { m.frozen -= dt; m.wind = 0; return; }
    if (m.stun > 0) { m.stun -= dt; m.wind = 0; return; }
    const h = s.hero;
    if (!m.aggro) {
      if (dist(m, h) < 280 || m.hit > 0 || s.t >= m.wake) { m.aggro = true; m.target = chooseTarget(s, m); ev(s, 'aggro', { x: m.x, y: m.y }); }
      else { m.wander += dt; moveToward(m, m.home.x + Math.cos(m.wander * 0.7) * 40, m.home.y + Math.sin(m.wander * 0.9) * 30, m.speed * 0.25, dt); keepIn(s, m, m.r); return; }
    }
    if ((m.retarget -= dt) <= 0) { m.retarget = 3; m.target = chooseTarget(s, m); }
    const tg = targetOf(s, m), d = dist(m, tg);
    m.cdT -= dt;
    // capacités des gardiens (charge, onde de choc, salve, invocation)
    if (m.boss && bossAbility(s, m, dt, tg)) { keepIn(s, m, m.r); return; }
    const reach = m.r + (tg.r || 14) + 22;
    if (m.wind > 0) {
      m.wind -= dt;
      if (m.wind <= 0) {
        m.cdT = m.cd;
        const dmg = m.dmg * (1 - (m.weak || 0));
        if (m.ranged) { ev(s, 'mobShoot', { x: m.x, y: m.y }); shoot(s, 'mob', m.x, m.y - m.r, tg.x, tg.y - 16, { speed: 240, range: 520, dmg, kind: m.ranged, src: m }); }
        else if (dist(m, tg) <= reach + 18) { if (tg === h) hurtHero(s, dmg, { mob: m }); else hurtPet(s, tg, dmg); m.act = 0.2; }
      }
    } else if (m.ranged) {
      if (d > 260) moveToward(m, tg.x, tg.y, m.speed, dt);
      else if (d < 150) moveToward(m, m.x + (m.x - tg.x), m.y + (m.y - tg.y), m.speed * 0.8, dt);
      if (m.cdT <= 0 && d < 420) { m.wind = 0.35; ev(s, 'windup', { x: m.x, y: m.y - m.r * 2 }); }
    } else {
      if (d > reach) moveToward(m, tg.x, tg.y, m.speed, dt, reach - 4);
      else if (m.cdT <= 0) { m.wind = 0.45; ev(s, 'windup', { x: m.x, y: m.y - m.r * 2 }); }
    }
    m.act = Math.max(0, (m.act || 0) - dt);
    keepIn(s, m, m.r);
    // le héros n'est pas traversé
    const dh = dist(m, h), mm = m.r + h.r;
    if (dh < mm && dh > 0.01) { m.x = h.x + ((m.x - h.x) / dh) * mm; m.y = h.y + ((m.y - h.y) / dh) * mm; }
  }
  // renvoie true si le gardien est occupé par une capacité
  function bossAbility(s, m, dt, tg) {
    const B = m.abilT, h = s.hero;
    if (m.cast) {
      const c = m.cast;
      c.t -= dt;
      if (c.kind === 'charge' && c.t <= 0 && c.phase === 0) { c.phase = 1; c.t = 0.5; }
      if (c.kind === 'charge' && c.phase === 1) {
        m.x += Math.cos(c.a) * 520 * dt; m.y += Math.sin(c.a) * 520 * dt;
        if (!c.hitDone && dist(m, h) < m.r + h.r + 6) { c.hitDone = true; hurtHero(s, m.dmg * 1.5, { mob: m }); }
        if (c.t <= 0) m.cast = null;
        return true;
      }
      if (c.t <= 0) {
        if (c.kind === 'slam') {
          ev(s, 'slam', { x: m.x, y: m.y, r: 120 });
          if (dist(m, h) <= 120 + h.r) hurtHero(s, m.dmg * 1.3, { mob: m, proj: true });
          for (const p of petsAlive(s)) if (dist(m, p) <= 120) hurtPet(s, p, m.dmg * 1.3);
        }
        m.cast = null;
      }
      return true;
    }
    for (const a of m.abil) {
      const every = { slam: 6, charge: 7, volley: 4.5, summon: 11 }[a];
      if (B[a] === undefined) B[a] = every * (0.5 + Math.random() * 0.5);
      B[a] -= dt;
      if (B[a] > 0) continue;
      B[a] = every;
      if (a === 'slam') { m.cast = { kind: 'slam', t: 0.9, x: m.x, y: m.y, r: 120 }; ev(s, 'telegraph', { kind: 'slam' }); return true; }
      if (a === 'charge') { m.cast = { kind: 'charge', t: 0.7, phase: 0, a: Math.atan2(h.y - m.y, h.x - m.x) }; ev(s, 'telegraph', { kind: 'charge' }); return true; }
      if (a === 'volley') { ev(s, 'mobShoot', { x: m.x, y: m.y }); const base = Math.atan2(tg.y - m.y, tg.x - m.x); for (let k = -2; k <= 2; k++) shoot(s, 'mob', m.x, m.y - m.r, m.x + Math.cos(base + k * 0.22) * 300, m.y - m.r + Math.sin(base + k * 0.22) * 300, { speed: 230, range: 560, dmg: m.dmg * 0.6, kind: MOBS[m.type].ranged || 'fire', src: m }); }
      if (a === 'summon' && s.mobs.filter((x) => !x.dead).length < 6) spawnReinf(s, 2);
    }
    return false;
  }

  function stepPet(s, p, dt) {
    p.hurt = Math.max(0, p.hurt - dt); p.swing = Math.max(0, p.swing - dt);
    if (p.hp <= 0) return;
    const h = s.hero;
    // cible : le monstre éveillé le plus proche du héros
    let tg = null, bd = 240;
    for (const m of s.mobs) if (!m.dead && m.aggro) { const d = dist(m, h); if (d < bd) { bd = d; tg = m; } }
    const fx = p.fx;
    const spot = { x: h.x - Math.cos(h.face) * (40 + p.idx * 34) + (p.idx ? 18 : -18), y: h.y - Math.sin(h.face) * (40 + p.idx * 34) + 12 };
    if (tg && (fx.bite || fx.poison || fx.burn || fx.mark || fx.weaken || fx.freeze || fx.stun)) {
      if (p.ranged) { const d = dist(p, tg); if (d > 220) moveToward(p, tg.x, tg.y, 190, dt); else moveToward(p, spot.x, spot.y, 150, dt, 20); }
      else moveToward(p, tg.x, tg.y, 200, dt, tg.r + 16);
      p.atkCd -= dt;
      if (p.atkCd <= 0 && dist(p, tg) <= (p.ranged ? 260 : tg.r + 30)) {
        p.atkCd = p.ranged ? 1.4 : 1.2; p.swing = 0.2;
        if (p.ranged) { ev(s, 'shoot', { x: p.x, y: p.y, pet: true }); shoot(s, 'pet', p.x, p.y - 14, tg.x, tg.y - 14, { speed: 420, range: 420, dmg: 0, kind: p.proj, pet: p, src: tg }); }
        else petHit(s, p, tg);
      }
    } else moveToward(p, spot.x, spot.y, 200, dt, 14);
    // frappe de zone
    if (fx.aoe && (p.aoeT -= dt) <= 0) { p.aoeT = 3; let any = false; for (const m of s.mobs) if (!m.dead && dist(p, m) < 120) { any = true; damageMob(s, m, heroDmg(s) * fx.aoe, { pet: true }); } if (any) ev(s, 'petAoe', { x: p.x, y: p.y, r: 120 }); }
    // soin du héros
    if (fx.heal && (p.healT -= dt) <= 0) { p.healT = 4; if (h.hp < h.max) { const n = Math.max(1, Math.round(h.max * fx.heal)); h.hp = Math.min(h.max, h.hp + n); ev(s, 'petHeal', { x: h.x, y: h.y, n }); } }
    // récolte automatique (écureuil, mulot)
    if (fx.sniff && (p.harvT -= dt) <= 0) {
      p.harvT = 2;
      const n = s.nodes.find((q) => q.left > 0 && dist(q, p) < q.r + 60);
      if (n) { const got = addRes(s.bag, s.bagCap, GD.RES_IDS[n.k], 1); if (got) { n.left -= got; n.shake = 0.15; s.ops.push(['h', n.i, got]); ev(s, 'harvest', { x: n.x, y: n.y, r: GD.RES_IDS[n.k], n: got, pet: true }); if (n.left <= 0) ev(s, 'depleted', { x: n.x, y: n.y }); } }
    }
    keepIn(s, p, 12);
  }
  function petHit(s, p, m) {
    if (m.dead) return;
    const fx = p.fx, base = heroDmg(s);
    if (fx.mark) { m.mark = Math.max(m.mark || 0, fx.mark); m.markT = 4; }
    if (fx.bite) damageMob(s, m, base * fx.bite, { pet: true });
    if (m.dead) return;
    if (fx.poison || fx.burn) m.pdot = { k: fx.burn ? 'burn' : 'poison', dps: base * (fx.poison || fx.burn), t: 2 };
    if (fx.weaken) { m.weak = Math.max(m.weak || 0, fx.weaken); m.weakT = 4; }
    if (fx.freeze && Math.random() < fx.freeze) { m.frozen = 1.2; ev(s, 'status', { x: m.x, y: m.y - m.r * 2, s: '❄️' }); }
    if (fx.stun && Math.random() < fx.stun) { m.stun = 1; ev(s, 'status', { x: m.x, y: m.y - m.r * 2, s: '💫' }); }
  }
  function stepProjs(s, dt) {
    const h = s.hero;
    for (let i = s.projs.length - 1; i >= 0; i--) {
      const q = s.projs[i];
      q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt;
      let done = q.life <= 0 || q.x < 10 || q.x > A.W - 10 || q.y < 10 || q.y > A.H - 10;
      if (!done && (q.owner === 'hero' || q.owner === 'pet')) {
        for (const m of s.mobs) {
          if (m.dead || Math.hypot(m.x - q.x, m.y - m.r - q.y) > m.r + q.r) continue;
          if (q.owner === 'pet') petHit(s, q.pet, m); else damageMob(s, m, q.dmg, { crit: q.crit, parry: q.reflected });
          done = true; break;
        }
      } else if (!done) {
        if (Math.hypot(h.x - q.x, h.y - 16 - q.y) < h.r + q.r) {
          const r = hurtHero(s, q.dmg, { mob: q.src, proj: true });
          if (r === 'parry') { q.owner = 'hero'; q.vx = -q.vx * 1.3; q.vy = -q.vy * 1.3; q.life = 2; q.reflected = true; continue; } // projectile renvoyé
          done = true;
        } else {
          for (const p of petsAlive(s)) { if (Math.hypot(p.x - q.x, p.y - 12 - q.y) < 16 + q.r) { hurtPet(s, p, q.dmg); done = true; break; } }
        }
      }
      if (done) { s.projs.splice(i, 1); ev(s, 'impact', { x: q.x, y: q.y, kind: q.kind }); }
    }
  }
  // monstres présents au départ de la salle encore en vie (il faut les éliminer pour pouvoir rentrer)
  const startMobsLeft = (s) => s.mobs.filter((m) => !m.dead && !m.reinf).length;
  const nearCart = (s) => !!(s.cart && s.cart.here && s.cart.x !== undefined && dist(s.hero, s.cart) < 80);

  return { roomType, sidesFor, genRoom, mobStats, bagCap, cartCap, hasPocket, carrySlots, addRes, resRoom, addTrophy, moveSlot, moveAll, totals, deathSplit,
    heroStyle, createSim, stepSim, startMobs, reinfAfter, nearCart, startMobsLeft, openExit, SLOT, REINF0, reinfSpec, mobAt };
});
