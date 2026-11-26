'use strict';
/*
 * Mini-jeux : salle atteinte, ressources rapportées et taux de mort selon les améliorations d'expédition
 * (Vitalité, Force, Armure, Précision, Bouclier au même niveau ; les stats du héros ne comptent pas).
 *   node tools/sim/minijeux.js [--mode=mine] [--n=200]
 * Stratégie du bot : bouclier dès qu'il est prêt (s'il est vide), compétence dès qu'elle est prête, potion sous 35 % de PV,
 * remonte au point de choix quand il lui reste moins de 45 % de PV.
 * Repères : sans amélioration ≈ salles 5-8, améliorations à mi-chemin ≈ 12-18, au maximum ≈ 25+ ; la mort doit rester un vrai risque.
 */
const GD = require('../../shared/constants');
const mini = require('../../server/mini');
const { args } = require('./lib');
const A = args();
const mode = A.mode || 'mine', N = Number(A.n || 200);

// Héros type : points de stat répartis (force, vie, défense…), compétences d'une spécialisation
function hero(level) {
  const attrs = GD.emptyAttrs();
  const order = ['force', 'vie', 'defense', 'agilite', 'critique'];
  for (let i = 1; i < level; i++) attrs[order[i % order.length]]++;
  return { cls: level >= 7 ? 'paladin' : 'habitant', level, attrs, skills: {}, gold: 0, xp: 0 };
}

function expedition(tier) {
  const u = hero(10);
  const up = {};
  for (const [k, U] of Object.entries(GD.MINI.UPGRADES)) if (U.stat) up[k] = Math.min(U.max, Math.round(U.max * tier));
  u.mini = { energy: 3, energyAt: Date.now(), up };
  const run = mini.start(u, mode, {});
  for (let guard = 0; guard < 5000 && run.state !== 'over'; guard++) {
    const s = run.state;
    if (s === 'fight') {
      if (run.hp < run.max * 0.35 && run.potions > 0) mini.act(u, { action: 'potion' });
      else if (run.shieldCd === 0 && !run.shield) mini.act(u, { action: 'defend' });
      else mini.act(u, { action: run.skillCd === 0 ? 'skill' : 'attack' });
    } else if (s === 'loot') mini.act(u, { action: 'take' });
    else if (s === 'reward') mini.act(u, { action: 'reward', id: run.rewards.includes('heal') && run.hp < run.max * 0.6 ? 'heal' : run.rewards[0] });
    else if (s === 'cleared') mini.act(u, { action: 'next' });
    else if (s === 'choice') mini.act(u, { action: run.hp < run.max * 0.55 ? 'leave' : 'continue' });
  }
  return run.over;
}

for (const tier of [0, 0.25, 0.5, 0.75, 1]) {
  const rs = Array.from({ length: N }, () => expedition(tier));
  const avg = (f) => (rs.reduce((s, r) => s + f(r), 0) / rs.length).toFixed(1);
  const rooms = rs.map((r) => r.room).sort((a, b) => a - b);
  console.log(`améliorations ${Math.round(tier * 100)} % : salle moyenne ${avg((r) => r.room)} (médiane ${rooms[N >> 1]}, max ${rooms[N - 1]}) · morts ${Math.round((100 * rs.filter((r) => r.dead).length) / N)} % · ${GD.RESOURCES[GD.MINI.MODES[mode].res].icon} rapportées ${avg((r) => r.banked)} · XP ${avg((r) => r.xp)}`);
}
