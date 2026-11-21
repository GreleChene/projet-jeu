'use strict';
/*
 * Équilibrage en direct : toutes les valeurs numériques du jeu modifiables depuis l'admin.
 * Les modifications sont enregistrées (db.data.balance) et envoyées instantanément à tous les clients.
 */
const GD = require('../shared/constants');

const L = {
  TOWER_BASE_HP: 'PV de la tour au départ', ULT_TIME: 'Temps de charge d’un ultime (s)', RESPAWN_TIME: 'Temps de réapparition d’un héros (s)',
  WAVE_HP_LINEAR: 'PV monstres : hausse linéaire par manche', WAVE_HP_QUAD: 'PV monstres : hausse quadratique par manche', WAVE_DMG: 'Dégâts monstres : hausse par manche',
  HP_PER_HERO: 'PV monstres : bonus par héros présent', DMG_PER_HERO: 'Dégâts monstres : bonus par héros présent',
  WAVE_DURATION_BASE: 'Durée d’apparition des monstres : base (s)', WAVE_DURATION_PER_WAVE: 'Durée : en plus par manche (s)', WAVE_DURATION_PER_HERO: 'Durée : en plus par héros (s)', WAVE_DURATION_MAX: 'Durée : maximum (s)', MOB_COUNT_BASE: 'Nombre de monstres : base', MOB_COUNT_PER_WAVE: 'Nombre de monstres : en plus par manche',
  MOB_COUNT_PER_HERO: 'Nombre de monstres : facteur par héros', MOB_COUNT_HERO_CAP: 'Nombre de monstres : facteur joueurs max', MAX_WAVE_MOBS: 'Monstres max par manche',
  ELITE_BASE: 'Chance d’élite : base', ELITE_PER_WAVE: 'Chance d’élite : par manche', ELITE_MAX: 'Chance d’élite : maximum', ELITE_HP: 'Élites : multiplicateur de PV', ELITE_DMG: 'Élites : multiplicateur de dégâts',
  BOSS_HP_BASE: 'PV des boss : base', BOSS_HP_PER_HERO: 'PV des boss : par héros', WAVE_XP_BASE: 'Fin de manche : XP de base', WAVE_XP_PER_WAVE: 'Fin de manche : XP par manche',
  WAVE_GRELONS_BASE: 'Fin de manche : Grêlons de base', WAVE_GRELONS_PER_WAVE: 'Fin de manche : Grêlons par manche', WAVE_ECUS_BASE: 'Fin de manche : écus de base (équipe)',
  WAVE_ECUS_PER_WAVE: 'Fin de manche : écus par manche', KILL_ECUS: 'Écus par élimination (part de la valeur du monstre)', HARVEST_INTERVAL: 'Paysans : secondes entre deux récoltes',
  BUILDING_HP: 'PV des bâtiments de classe', BUILDING_HEAL: 'Soin dans son bâtiment pendant l’entracte (part des PV max / s)',
  HARVEST_BASE: 'Paysans : écus par récolte (base)', HARVEST_PER_LEVEL: 'Paysans : écus par récolte par niveau',
  CLASS_LEVEL: 'Niveau pour choisir une classe', SKILL_EVERY: 'Un point de compétence tous les X niveaux', SKILL_RESPEC_LOSS: 'Reconversion : part des points perdue (0,25 = un quart)', MAX_LEVEL: 'Niveau maximum', POINTS_PER_LEVEL: 'Points de stat par niveau',
  GLACONS_PER_LEVEL: 'Glaçons par niveau', XP_BASE: 'XP requise : base', XP_EXP: 'XP requise : exposant',
  PRICE: 'Prix d’un glaçon (Grêlons)', PER_WAVE: 'Glaçons par manche passée', START: 'Glaçons offerts à l’inscription', UNIVERSAL_CHANCE: 'Chance d’objet universel', OTHER_CLASS_CHANCE: 'Chance d’objet d’une autre classe'
};
const COL = {
  hp: 'PV', dmg: 'Dégâts', range: 'Portée', cd: 'Recharge (s)', speed: 'Vitesse', armor: 'Armure', crit: 'Critique', leash: 'Distance max tour',
  size: 'Taille', xp: 'XP', gold: 'Grêlons', from: 'Dès la manche', w: 'Fréquence', p: 'Probabilité', mult: 'Multiplicateur', recycle: 'Recyclage (× prix glaçon)',
  cost: 'Coût (écus)', growth: 'Hausse du coût', max: 'Niveau max', unlock: 'Débloqué à (écus gagnés)'
};

const numKeys = (o) => Object.keys(o).filter((k) => typeof o[k] === 'number');

// Description de l'onglet « Équilibrage »
function schema() {
  const fields = (root, keys) => keys.map((k) => ({ path: [root, k], label: L[k] || k }));
  const table = (root, rows, cols, rowLabel) => ({ type: 'table', cols: cols.map((c) => ({ key: c, label: COL[c] || c })), rows: rows.map((id) => ({ id: String(id), label: rowLabel(id), cells: cols.map((c) => [root, String(id), c]) })) });
  const S = GD.SLOT_NAMES;
  const bossFields = [];
  for (const [id, m] of Object.entries(GD.MOBS)) (m.abilities || []).forEach((ab, i) => {
    for (const k of numKeys(ab)) bossFields.push({ path: ['MOBS', id, 'abilities', String(i), k], label: `${m.name} — ${ab.type} : ${{ cd: 'recharge (s)', radius: 'rayon', dmg: 'dégâts ×', count: 'nombre', slow: 'ralentissement', poison: 'poison/s', burn: 'brûlure/s' }[k] || k}` });
  });
  const setFields = [];
  for (const [id, s] of Object.entries(GD.SETS)) for (const [n, b] of Object.entries(s.bonus)) for (const k of Object.keys(b)) setFields.push({ path: ['SETS', id, 'bonus', n, k], label: `${s.name} — ${n} pièces : ${GD.STAT_NAMES[k]} (+)` });
  return [
    { id: 'general', title: '⚙️ Général', type: 'fields', fields: fields('BALANCE', Object.keys(GD.BALANCE)) },
    { id: 'progression', title: '📈 Progression', type: 'fields', fields: fields('PROGRESSION', numKeys(GD.PROGRESSION)) },
    { id: 'attributes', title: '📊 Points de stat (effet par point)', type: 'fields', fields: GD.ATTR_IDS.map((a) => ({ path: ['ATTRIBUTES', a, 'per'], label: `${GD.ATTRIBUTES[a].icon} ${GD.ATTRIBUTES[a].name} (${GD.ATTRIBUTES[a].what})` })) },
    { id: 'glacons', title: '🧊 Glaçons', type: 'fields', fields: fields('GLACONS', numKeys(GD.GLACONS)) },
    { id: 'rarities', title: '💎 Raretés', note: 'Les probabilités doivent totaliser 1 (100 %).', ...table('RARITIES', GD.RARITIES.map((r, i) => i), ['p', 'mult', 'recycle'], (i) => GD.RARITIES[i].name) },
    { id: 'classes', title: '🧬 Classes', note: 'Armure et critique : 0,1 = 10 %. Distance max : vide = illimitée.', ...table('CLASSES', GD.CLASS_IDS, ['hp', 'dmg', 'range', 'cd', 'speed', 'armor', 'crit', 'leash'], (id) => GD.CLASSES[id].name) },
    { id: 'mobs', title: '👹 Monstres et boss', note: 'Valeurs de base à la manche 1 (multipliées ensuite par manche). Invocations alliées : PV et dégâts = fraction de ceux du héros.', ...table('MOBS', GD.MOB_IDS, ['hp', 'dmg', 'speed', 'range', 'cd', 'size', 'xp', 'gold', 'from', 'w'], (id) => GD.MOBS[id].name + (GD.MOBS[id].boss ? ' 👑' : GD.MOBS[id].ally ? ' (allié)' : '')) },
    { id: 'abilities', title: '💥 Capacités des boss', type: 'fields', fields: bossFields },
    { id: 'items', title: '🛡️ Pièces d’équipement (valeurs en rareté commune)', note: '0,05 = +5 %. La rareté multiplie ces valeurs.', ...table('TEMPLATES', Object.keys(GD.TEMPLATES), ['hp', 'armor', 'dmg', 'speed'], (id) => `${GD.TEMPLATES[id].name} (${S[GD.TEMPLATES[id].slot]})`) },
    { id: 'sets', title: '🧩 Bonus de sets', type: 'fields', fields: setFields },
    { id: 'upgrades', title: '🏰 Améliorations de la tour (votes)', ...table('UPGRADES', Object.keys(GD.UPGRADES), ['cost', 'growth', 'max', 'unlock'], (id) => `${GD.UPGRADES[id].icon} ${GD.UPGRADES[id].name}`) }
  ];
}

// Chemins autorisés + valeurs par défaut (relevées au démarrage, avant les modifications)
const allowed = new Map();
function indexSchema() {
  for (const g of schema()) {
    const paths = g.type === 'table' ? g.rows.flatMap((r) => r.cells) : g.fields.map((f) => f.path);
    for (const p of paths) {
      const k = p.join('.');
      if (!allowed.has(k)) allowed.set(k, { def: GD.getPath(p) });
    }
  }
}

function init(db) {
  indexSchema();
  for (const k of Object.keys(db.data.balance)) if (!allowed.has(k)) delete db.data.balance[k];
  GD.applyBalance(db.data.balance);
}

// Vue complète pour l'admin : groupes + valeur actuelle + valeur par défaut
function view(db) {
  const val = (p) => { const k = p.join('.'); const v = GD.getPath(p); return { k, v: typeof v === 'number' ? v : null, d: allowed.get(k).def, mod: k in db.data.balance }; };
  return schema().map((g) => g.type === 'table'
    ? { ...g, rows: g.rows.map((r) => ({ id: r.id, label: r.label, cells: r.cells.map(val) })) }
    : { ...g, fields: g.fields.map((f) => ({ label: f.label, ...val(f.path) })) });
}

// Applique une modification ; renvoie la valeur appliquée (ou une erreur)
function set(db, key, value, reset) {
  const a = allowed.get(key);
  if (!a) return { error: 'Valeur non modifiable' };
  let v;
  if (reset) { v = a.def; delete db.data.balance[key]; }
  else {
    if (value === null || value === '') {
      // vide autorisé seulement pour les valeurs facultatives (ex. distance max = illimitée)
      if (a.def !== undefined) return { error: 'Cette valeur est obligatoire' };
      v = null;
    } else {
      v = Number(value);
      if (!Number.isFinite(v) || v < 0 || v > 1e7) return { error: 'Nombre invalide (0 à 10 000 000)' };
    }
    db.data.balance[key] = v;
  }
  GD.setPath(key.split('.'), v);
  db.markDirty();
  return { key, value: v };
}

module.exports = { init, view, set };
