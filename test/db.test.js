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
