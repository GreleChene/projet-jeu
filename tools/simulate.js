'use strict';
/*
 * Simulateur d'équilibrage : fait jouer des parties complètes à des bots et indique la manche atteinte.
 *
 *   npm run simulate -- [parties] [joueurs] [niveau] [mode] [difficulté] [votes] ['{"BALANCE.MOB_DMG":0.5}']
 *   ex. : npm run simulate -- 20 5 10 quick normal smart
 *
 * votes : « smart » = votes raisonnables (remparts / améliorations abordables / résurrection), sinon au hasard.
 * Les bots ont la classe de base de leur niveau (niveau 7+) et répartissent leurs points au hasard.
 */
const Game = require('../server/game/engine');
const GD = require('../shared/constants');
const [N = 20, players = 5, level = 10, mode = 'quick', difficulty = 'normal', votes = 'smart', overrides = '{}'] = process.argv.slice(2);
GD.applyBalance(JSON.parse(overrides));
const res = [];
for (let k = 0; k < Number(N); k++) {
  const g = new Game({ data: { settings: {} }, markDirty() {}, userById() { return null; }, syncAttrPoints() {}, gearOf() { return {}; } }, { to: () => ({ emit() {} }), sockets: { sockets: new Map() } });
  for (let i = 0; i < Number(players); i++) g.addBot({ cls: Number(level) >= GD.PROGRESSION.CLASS_LEVEL ? GD.BASE_CLASSES[(k + i) % 6] : 'habitant', level: Number(level) });
  g.settings.prepTime = 5;
  g.startRun(1, { mode, difficulty });
  if (votes === 'smart') {
    const orig = g.closeVote.bind(g);
    g.closeVote = (silent) => {
      const v = g.run.vote;
      if (v && !silent) for (const h of g.heroes.values()) v.votes.set(h.id, v.options.includes('revive') ? 'revive' : v.options.find((o) => o !== 'pact' && o !== 'save' && g.upgradeCost(o) <= g.run.treasury) || 'save');
      return orig(silent);
    };
  }
  let t = 0;
  while (t < 20 * 60 * 90 && g.phase !== 'gameover' && g.phase !== 'victory') { g.tick(0.05); t++; }
  res.push({ cleared: g.run.cleared, min: Math.round(t / 1200), win: g.phase === 'victory' });
}
const c = res.map((r) => r.cleared).sort((a, b) => a - b);
console.log(`${N} parties · ${players} joueurs niv. ${level} · ${mode} · ${difficulty} · votes ${votes}`);
console.log('manches gagnées :', res.map((r) => r.cleared + (r.win ? '🏆' : '')).join(' '));
console.log(`médiane ${c[Math.floor(c.length / 2)]} · min ${c[0]} · max ${c[c.length - 1]} · durée moyenne ${Math.round(res.reduce((a, r) => a + r.min, 0) / res.length)} min`);
