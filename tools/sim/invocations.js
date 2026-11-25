'use strict';
/*
 * Invocations et ultimes : nombre de créatures par héros (6, puis 9 avec la compétence d'après-ultime),
 * cadence (une toutes les SUMMON_EVERY s, SUMMON_RESPAWN s après une mort) et ultimes utilisés.
 *   node tools/sim/invocations.js [--minutes=5]
 */
const { GD, makeGame, run, args } = require('./lib');
const A = args();

const g = makeGame();
const list = [['dompteur', 30], ['dompteur', 100], ['fauconnier', 30], ['fauconnier', 100], ['necromancien', 30], ['necromancien', 100]];
for (const [cls, level] of list) g.addBot({ cls, level });
g.startRun(10, { mode: 'classic', difficulty: 'normal' });
g.damageTower = () => {};
const ults = {}, spawns = {}, maxPer = {};
const uu = g.useUlt.bind(g);
g.useUlt = (h, c) => { ults[c.ult] = (ults[c.ult] || 0) + 1; return uu(h, c); };
const sa = g.spawnAlly.bind(g);
g.spawnAlly = (o, type, x, y, e) => { (spawns[`${o.cls}(${o.level})`] ||= []).push(`${type.slice(5)}@${g.time.toFixed(0)}s`); return sa(o, type, x, y, e); };
run(g, Number(A.minutes || 5), () => {
  for (const h of g.heroes.values()) {
    const k = `${h.cls}(${h.level})`;
    maxPer[k] = Math.max(maxPer[k] || 0, g.allies.filter((a) => a.ownerId === h.id && !a.charmed).length);
  }
});
console.log('invocations max (plafond) :', Object.entries(maxPer).map(([k, v]) => `${k} ${v}`).join(' · '));
for (const [k, v] of Object.entries(spawns)) console.log(`${k.padEnd(18)} ${v.slice(0, 9).join(' ')}`);
for (const h of g.heroes.values()) {
  const k = {};
  for (const a of g.allies) if (a.ownerId === h.id) k[a.type.slice(5)] = (k[a.type.slice(5)] || 0) + 1;
  console.log(`${h.cls}(${h.level}) rangs ${JSON.stringify(h.summonRanks)} → en jeu ${JSON.stringify(k)}`);
}
console.log('ultimes utilisés :', JSON.stringify(ults), '| cadence :', GD.SUMMON_EVERY, 's,', GD.SUMMON_RESPAWN, 's après une mort');
