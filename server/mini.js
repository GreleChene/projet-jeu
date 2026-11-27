'use strict';
/*
 * Mini-jeux solo (onglet « Mini-jeux ») : expéditions tour par tour, de salle en salle.
 *   - mine (pierre), forêt (bois), champ de baies (baies) ; une expédition coûte 1 énergie (1 toutes les 6 h, 3 au plus)
 *   - chaque salle : du butin, ou des monstres (1 ressource et de l'XP par monstre tué)
 *   - toutes les 5 salles : un monstre d'élite et un choix de récompense
 *   - toutes les 3 salles : remonter avec son butin, ou continuer (mort = 75 % des ressources perdues)
 * L'état de l'expédition est gardé dans le profil (u.mini.run) : on peut fermer la page et reprendre.
 */
const GD = require('../shared/constants');
const pets = require('./pets');
const { MINI } = GD;
const ENERGY_MS = MINI.ENERGY_HOURS * 3600e3;

class MiniError extends Error {}
const fail = (msg) => { throw new MiniError(msg); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];

// Familiers engagés encore debout, et somme d'un effet sur eux
const alivePets = (run) => (run.pets || []).filter((p) => p.hp > 0);
const petFx = (p) => GD.petPower(p.kind, p.rarity);
const fxSum = (run, k) => alivePets(run).reduce((s, p) => s + (petFx(p)[k] || 0), 0);

// Données mini-jeux du profil, avec régénération de l'énergie
function ensure(u, now = Date.now()) {
  u.mini ||= {};
  const m = u.mini;
  m.res = { pierre: 0, bois: 0, baies: 0, ...(m.res || {}) };
  m.up ||= {};
  m.best ||= {};
  if (m.energy === undefined) { m.energy = MINI.ENERGY_MAX; m.energyAt = now; }
  if (m.energy >= MINI.ENERGY_MAX) m.energyAt = now;
  else {
    const g = Math.floor((now - m.energyAt) / ENERGY_MS);
    if (g > 0) {
      m.energy = Math.min(MINI.ENERGY_MAX, m.energy + g);
      m.energyAt = m.energy >= MINI.ENERGY_MAX ? now : m.energyAt + g * ENERGY_MS;
    }
  }
  return m;
}

function log(run, text) {
  run.log.push(text);
  if (run.log.length > 10) run.log.shift();
}

// Statistiques d'un monstre selon la profondeur (les monstres du jeu servent de modèles)
function makeMob(mode, room, elite, rnd) {
  const tier = Math.min(2, Math.floor((room - 1) / MINI.DECOR_ROOMS));
  const type = pick(MINI.MODES[mode].mobs[tier], rnd);
  const d = GD.MOBS[type];
  const hpW = clamp(Math.sqrt(d.hp / 60), 0.6, 2), dmgW = clamp(Math.sqrt(d.dmg / 8), 0.7, 1.6);
  const hp = Math.round(30 * (1 + 0.16 * (room - 1)) * hpW * (elite ? 2.5 : 1));
  const dot = d.onHit && (d.onHit.poison || d.onHit.burn) ? (d.onHit.burn ? 'burn' : 'poison') : null;
  return {
    type, name: d.name + (elite ? ' d’élite' : ''), hp, max: hp, elite: !!elite, dot,
    dmg: Math.round(7 * (1 + 0.09 * (room - 1)) * dmgW * (elite ? 1.3 : 1)),
    xp: Math.round(d.xp * (1 + 0.12 * room) * (elite ? 5 : 1))
  };
}

// Entrée dans la salle suivante
function enterRoom(m, run, rnd) {
  run.room++;
  Object.assign(run, GD.miniDecor(run.room, run.seed));
  run.mobs = []; run.loot = null; run.rewards = null;
  run.shield = 0; run.shieldTurns = 0; // le bouclier disparaît à chaque nouvelle salle
  run.guardUsed = false;              // garde des familiers (tortue, golem) : 1er coup de chaque salle
  const mode = MINI.MODES[run.mode];
  if (run.room % MINI.ELITE_EVERY === 0) {
    run.mobs = [makeMob(run.mode, run.room, true, rnd)];
    run.state = 'fight';
    log(run, `Salle ${run.room} : ${run.mobs[0].name} garde la salle !`);
    return;
  }
  const luck = m.up['luck_' + run.mode] || 0;
  const isLoot = run.nextKind ? run.nextKind === 'loot' : rnd() < MINI.LOOT_CHANCE + 0.05 * luck;
  run.nextKind = null;
  if (isLoot) {
    const bounty = m.up['bounty_' + run.mode] || 0, jack = rnd() < 0.04 * (m.up['jackpot_' + run.mode] || 0);
    const mul = jack ? GD.miniJackpotMul(m.up, run.mode) : 1;
    run.loot = { amount: Math.round((4 + 0.8 * run.room) * (1 + 0.15 * bounty) * mul), jackpot: jack ? mul : 0 };
    run.state = 'loot';
    log(run, `Salle ${run.room} : ${mode.loot}${jack ? ` énorme (×${String(mul).replace('.', ',')}) ` : ''} !`);
    return;
  }
  const n = 1 + Math.floor(rnd() * Math.min(3, 1 + Math.floor(run.room / 6)));
  for (let i = 0; i < n; i++) run.mobs.push(makeMob(run.mode, run.room, false, rnd));
  run.state = 'fight';
  log(run, `Salle ${run.room} : ${run.mobs.map((x) => x.name).join(', ')} !`);
}

// Salle terminée : récompense d'élite, puis choix remonter / continuer toutes les 3 salles
function roomCleared(run, rnd) {
  if (run.room % MINI.ELITE_EVERY === 0 && !run.rewardTaken) {
    const keys = Object.keys(MINI.ELITE_REWARDS).filter((k) => k !== 'egg').sort(() => rnd() - 0.5).slice(0, 3);
    if (rnd() < GD.PETS.EGG_CHANCE) keys[Math.floor(rnd() * 3)] = 'egg'; // œuf mystérieux : 1 % de chances
    run.rewards = keys;
    run.state = 'reward';
    return;
  }
  run.rewardTaken = false;
  run.state = run.room % MINI.ESCAPE_EVERY === 0 ? 'choice' : 'cleared';
  // flair (écureuil) : on sait à l'avance si la salle suivante contient du butin
  if (fxSum(run, 'sniff') > 0 && (run.room + 1) % MINI.ELITE_EVERY !== 0) {
    run.nextKind = rnd() < MINI.LOOT_CHANCE + 0.05 * (run.luck || 0) ? 'loot' : 'mobs';
    const sn = alivePets(run).find((p) => petFx(p).sniff);
    log(run, `${sn.name} flaire ${run.nextKind === 'loot' ? 'du butin' : 'des monstres'} dans la salle suivante`);
  }
}

function heroHit(run, mob, mult, rnd) {
  const crit = rnd() < run.crit + run.buff.crit;
  const dmg = Math.max(1, Math.round(run.dmg * (1 + run.buff.dmg + fxSum(run, 'rally')) * mult * (1 + (mob.mark || 0)) * (0.9 + rnd() * 0.2) * (crit ? 2 : 1)));
  mob.hp = Math.max(0, mob.hp - dmg);
  mob.hit = (mob.hit || 0) + 1;
  return { dmg, crit };
}

// Le bouclier absorbe les dégâts avant les PV ; renvoie la part absorbée
function absorb(run, dmg) {
  const a = Math.min(run.shield || 0, dmg);
  run.shield = (run.shield || 0) - a;
  return a;
}

// Les familiers agissent seuls après le héros (sur sa cible)
function petsAct(run, target, rnd) {
  for (const p of alivePets(run)) {
    const alive = run.mobs.filter((x) => x.hp > 0);
    if (!alive.length) return;
    const f = petFx(p), tgt = target && target.hp > 0 ? target : alive[0];
    const base = run.dmg * (1 + run.buff.dmg + fxSum(run, 'rally'));
    const hit = (mob, pct) => { const d = Math.max(1, Math.round(base * pct * (1 + (mob.mark || 0)))); mob.hp = Math.max(0, mob.hp - d); mob.hit = (mob.hit || 0) + 1; return d; };
    const parts = [];
    if (f.mark && !(tgt.mark >= f.mark)) { tgt.mark = f.mark; parts.push(`marque ${tgt.name}`); }
    if (f.bite) parts.push(`mord ${tgt.name} (−${hit(tgt, f.bite)})`);
    if (f.aoe) { for (const x of alive) hit(x, f.aoe); parts.push('frappe tous les monstres'); }
    if ((f.poison || f.burn) && tgt.hp > 0) { tgt.pdot = { dmg: Math.max(1, Math.round(base * (f.poison || f.burn))), turns: 2, kind: f.burn ? 'burn' : 'poison' }; parts.push(`${f.burn ? 'brûle' : 'empoisonne'} ${tgt.name}`); }
    if (f.weaken && tgt.hp > 0 && !(tgt.weak >= f.weaken)) { tgt.weak = f.weaken; parts.push(`affaiblit ${tgt.name}`); }
    if (f.freeze && tgt.hp > 0 && rnd() < f.freeze) { tgt.skip = 'gelé'; parts.push(`gèle ${tgt.name}`); }
    if (f.stun && tgt.hp > 0 && rnd() < f.stun) { tgt.skip = 'étourdi'; parts.push(`étourdit ${tgt.name}`); }
    if (f.heal && ++p.healT % 2 === 0 && run.hp < run.max) { const h = Math.max(1, Math.round(run.max * f.heal)); run.hp = Math.min(run.max, run.hp + h); parts.push(`te soigne (+${h} PV)`); }
    if (parts.length) { log(run, `${p.name} ${parts.join(', ')}`); p.acted = true; }
  }
}

// Monstres vaincus (par le héros, les familiers ou les poisons) : 1 ressource et de l'XP chacun
function collectKills(run) {
  const res = MINI.MODES[run.mode].res;
  for (const x of run.mobs) if (x.hp <= 0 && !x.dead) {
    x.dead = true; run.kills++; run.got += 1; run.xp += x.xp;
    log(run, `${x.name} est vaincu : +1 ${GD.RESOURCES[res].icon} · +${x.xp} XP`);
  }
}

function mobsTurn(run, rnd) {
  for (const mob of run.mobs) {
    if (mob.hp <= 0) continue;
    if (mob.skip) { log(run, `${mob.name} est ${mob.skip} et passe son tour`); mob.skip = null; continue; }
    const raw = Math.max(1, Math.round(mob.dmg * (1 - (mob.weak || 0)) * (0.85 + rnd() * 0.3)));
    // 20 % de chances (plus avec la provocation) de viser un familier plutôt que le héros
    const targets = alivePets(run).filter((p) => !petFx(p).ranged);
    const chance = Math.min(0.6, GD.PETS.HIT_CHANCE + targets.reduce((s, p) => s + (petFx(p).taunt || 0), 0));
    if (targets.length && rnd() < chance) {
      const w = targets.map((p) => 1 + 4 * (petFx(p).taunt || 0));
      let x = rnd() * w.reduce((a, b) => a + b, 0), pet = targets[targets.length - 1];
      for (let i = 0; i < targets.length; i++) { x -= w[i]; if (x <= 0) { pet = targets[i]; break; } }
      pet.hp = Math.max(0, pet.hp - raw); pet.hurt = (pet.hurt || 0) + raw;
      log(run, `${mob.name} frappe ${pet.name} : −${raw} PV${pet.hp <= 0 ? ` — ${pet.name} est K.-O. !` : ''}`);
      continue;
    }
    let dmg = Math.max(1, Math.round(raw * (1 - run.armor)));
    // garde (tortue, golem…) : absorbe une part du premier coup reçu dans la salle
    if (!run.guardUsed) {
      const g = Math.min(1, fxSum(run, 'guard'));
      if (g > 0) { run.guardUsed = true; const a = Math.round(dmg * g); dmg -= a; const gp = alivePets(run).find((p) => petFx(p).guard); log(run, `${gp.name} s’interpose : ${a} dégâts absorbés`); }
    }
    const abs = absorb(run, dmg);
    run.hp -= dmg - abs;
    log(run, `${mob.name} frappe : −${dmg - abs} PV${abs ? ` (${abs} absorbés par le bouclier)` : ''}`);
    if (mob.dot && rnd() < 0.5) { run.dot = { turns: 2, dmg: Math.max(1, Math.round(mob.dmg * 0.3)), kind: mob.dot }; }
  }
  // poisons et brûlures posés par les familiers
  for (const mob of run.mobs) if (mob.hp > 0 && mob.pdot) {
    mob.hp = Math.max(0, mob.hp - mob.pdot.dmg);
    log(run, `${mob.name} subit ${mob.pdot.kind === 'burn' ? 'sa brûlure' : 'le poison'} : −${mob.pdot.dmg}`);
    if (--mob.pdot.turns <= 0) mob.pdot = null;
  }
  if (run.dot && run.dot.turns > 0 && run.hp > 0) {
    const abs = absorb(run, run.dot.dmg);
    run.hp -= run.dot.dmg - abs; run.dot.turns--;
    log(run, `${run.dot.kind === 'burn' ? 'Brûlure' : 'Poison'} : −${run.dot.dmg - abs} PV`);
    if (run.dot.turns <= 0) run.dot = null;
  }
  // le bouclier ne tient que SHIELD_TURNS tours de monstres (jamais invulnérable entre deux boucliers)
  if (run.shield > 0 && --run.shieldTurns <= 0) { run.shield = 0; log(run, 'Ton bouclier se dissipe.'); }
  run.turn = (run.turn || 0) + 1;
}

// Fin de l'expédition : ressources gardées (75 % perdues en cas de mort), XP versée
function finish(u, m, run, dead, grantXp) {
  const res = MINI.MODES[run.mode].res;
  const lossPct = Math.max(0, MINI.DEATH_LOSS - Math.min(0.3, fxSum(run, 'carry'))); // porteur : perte réduite
  const lost = dead ? Math.floor(run.got * lossPct) : 0;
  const banked = run.got - lost;
  m.res[res] = (m.res[res] || 0) + banked;
  const levels = grantXp ? grantXp(u, run.xp) || 0 : 0;
  m.best[run.mode] = Math.max(m.best[run.mode] || 0, run.room);
  run.state = 'over';
  const petUps = pets.afterRun(u, run);
  run.over = { dead, banked, lost, xp: run.xp, room: run.room, grelons: run.grelons, kills: run.kills, levels, petUps };
  log(run, dead ? `Ton héros est tombé : ${lost} ${GD.RESOURCES[res].name.toLowerCase()} perdus.` : `De retour avec ${banked} ${GD.RESOURCES[res].name.toLowerCase()} !`);
}

function start(u, mode, gear, opts = {}) {
  const now = opts.now || Date.now(), rnd = opts.rnd || Math.random;
  const m = ensure(u, now);
  if (!MINI.MODES[mode]) fail('Mini-jeu inconnu');
  if (m.run && m.run.state !== 'over') fail('Une expédition est déjà en cours');
  if (m.energy < 1) fail('Plus d’énergie : reviens plus tard');
  if (m.energy >= MINI.ENERGY_MAX) m.energyAt = now;
  m.energy--;
  // statistiques propres aux mini-jeux (améliorées dans « Améliorations générales »)
  const st = GD.miniStats(m.up);
  const fam = GD.familyOf(u.cls);
  m.run = {
    mode, seed: Math.floor(rnd() * 1e9), room: 0, state: 'fight',
    hp: st.hp, max: st.hp, baseMax: st.hp, dmg: st.dmg, crit: st.crit, armor: st.armor,
    shield: 0, shieldMax: st.shield, shieldCd: 0,
    aoe: fam === 'mage' || fam === 'menestrel',
    buff: { dmg: 0, hp: 0, crit: 0 }, potions: MINI.POTIONS + (m.up.potion || 0), skillCd: 0,
    got: 0, xp: 0, grelons: 0, kills: 0, log: [], mobs: [], loot: null, rewards: null, dot: null,
    pets: pets.forRun(u), luck: m.up['luck_' + mode] || 0
  };
  log(m.run, `${MINI.MODES[mode].icon} ${MINI.MODES[mode].verb}…${m.run.pets.length ? ` avec ${m.run.pets.map((p) => p.name).join(' et ')}` : ''}`);
  enterRoom(m, m.run, rnd);
  return m.run;
}

// Action du joueur : attack, skill, defend, potion (combat) · take (butin) · next · continue / leave · reward · close
function act(u, body, opts = {}) {
  const rnd = opts.rnd || Math.random;
  const m = ensure(u, opts.now);
  const run = m.run;
  if (!run) fail('Aucune expédition en cours');
  const a = body.action;
  if (a === 'close') { if (run.state !== 'over') fail('L’expédition n’est pas terminée'); m.run = null; return null; }
  const res = MINI.MODES[run.mode].res;
  if (run.state === 'fight') {
    const alive = run.mobs.filter((x) => x.hp > 0);
    if (!alive.length) { roomCleared(run, rnd); return run; }
    const target = run.mobs[body.target] && run.mobs[body.target].hp > 0 ? run.mobs[body.target] : alive[0];
    run.mobs.forEach((x) => { x.hit = 0; });
    (run.pets || []).forEach((p) => { p.acted = false; p.hurt = 0; });
    if (a === 'attack') {
      const r = heroHit(run, target, 1, rnd);
      log(run, `Tu frappes ${target.name} : −${r.dmg}${r.crit ? ' (critique !)' : ''}`);
    } else if (a === 'skill') {
      if (run.skillCd > 0) fail('Compétence pas encore prête');
      if (run.aoe) { for (const x of alive) heroHit(run, x, 1.2, rnd); log(run, 'Explosion arcanique : tous les ennemis sont touchés !'); }
      else { const r = heroHit(run, target, 2.2, rnd); log(run, `Coup puissant sur ${target.name} : −${r.dmg}${r.crit ? ' (critique !)' : ''}`); }
      run.skillCd = MINI.SKILL_CD + 1;
    } else if (a === 'defend') {
      if (run.shieldCd > 0) fail('Bouclier pas encore prêt');
      run.shield = run.shieldMax || MINI.BASE.shield;
      run.shieldCd = MINI.SHIELD_CD + 1;
      run.shieldTurns = MINI.SHIELD_TURNS;
      log(run, `Tu lèves ton bouclier : ${run.shield} points de protection`);
    } else if (a === 'potion') {
      if (run.potions <= 0) fail('Plus de potions');
      run.potions--;
      run.hp = Math.min(run.max, run.hp + Math.round(run.max * MINI.POTION_HEAL));
      log(run, 'Tu bois une potion de soin');
    } else fail('Action inconnue');
    if (run.skillCd > 0) run.skillCd--;
    if (run.shieldCd > 0) run.shieldCd--;
    petsAct(run, target, rnd);
    collectKills(run);
    if (run.mobs.every((x) => x.hp <= 0)) { roomCleared(run, rnd); return run; }
    mobsTurn(run, rnd);
    if (run.hp <= 0) { run.hp = 0; finish(u, m, run, true, opts.grantXp); return run; }
    collectKills(run);
    if (run.mobs.every((x) => x.hp <= 0)) roomCleared(run, rnd);
    return run;
  }
  if (run.state === 'loot' && a === 'take') {
    const bonus = Math.round(run.loot.amount * fxSum(run, 'loot'));
    run.got += run.loot.amount + bonus;
    log(run, `Tu récoltes ${run.loot.amount} ${GD.RESOURCES[res].icon}${bonus ? ` (+${bonus} grâce à tes familiers)` : ''}`);
    run.loot = null;
    roomCleared(run, rnd);
    return run;
  }
  if (run.state === 'reward' && a === 'reward') {
    const k = body.id;
    if (!run.rewards.includes(k)) fail('Récompense inconnue');
    const R = MINI.ELITE_REWARDS[k];
    if (k === 'dmg') run.buff.dmg += 0.2;
    else if (k === 'crit') run.buff.crit += 0.1;
    else if (k === 'hp') { run.buff.hp += 0.2; const nm = Math.round(run.baseMax * (1 + run.buff.hp)); run.hp += nm - run.max; run.max = nm; }
    else if (k === 'heal') run.hp = run.max;
    else if (k === 'res') { const n = Math.round(8 + run.room * 1.2); run.got += n; }
    else if (k === 'grelons') { const n = 15 + run.room * 2; run.grelons += n; u.gold = (u.gold || 0) + n; }
    else if (k === 'potion') run.potions++;
    else if (k === 'egg') {
      // l'œuf est mis à l'abri tout de suite (gardé même si le héros tombe) et éclot après l'incubation
      pets.addEgg(u, run.mode, run.decor, opts.now || Date.now());
      log(run, `🥚 Tu ramasses un œuf mystérieux : il éclora dans ${GD.PETS.INCUBATION_MIN} min (onglet Familiers)`);
    }
    log(run, `Récompense : ${R.icon} ${R.name}`);
    run.rewardTaken = true;
    roomCleared(run, rnd);
    return run;
  }
  if ((run.state === 'cleared' && a === 'next') || (run.state === 'choice' && a === 'continue')) { enterRoom(m, run, rnd); return run; }
  if (run.state === 'choice' && a === 'leave') { finish(u, m, run, false, opts.grantXp); return run; }
  fail('Action impossible maintenant');
}

function buyUpgrade(u, id) {
  const m = ensure(u);
  const key = id.split('_')[0], U = MINI.UPGRADES[key];
  const lvl = m.up[id] || 0;
  const cost = GD.miniUpgradeCost(id, lvl);
  if (!U || !cost || !GD.miniUpgradeIds().includes(id)) fail('Amélioration inconnue');
  if (lvl >= U.max) fail('Déjà au niveau maximum');
  if (!GD.canPay(m.res, cost)) fail('Pas assez de ressources');
  for (const [k, n] of Object.entries(cost)) m.res[k] -= n;
  m.up[id] = lvl + 1;
  return m;
}

// État envoyé à la page joueur
function publicState(u, now = Date.now()) {
  const m = ensure(u, now);
  return {
    energy: m.energy, max: MINI.ENERGY_MAX,
    nextIn: m.energy >= MINI.ENERGY_MAX ? null : Math.max(0, m.energyAt + ENERGY_MS - now),
    res: m.res, up: m.up, best: m.best, run: m.run ? { ...m.run, seed: undefined } : null,
    pets: pets.publicState(u, now)
  };
}

module.exports = { MiniError, ensure, start, act, buyUpgrade, publicState, makeMob };
