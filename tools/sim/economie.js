'use strict';
/*
 * Économie des ressources (pierre, bois, baies) : récoltées, dépensées et réserve non dépensée.
 *   node tools/sim/economie.js [--manche=20] [--tour=defense] [--recolteurs=2]
 * Les votes des bots achètent l'amélioration la plus chère abordable (proche de vrais joueurs).
 * --recolteurs : nombre de bots en IA « Priorité à la récolte » (les autres en « Équilibrée »).
 * Objectif : pas de gros surplus en fin de partie ; la carte est presque épuisée vers la fin.
 */
const { GD, makeGame, addBots, botVotes, godMode, run, args } = require('./lib');
const A = args();
const upTo = Number(A.manche || 20);
const harvesters = A.recolteurs === undefined ? 2 : Number(A.recolteurs);

function game(n, level) {
  const g = makeGame();
  addBots(g, n, GD.BASE_CLASSES.map((b) => GD.specsOf(b)[0]), level);
  let i = 0;
  for (const h of g.heroes.values()) { h.bot.ai = { ...h.bot.ai, stance: i++ < harvesters ? 'harvest' : 'balanced' }; h.ai = h.bot.ai; }
  g.startRun(1, { mode: 'classic', difficulty: 'normal' });
  botVotes(g, 'expensive');
  godMode(g);
  let bought = 0;
  const ap = g.applyUpgrade.bind(g);
  g.applyUpgrade = (id, free) => { const before = JSON.stringify(g.run.upgrades); ap(id, free); if (JSON.stringify(g.run.upgrades) !== before && GD.UPGRADES[id].tower) bought++; };
  const marks = [];
  run(g, 200, () => {
    if (g.run.cleared >= upTo) g.phase = 'victory';
    if (g.phase === 'intermission' && g.run.cleared % 5 === 0 && !marks.includes(g.run.cleared)) {
      marks.push(g.run.cleared);
      const left = g.run.nodes.reduce((s, x) => s + x.amt, 0), max = g.run.nodes.reduce((s, x) => s + x.max, 0);
      console.log(`  manche ${g.run.cleared} : réserve ${JSON.stringify(g.resStock())} · carte ${Math.round(100 * left / max)} %`);
    }
  });
  const r = g.run, f = (o) => GD.RES_IDS.map((k) => `${GD.RESOURCES[k].icon}${Math.round(o[k])}`).join(' ');
  return `${n} héros niv ${level} (${harvesters} récolteurs), tour ${r.towerSpec} → manche ${r.cleared} : récolté ${f(r.resEarned)} | reste ${f(r.res)} | ${bought} améliorations`;
}

for (const [n, l] of [[5, 15], [12, 25]]) console.log(game(n, l));
