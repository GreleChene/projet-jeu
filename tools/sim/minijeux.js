'use strict';
/*
 * Mini-jeux : salle atteinte, ressources rapportées et taux de mort selon le niveau du héros.
 *   node tools/sim/minijeux.js [--mode=mine] [--n=200]
 * Stratégie du bot : compétence dès qu'elle est prête, potion sous 35 % de PV,
 * remonte au point de choix quand il lui reste moins de 45 % de PV.
 * Repères : niveau 10 ≈ salles 6-12, niveau 40 ≈ 15-25 ; la mort doit rester un vrai risque.
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

function expedition(level) {
  const u = hero(level);
  u.mini = { energy: 3, energyAt: Date.now() };
  const run = mini.start(u, mode, {});
  for (let guard = 0; guard < 5000 && run.state !== 'over'; guard++) {
    const s = run.state;
    if (s === 'fight') {
      if (run.hp < run.max * 0.35 && run.potions > 0) mini.act(u, { action: 'potion' });
      else mini.act(u, { action: run.skillCd === 0 ? 'skill' : 'attack' });
    } else if (s === 'loot') mini.act(u, { action: 'take' });
    else if (s === 'reward') mini.act(u, { action: 'reward', id: run.rewards.includes('heal') && run.hp < run.max * 0.6 ? 'heal' : run.rewards[0] });
    else if (s === 'cleared') mini.act(u, { action: 'next' });
    else if (s === 'choice') mini.act(u, { action: run.hp < run.max * 0.55 ? 'leave' : 'continue' });
  }
  return run.over;
}

for (const level of [1, 10, 25, 40, 70]) {
  const rs = Array.from({ length: N }, () => expedition(level));
  const avg = (f) => (rs.reduce((s, r) => s + f(r), 0) / rs.length).toFixed(1);
  const rooms = rs.map((r) => r.room).sort((a, b) => a - b);
  console.log(`niveau ${level} : salle moyenne ${avg((r) => r.room)} (médiane ${rooms[N >> 1]}, max ${rooms[N - 1]}) · morts ${Math.round((100 * rs.filter((r) => r.dead).length) / N)} % · ${GD.RESOURCES[GD.MINI.MODES[mode].res].icon} rapportées ${avg((r) => r.banked)} · XP ${avg((r) => r.xp)}`);
}
