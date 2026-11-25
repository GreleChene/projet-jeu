'use strict';
/*
 * Durée des parties.
 *   node tools/sim/duree.js            → parties gagnées (tour invulnérable) : classique et rapide, 5 et 12 héros
 *   node tools/sim/duree.js --normal   → parties réelles (bots niveau 10 / 30) : manche atteinte et durée
 * Objectifs : classique gagnée ≤ 60 min (≈ 45-52 min), rapide ≈ 12-15 min, rapide niveau 10 ≥ manche 10.
 */
const { GD, makeGame, addBots, botVotes, godMode, run, args } = require('./lib');
const A = args();

function game(mode, n, level, god) {
  const g = makeGame();
  addBots(g, n, GD.BASE_CLASSES.map((b) => GD.specsOf(b)[0]), level);
  g.startRun(1, { mode, difficulty: 'normal' });
  botVotes(g);
  if (god) godMode(g);
  return run(g, god ? 200 : 120);
}
const fmt = (r) => `${r.minutes.toFixed(1)} min → manche ${r.wave}`;

if (A.normal) {
  console.log('classique  5 bots niv 10 :', [0, 1].map(() => fmt(game('classic', 5, 10))).join(' | '));
  console.log('classique 12 bots niv 30 :', [0, 1].map(() => fmt(game('classic', 12, 30))).join(' | '));
  console.log('rapide     5 bots niv 10 :', [0, 1, 2].map(() => fmt(game('quick', 5, 10))).join(' | '));
} else {
  console.log('classique gagnée  5 héros :', [0, 1].map(() => fmt(game('classic', 5, 30, true))).join(' | '));
  console.log('classique gagnée 12 héros :', [0, 1].map(() => fmt(game('classic', 12, 30, true))).join(' | '));
  console.log('rapide gagnée     5 héros :', fmt(game('quick', 5, 30, true)), '| 12 héros :', fmt(game('quick', 12, 30, true)));
}
