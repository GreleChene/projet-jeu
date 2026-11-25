'use strict';
/*
 * Vérifie que les passifs se déclenchent en partie : un bot de chaque classe concernée, quelques minutes de jeu.
 *   node tools/sim/passifs.js [--minutes=4]
 */
const { makeGame, run, args } = require('./lib');
const A = args();

const g = makeGame();
for (const cls of ['soldat', 'paladin', 'chevalier', 'mage', 'archer', 'arbaletrier', 'arclong', 'assassin', 'glace', 'fauconnier']) g.addBot({ cls, level: 25 });
g.startRun(8, { mode: 'classic', difficulty: 'normal' });
g.damageTower = () => {};
const seen = {};
const fx = g.fx.bind(g);
g.fx = (e) => {
  if (e[0] === 'text' && (e[3] === 'Parade !' || e[3] === 'Élan !')) seen[e[3]] = (seen[e[3]] || 0) + 1;
  if (e[0] === 'boom' && e[3] === 60) seen['Orbe instable'] = (seen['Orbe instable'] || 0) + 1;
  return fx(e);
};
const dm = g.damageMob.bind(g);
g.damageMob = (m, amt, owner, opts = {}) => {
  if (opts.extra && opts.extra.knock) seen['Carreau lourd'] = (seen['Carreau lourd'] || 0) + 1;
  if (owner && owner.cls === 'assassin' && (m.target !== owner || m.status.slow || m.status.freeze || m.status.mark)) seen['Coup dans le dos'] = (seen['Coup dans le dos'] || 0) + 1;
  if (owner && owner.cls === 'arclong') seen['Tir de loin (coups)'] = (seen['Tir de loin (coups)'] || 0) + 1;
  return dm(m, amt, owner, opts);
};
const dh = g.damageHero.bind(g);
let guarded = 0;
g.damageHero = (h, n, onHit, raw) => {
  if (!raw) for (const o of g.heroes.values()) if (o.cls === 'soldat' && o.alive && (o.x - h.x) ** 2 + (o.y - h.y) ** 2 < 120 * 120) { guarded++; break; }
  return dh(h, n, onHit, raw);
};
run(g, Number(A.minutes || 4));
seen['Garde (coups atténués)'] = guarded;
console.log('déclenchements :', JSON.stringify(seen, null, 1));
console.log('kills :', [...g.heroes.values()].map((h) => `${h.cls}:${h.runKills}`).join(' '));
