'use strict';
/*
 * Économie des écus : sources (éliminations / fin de manche) et trésor non dépensé.
 *   node tools/sim/economie.js [--manche=20]
 * Les votes des bots achètent l'amélioration la plus chère abordable (proche de vrais joueurs).
 * Objectif : peu de surplus (quelques centaines d'écus au plus) en milieu et fin de partie.
 */
const { GD, makeGame, addBots, botVotes, godMode, run, args } = require('./lib');
const A = args();
const upTo = Number(A.manche || 20);

function game(n, level) {
  const g = makeGame();
  addBots(g, n, GD.BASE_CLASSES.map((b) => GD.specsOf(b)[0]), level);
  g.startRun(1, { mode: 'classic', difficulty: 'normal' });
  const src = { elim: 0, fin: 0 };
  let tag = 'elim';
  const add = g.addTreasury.bind(g);
  g.addTreasury = (x) => { src[tag] += x; add(x); };
  const wc = g.waveCleared.bind(g);
  g.waveCleared = () => { tag = 'fin'; wc(); tag = 'elim'; };
  botVotes(g, 'expensive');
  godMode(g);
  run(g, 200, () => g.run.cleared >= upTo && (g.phase = 'victory'));
  const r = g.run;
  return `${n} héros niv ${level} → manche ${r.cleared} : trésor ${Math.round(r.treasury)} | éliminations ${src.elim} · fins de manche ${src.fin} | dépensé ${Math.round(r.wealthEarned - r.treasury)}`;
}

for (const [n, l] of [[5, 15], [12, 25]]) console.log(game(n, l));
