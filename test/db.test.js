'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.DATA_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jeu-db-')), 'db.json');
const db = require('../server/db');
const { GLACONS } = require('../shared/constants');

test('un nouveau compte reçoit ses glaçons de départ (nombre valide)', () => {
  db.load();
  const u = db.newUser('Nouveau', 'hash', 'player');
  assert.strictEqual(u.glacons, GLACONS.START);
  assert.ok(Number.isFinite(u.glacons));
});

test('migration des mini-jeux : une expédition au tour par tour en cours est abandonnée et son énergie rendue', () => {
  const u = db.newUser('AncienMineur', 'hash', 'player');
  u.mini.energy = 1;
  u.mini.run = { mode: 'mine', state: 'fight', room: 4, mobs: [{ type: 'gobelin', hp: 10 }] };
  delete u.mini.trophies;
  db.saveNow();
  // anciens comptes : la migration v3 n'avait pas encore eu lieu
  const raw = JSON.parse(fs.readFileSync(process.env.DATA_FILE, 'utf8'));
  delete raw.users[u.id].miniV3;
  fs.writeFileSync(process.env.DATA_FILE, JSON.stringify(raw));
  db.load();
  const v = db.userById(u.id);
  assert.strictEqual(v.mini.run, null);
  assert.strictEqual(v.mini.energy, 2, 'énergie rendue');
  assert.deepStrictEqual(v.mini.trophies, {});
  assert.ok(v.miniV3);
});
