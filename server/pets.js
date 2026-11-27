'use strict';
/*
 * Familiers des mini-jeux (état dans u.pets = { list, active, main }) :
 *   - achetés au chenil avec des Grêlons, ou éclos d'un œuf (récompense d'élite rare, 30 min d'incubation) avec une rareté ;
 *   - 2 actifs par expédition ; leurs PV ne sont pas remis à neuf entre deux expéditions :
 *     ils remontent avec le temps (10 %/h). Un familier K.-O. se repose jusqu'à 50 % de ses PV ;
 *   - XP à chaque expédition, évolutions esthétiques aux niveaux 10 et 20 ;
 *   - le familier principal (niveau 10+) accompagne le héros sur le stream (purement esthétique).
 */
const GD = require('../shared/constants');
const { PETS } = GD;

class PetError extends Error {}
const fail = (msg) => { throw new PetError(msg); };

// Pas de régénération pendant l'expédition où le familier est engagé
function inRun(u, id) {
  const r = u.mini && u.mini.run;
  return !!(r && r.state !== 'over' && (r.pets || []).some((p) => p.id === id));
}

function ensure(u, now = Date.now()) {
  u.pets ||= {};
  const P = u.pets;
  P.list ||= []; P.active ||= []; P.eggs ||= []; if (P.main === undefined) P.main = null;
  for (const p of P.list) {
    const max = GD.petMaxHp(p.kind, p.rarity);
    if (p.hp === undefined) p.hp = max;
    if (!p.at) p.at = now;
    if (!inRun(u, p.id) && p.hp < max) {
      p.hp = Math.min(max, p.hp + (max * PETS.REGEN_PER_HOUR * Math.max(0, now - p.at)) / 3.6e6);
      if (p.ko && p.hp >= max * PETS.REST_PCT) p.ko = false;
    }
    p.at = now;
  }
  // un familier au repos ne peut pas rester actif
  P.active = P.active.filter((id) => P.list.some((p) => p.id === id && !p.ko));
  if (P.main && !P.list.some((p) => p.id === P.main && p.level >= PETS.MAIN_LEVEL)) P.main = null;
  return P;
}

function newPet(kind, rarity, zone) {
  return { id: 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36), kind, rarity: rarity || 0, zone: zone || null, xp: 0, level: 1, hp: GD.petMaxHp(kind, rarity), ko: false, at: Date.now() };
}

// Achat au chenil (Grêlons, une fois par animal)
function buy(u, kind) {
  const P = ensure(u);
  const K = PETS.KINDS[kind];
  if (!K || !K.kennel) fail('Animal inconnu');
  if (P.list.some((p) => p.kind === kind)) fail('Tu as déjà cet animal');
  if ((u.gold || 0) < PETS.KENNEL_PRICE) fail('Pas assez de Grêlons');
  u.gold -= PETS.KENNEL_PRICE;
  const p = newPet(kind, 0);
  P.list.push(p);
  if (P.active.length < PETS.ACTIVE_MAX) P.active.push(p.id);
  return p;
}

// Familiers actifs (2 au plus, pas au repos, pas pendant une expédition)
function setActive(u, ids) {
  const P = ensure(u);
  if (u.mini && u.mini.run && u.mini.run.state !== 'over') fail('Impossible pendant une expédition');
  const list = [...new Set((ids || []).map(String))].slice(0, PETS.ACTIVE_MAX);
  for (const id of list) {
    const p = P.list.find((x) => x.id === id);
    if (!p) fail('Familier inconnu');
    if (p.ko) fail(`${GD.petName(p.kind)} se repose encore`);
  }
  P.active = list;
  return P;
}

// Familier principal : accompagne le héros sur le stream (niveau 10 minimum)
function setMain(u, id) {
  const P = ensure(u);
  if (!id) { P.main = null; return P; }
  const p = P.list.find((x) => x.id === id);
  if (!p) fail('Familier inconnu');
  if (p.level < PETS.MAIN_LEVEL) fail(`Il faut un familier de niveau ${PETS.MAIN_LEVEL}`);
  P.main = id;
  return P;
}

// Œuf : un monstre de la zone (mini-jeu + décor), rareté au hasard. Doublon : meilleure rareté gardée,
// sinon converti en ressources de la zone (selon la rareté, 30 au plus).
function hatch(u, mode, tier, rnd = Math.random) {
  const P = ensure(u);
  const pool = GD.MINI.MODES[mode].mobs[Math.min(2, tier || 0)].filter((k) => PETS.KINDS[k]);
  const kind = pool[Math.floor(rnd() * pool.length)];
  const rarity = GD.rollRarity(rnd);
  const own = P.list.find((p) => p.kind === kind);
  const out = { kind, rarity, mode };
  if (!own) { const p = newPet(kind, rarity, mode); P.list.push(p); out.pet = p.id; out.result = 'new'; return out; }
  if (rarity > own.rarity) {
    const ratio = own.hp / GD.petMaxHp(own.kind, own.rarity);
    own.rarity = rarity; own.hp = Math.round(GD.petMaxHp(own.kind, rarity) * ratio);
    out.pet = own.id; out.result = 'upgrade'; return out;
  }
  const res = GD.MINI.MODES[mode].res, n = PETS.DUP_RES[rarity];
  u.mini.res[res] = (u.mini.res[res] || 0) + n;
  out.result = 'duplicate'; out.res = res; out.amount = n;
  return out;
}

// Œuf trouvé (récompense d'élite) : il éclot après INCUBATION_MIN minutes (delay en ms pour les tests / l'admin)
function addEgg(u, mode, tier, now = Date.now(), delay = PETS.INCUBATION_MIN * 60e3) {
  const P = ensure(u, now);
  const egg = { id: 'e' + now.toString(36) + Math.floor(Math.random() * 1e6).toString(36), mode, tier: Math.min(2, tier || 0), at: now, hatchAt: now + delay };
  P.eggs.push(egg);
  return egg;
}

// Éclosion d'un œuf prêt
function hatchEgg(u, id, rnd = Math.random, now = Date.now()) {
  const P = ensure(u, now);
  const egg = P.eggs.find((e) => e.id === id);
  if (!egg) fail('Œuf introuvable');
  if (now < egg.hatchAt) fail('Cet œuf n’est pas encore prêt à éclore');
  P.eggs = P.eggs.filter((e) => e !== egg);
  u.mini ||= {}; u.mini.res ||= { pierre: 0, bois: 0, baies: 0 };
  return hatch(u, egg.mode, egg.tier, rnd);
}

// Familiers engagés dans une expédition (copie de combat)
function forRun(u) {
  const P = ensure(u);
  return P.active.map((id) => P.list.find((p) => p.id === id)).filter((p) => p && !p.ko && p.hp > 0)
    .map((p) => ({ id: p.id, kind: p.kind, rarity: p.rarity, name: GD.petName(p.kind), hp: Math.round(p.hp), max: GD.petMaxHp(p.kind, p.rarity), healT: 0 }));
}

// Fin d'expédition : PV conservés (K.-O. → repos), XP gagnée ; renvoie les montées de niveau
function afterRun(u, run) {
  const P = ensure(u);
  const ups = [];
  for (const rp of run.pets || []) {
    const p = P.list.find((x) => x.id === rp.id);
    if (!p) continue;
    p.hp = Math.max(0, rp.hp); p.at = Date.now();
    if (p.hp <= 0) p.ko = true;
    if (p.level >= PETS.MAX_LEVEL) continue;
    p.xp += PETS.expeditionXp(run.room);
    const before = p.level;
    while (p.level < PETS.MAX_LEVEL && p.xp >= PETS.xpForLevel(p.level)) { p.xp -= PETS.xpForLevel(p.level); p.level++; }
    if (p.level >= PETS.MAX_LEVEL) p.xp = 0;
    if (p.level > before) ups.push({ name: GD.petName(p.kind), level: p.level, evolved: GD.petStage(p.level) > GD.petStage(before) });
  }
  P.active = P.active.filter((id) => P.list.some((p) => p.id === id && !p.ko));
  return ups;
}

function publicState(u, now = Date.now()) {
  const P = ensure(u, now);
  return {
    active: P.active, main: P.main, price: PETS.KENNEL_PRICE,
    eggs: P.eggs.map((e) => ({ ...e, readyIn: Math.max(0, e.hatchAt - now) })),
    list: P.list.map((p) => ({ ...p, hp: Math.floor(p.hp), max: GD.petMaxHp(p.kind, p.rarity), stage: GD.petStage(p.level), xpNext: PETS.xpForLevel(p.level),
      readyIn: p.ko ? Math.ceil(((GD.petMaxHp(p.kind, p.rarity) * PETS.REST_PCT - p.hp) / (GD.petMaxHp(p.kind, p.rarity) * PETS.REGEN_PER_HOUR)) * 3.6e6) : 0 }))
  };
}

// Apparence du familier principal sur le stream : [sprite, évolution] (ou null)
function streamLook(u) {
  const P = u && u.pets;
  if (!P || !P.main) return null;
  const p = P.list.find((x) => x.id === P.main);
  return p && p.level >= PETS.MAIN_LEVEL ? [GD.petSprite(p.kind), GD.petStage(p.level)] : null;
}

module.exports = { PetError, ensure, buy, setActive, setMain, hatch, addEgg, hatchEgg, forRun, afterRun, publicState, streamLook };
