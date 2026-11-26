'use strict';
/*
 * Outils communs aux simulations : une partie sans serveur ni réseau, avec des bots.
 * La simulation avance par pas de 50 ms (comme le serveur) mais aussi vite que possible.
 */
const Game = require('../../server/game/engine');
const GD = require('../../shared/constants');

const STEP = 0.05;

// Partie hors ligne (base de données et sockets factices)
function makeGame() {
  const db = { data: { settings: {} }, markDirty() {}, userById() { return null; }, syncAttrPoints() {}, gearOf() { return {}; } };
  const io = { to: () => ({ emit() {} }), emit() {}, sockets: { sockets: new Map() } };
  return new Game(db, io);
}

// Ajoute des bots : classes = liste de classes (réparties en boucle), level = niveau
function addBots(g, n, classes, level) {
  for (let i = 0; i < n; i++) g.addBot({ cls: classes[i % classes.length], level });
}

// Votes des bots : Résurrection s'il y a un mort (si abordable), sinon la première amélioration abordable (ou Vitalité de la nature)
// (strategy 'expensive' : la plus chère abordable, plus proche de joueurs réels)
function botVotes(g, strategy) {
  const close = g.closeVote.bind(g);
  g.closeVote = (silent) => {
    const v = g.run.vote;
    if (v && !silent) {
      // premier vote : une spécialisation de tour au hasard (ou celle de --tour=…)
      if (v.options[0].startsWith('spec_')) {
        const want = process.argv.find((a) => a.startsWith('--tour='));
        const pick = want ? 'spec_' + want.slice(7) : v.options[Math.floor(Math.random() * 4)];
        for (const h of g.heroes.values()) v.votes.set(h.id, v.options.includes('revive') ? 'revive' : pick);
        return close(silent);
      }
      const total = (o) => Object.values(g.upgradeCost(o)).reduce((a, b) => a + b, 0);
      const ok = v.options.filter((o) => o !== 'pact' && o !== 'revive' && g.canAfford(o));
      if (strategy === 'expensive') ok.sort((a, b) => total(b) - total(a));
      const pick = v.options.includes('revive') && g.canAfford('revive') ? 'revive' : ok[0];
      if (pick) for (const h of g.heroes.values()) v.votes.set(h.id, pick);
    }
    return close(silent);
  };
}

// « Mode dieu » : tour invulnérable et héros très forts, pour mesurer la durée d'une partie gagnée
function godMode(g) {
  g.damageTower = () => {};
  g.__god = true;
}

// Fait tourner la partie jusqu'à la fin (ou maxMinutes de jeu) ; onTick(g, ticks) optionnel
function run(g, maxMinutes, onTick) {
  let ticks = 0;
  const max = (maxMinutes * 60) / STEP;
  while (ticks < max && g.phase !== 'gameover' && g.phase !== 'victory') {
    if (g.__god && ticks % 20 === 0) for (const h of g.heroes.values()) { if (h.dmg < 2000) h.dmg *= 60; if (h.alive) h.hp = h.maxHp; }
    g.tick(STEP);
    ticks++;
    if (onTick) onTick(g, ticks);
  }
  return { minutes: (ticks * STEP) / 60, wave: g.run.wave, phase: g.phase };
}

// Lit les options de la ligne de commande : --clé=valeur
function args() {
  const out = {};
  for (const a of process.argv.slice(2)) { const m = /^--([^=]+)=?(.*)$/.exec(a); if (m) out[m[1]] = m[2] === '' ? true : m[2]; }
  return out;
}

module.exports = { GD, makeGame, addBots, botVotes, godMode, run, args, STEP };
