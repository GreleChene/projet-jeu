'use strict';
/*
 * Équilibrage des spécialisations : une équipe de 5 bots de la même spécialisation (niveau 25),
 * manche atteinte en classique normal (2 parties chacune). Plus c'est haut, plus la classe est forte.
 *   node tools/sim/classes.js                  → toutes les spécialisations (long : plusieurs minutes)
 *   node tools/sim/classes.js paladin feu …    → seulement celles-ci
 *   --niveau=40 --parties=3                    → autres réglages
 */
const { GD, makeGame, addBots, botVotes, run, args } = require('./lib');
const A = args();
const level = Number(A.niveau || 25), games = Number(A.parties || 2);
const list = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const specs = list.length ? list : Object.keys(GD.CLASSES).filter((c) => GD.CLASSES[c].tier === 2);

for (const cls of specs) {
  const waves = [];
  for (let i = 0; i < games; i++) {
    const g = makeGame();
    addBots(g, 5, [cls], level);
    g.startRun(1, { mode: 'classic', difficulty: 'normal' });
    botVotes(g);
    waves.push(run(g, 60).wave);
  }
  console.log(`${cls.padEnd(14)} ${waves.join(' / ')}`);
}
