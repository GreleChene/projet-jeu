/*
 * Données partagées serveur / navigateur.
 * Source unique de vérité pour les classes, armures, monstres, palette graphique…
 * (UMD : utilisable via require() côté Node et via <script> côté navigateur -> window.GameData)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GameData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WORLD = { W: 1920, H: 1080, CX: 960, CY: 540, TOWER_R: 64, TILE: 40 };

  /* ------------------------------------------------------------------ */
  /* Palette : TOUTES les couleurs du jeu viennent d'ici (cohérence).    */
  /* Style : aplats + contour sombre unique (OUTLINE), ombre portée douce */
  /* ------------------------------------------------------------------ */
  const PALETTE = {
    outline: '#1d1626',
    shadow: 'rgba(20,12,30,0.28)',
    ui: { bg: '#15111c', panel: '#221b2d', panel2: '#2c2339', border: '#4a3b5e', text: '#f3ead7', muted: '#a596b8', gold: '#f2c14e', danger: '#e2504c', ok: '#6cc86a', accent: '#8f6bd9' },
    stone: ['#8d8597', '#6e6679', '#524b5d', '#3c3546'],
    wood: ['#a8703f', '#83532c', '#5e3a1f'],
    skin: ['#f6d2b0', '#e2ab7f', '#bf8358', '#8e5a37', '#5d3a24'],
    hair: ['#2b1d14', '#6b3f1f', '#c88a3a', '#e8d27a', '#b7b0a8', '#a23b2a'],
    capes: ['#c0392b', '#2f6fd1', '#2e9e57', '#8e44ad', '#e67e22', '#f1c40f', '#16a2a8', '#d35d9c', '#ecf0f1', '#34495e'],
    biome: {
      prairie: { ground: ['#69b847', '#6dbd4a', '#72c24d', '#66b444'], dark: '#3f7f2a', accent: ['#f7e463', '#f28cb1', '#ffffff', '#b58cf2'] },
      frost: { ground: ['#d3e3ee', '#d9e7f1', '#e0ecf4', '#cddfeb'], dark: '#7d9db8', accent: ['#9fd3ff', '#ffffff', '#6aa6d6'] },
      poison: { ground: ['#3e4b2b', '#42502d', '#3a4628', '#465530'], dark: '#1f2715', accent: ['#9dff3a', '#c6ff5e', '#58e01f', '#b14cff'] },
      fire: { ground: ['#3d2b27', '#432f29', '#382824', '#48312a'], dark: '#1c1210', accent: ['#ff7a1a', '#ffb02e', '#ff3d1a', '#ffd76a'] }
    },
    fx: { heal: '#7dff8a', poison: '#9dff3a', burn: '#ff7a1a', frost: '#9fd3ff', crit: '#ffd23f', shadow: '#5b4a7a', holy: '#ffe58a', xp: '#b58cf2' }
  };

  /* ------------------------------------------------------------------ */
  /* Classes                                                              */
  /* tier 0 = habitant, 1 = classe de base, 2 = spécialisation           */
  /* ------------------------------------------------------------------ */
  const CLASSES = {
    habitant: { name: 'Habitant', tier: 0, parent: null, color: '#b89b72', weapon: 'club', hp: 100, dmg: 8, range: 36, cd: 1.0, speed: 82, armor: 0, desc: 'Tout le monde commence ici. Un bâton, du courage.' },

    soldat: { name: 'Soldat', tier: 1, parent: 'habitant', color: '#c0392b', weapon: 'sword', shield: true, hp: 170, dmg: 12, range: 42, cd: 0.9, speed: 80, armor: 0.15, desc: 'Combattant au corps à corps, solide et fiable.' },
    paladin: { name: 'Paladin', tier: 2, parent: 'soldat', color: '#f2c14e', weapon: 'hammer', shield: true, hp: 240, dmg: 15, range: 46, cd: 0.95, speed: 78, armor: 0.25, ult: 'whirl', ultName: 'Tourbillon sacré', ultDesc: "Coup d'épée en cercle : 250% des dégâts à tous les ennemis autour.", desc: 'Rempart sacré du royaume.' },
    chevalier: { name: 'Chevalier', tier: 2, parent: 'soldat', color: '#2f6fd1', weapon: 'lance', shield: true, hp: 215, dmg: 17, range: 52, cd: 0.9, speed: 86, armor: 0.2, ult: 'charge', ultName: 'Charge héroïque', ultDesc: 'Charge en avant et inflige 200% de ses dégâts de base sur sa trajectoire.', desc: 'Lance au poing, toujours en première ligne.' },

    mage: { name: 'Mage', tier: 1, parent: 'habitant', color: '#8e44ad', weapon: 'staff', projectile: 'orb', hp: 90, dmg: 14, range: 260, cd: 1.2, speed: 75, armor: 0, desc: 'Lance des orbes arcaniques à distance.' },
    glace: { name: 'Mage de glace', tier: 2, parent: 'mage', color: '#6ec6ff', weapon: 'staff', projectile: 'ice', hp: 100, dmg: 15, range: 270, cd: 1.15, speed: 75, armor: 0.05, onHit: { slow: 0.35, dur: 1.5 }, ult: 'frostcone', ultName: 'Vague de froid', ultDesc: 'Cône glacial devant lui : 200% des dégâts et gèle les ennemis 2,5 s.', desc: 'Ralentit tout ce qu’il touche.' },
    feu: { name: 'Mage de feu', tier: 2, parent: 'mage', color: '#ff6a1a', weapon: 'staff', projectile: 'fire', hp: 95, dmg: 18, range: 270, cd: 1.2, speed: 75, armor: 0.03, onHit: { burn: 0.25, dur: 3 }, ult: 'fireball', ultName: 'Boule de feu', ultDesc: 'Énorme boule de feu qui explose : 400% des dégâts en zone.', desc: 'Tout finit en cendres.' },
    soin: { name: 'Mage de soin', tier: 2, parent: 'mage', color: '#7dff8a', weapon: 'staff', projectile: 'holy', hp: 110, dmg: 10, range: 240, cd: 1.2, speed: 78, armor: 0.05, healer: true, ult: 'massheal', ultName: 'Bénédiction', ultDesc: 'Soigne tous les alliés dans un rayon de 350 px (50% PV max).', desc: 'Soigne régulièrement l’allié le plus blessé.' },

    eleveur: { name: 'Éleveur', tier: 1, parent: 'habitant', color: '#2e9e57', weapon: 'whip', hp: 120, dmg: 9, range: 110, cd: 1.0, speed: 80, armor: 0.05, leash: 800, summons: { wolf: 1 }, desc: 'Combat aux côtés d’un loup apprivoisé.' },
    dompteur: { name: 'Dompteur', tier: 2, parent: 'eleveur', color: '#d98c3a', weapon: 'whip', hp: 150, dmg: 11, range: 120, cd: 1.0, speed: 80, armor: 0.08, leash: 800, summons: { wolf: 2, bear: 1 }, ult: 'beastcall', ultName: 'Cri de la meute', ultDesc: 'Soigne ses bêtes et augmente leurs dégâts de 60% pendant 8 s.', desc: 'Loups et ours obéissent à sa voix.' },
    necromancien: { name: 'Nécromancien', tier: 2, parent: 'eleveur', color: '#5b4a7a', weapon: 'scythe', hp: 130, dmg: 11, range: 140, cd: 1.0, speed: 78, armor: 0.05, leash: 800, raise: { chance: 0.35, max: 4 }, ult: 'revive', ultName: 'Relève-toi', ultDesc: 'Fait revenir un allié mort à 75% de ses PV ; le « zombie » perd 1% PV/s.', desc: 'Relève squelettes et zombies parmi les morts.' },

    archer: { name: 'Archer', tier: 1, parent: 'habitant', color: '#27ae60', weapon: 'bow', projectile: 'arrow', hp: 100, dmg: 11, range: 340, cd: 0.9, speed: 85, armor: 0.02, leash: 800, desc: 'Tire de loin, reste près de la tour.' },
    arbaletrier: { name: 'Arbalétrier', tier: 2, parent: 'archer', color: '#7f8c8d', weapon: 'crossbow', projectile: 'bolt', hp: 120, dmg: 17, range: 360, cd: 1.15, speed: 82, armor: 0.06, leash: 800, ult: 'rapidfire', ultName: 'Tir en rafale', ultDesc: 'Vitesse d’attaque ×3 pendant 6 s.', desc: 'Carreaux lourds, cadence implacable.' },
    arclong: { name: 'Arc long', tier: 2, parent: 'archer', color: '#16a085', weapon: 'longbow', projectile: 'arrow', hp: 110, dmg: 15, range: 460, cd: 1.0, speed: 85, armor: 0.04, leash: 800, ult: 'tripleshot', ultName: 'Triple flèche', ultDesc: '3 flèches perforantes à 150% des dégâts de base.', desc: 'La plus longue portée du royaume.' },

    assassin: { name: 'Assassin', tier: 1, parent: 'habitant', color: '#34495e', weapon: 'daggers', hp: 95, dmg: 15, range: 34, cd: 0.7, speed: 118, armor: 0.02, crit: 0.25, desc: 'Rapide, coups critiques fréquents.' },
    ombre: { name: 'Ombre', tier: 2, parent: 'assassin', color: '#5b4a7a', weapon: 'daggers', hp: 115, dmg: 18, range: 34, cd: 0.65, speed: 122, armor: 0.04, crit: 0.3, stealth: { every: 10, dur: 3 }, ult: 'smoke', ultName: 'Écran de fumée', ultDesc: 'Nuage de fumée : les alliés à l’intérieur deviennent invisibles pour les monstres.', desc: 'Disparaît toutes les 10 s.' },
    fleche: { name: 'Flèche', tier: 2, parent: 'assassin', color: '#e74c3c', weapon: 'daggers', hp: 110, dmg: 19, range: 34, cd: 0.7, speed: 125, armor: 0.03, crit: 0.3, dash: { every: 6, range: 320 }, ult: 'chaindash', ultName: 'Danse mortelle', ultDesc: 'Dash critique derrière un ennemi ; s’il meurt, enchaîne sur un autre, sans limite.', desc: 'Toutes les 6 s, surgit derrière l’ennemi le plus faible.' },

    paysan: { name: 'Paysan', tier: 1, parent: 'habitant', color: '#c8a24a', weapon: 'pitchfork', hp: 115, dmg: 7, range: 40, cd: 1.0, speed: 82, armor: 0.03, leash: 500, harvest: 'any', desc: 'Récolte des écus pour débloquer de meilleures améliorations.' },
    agriculteur: { name: 'Agriculteur', tier: 2, parent: 'paysan', color: '#f1c40f', weapon: 'scythe', hp: 135, dmg: 9, range: 42, cd: 1.0, speed: 82, armor: 0.05, leash: 500, harvest: 'field', ult: 'harvestheal', ultName: 'Festin', ultDesc: 'Soigne tous les alliés de 35% de leurs PV max.', desc: 'Les champs nourrissent l’armée.' },
    bucheron: { name: 'Bûcheron', tier: 2, parent: 'paysan', color: '#8b5a2b', weapon: 'axe', hp: 150, dmg: 11, range: 42, cd: 1.05, speed: 80, armor: 0.06, leash: 500, harvest: 'tree', ult: 'towerheal', ultName: 'Réparations', ultDesc: 'Soigne la tour de 12% de ses PV max.', desc: 'Du bois pour réparer les remparts.' },
    mineur: { name: 'Mineur', tier: 2, parent: 'paysan', color: '#95a5a6', weapon: 'pickaxe', hp: 145, dmg: 10, range: 40, cd: 1.0, speed: 78, armor: 0.08, leash: 500, harvest: 'rock', ult: 'fortify', ultName: 'Fortification', ultDesc: 'Augmente les PV max de la tour de 6%.', desc: 'La pierre rend la tour plus solide.' }
  };
  const BASE_CLASSES = ['soldat', 'mage', 'eleveur', 'archer', 'assassin', 'paysan'];
  const CLASS_IDS = Object.keys(CLASSES);
  const specsOf = (base) => CLASS_IDS.filter((id) => CLASSES[id].parent === base && CLASSES[id].tier === 2);

  /* ------------------------------------------------------------------ */
  /* Progression                                                         */
  /* ------------------------------------------------------------------ */
  // Le niveau n'augmente PAS les statistiques : seuls les points de stat (et l'équipement) le font.
  // Chaque niveau rapporte des points de stat et des glaçons.
  const PROGRESSION = {
    CLASS_LEVEL: 3, // niveau pour quitter « habitant »
    SPEC_LEVEL: 8, // niveau pour choisir une spécialisation
    MAX_LEVEL: 60,
    POINTS_PER_LEVEL: 1,
    GLACONS_PER_LEVEL: 1,
    XP_BASE: 60, // XP pour passer de lvl à lvl+1 = XP_BASE × lvl^XP_EXP
    XP_EXP: 1.45,
    xpForLevel: (lvl) => Math.round(PROGRESSION.XP_BASE * Math.pow(lvl, PROGRESSION.XP_EXP))
  };

  /*
   * Réglages généraux d'équilibrage (tous modifiables en direct depuis l'admin, onglet Équilibrage)
   */
  const BALANCE = {
    TOWER_BASE_HP: 200,
    ULT_TIME: 28, // secondes pour charger un ultime
    RESPAWN_TIME: 12, // secondes avant la réapparition d'un héros
    WAVE_HP_LINEAR: 0.1, // PV des monstres : × (1 + LIN×(m-1) + QUAD×(m-1)²)
    WAVE_HP_QUAD: 0.0025,
    WAVE_DMG: 0.045, // dégâts des monstres : × (1 + DMG×(m-1))
    HP_PER_HERO: 0.03, // PV des monstres en plus par héros présent
    MOB_COUNT_BASE: 6, // nombre de monstres : (BASE + PAR_MANCHE×m) × facteur joueurs
    MOB_COUNT_PER_WAVE: 1.5,
    MOB_COUNT_PER_HERO: 0.25,
    MOB_COUNT_HERO_CAP: 12,
    MAX_WAVE_MOBS: 450,
    ELITE_BASE: 0.02, // chance d'élite : BASE + PAR_MANCHE×m (max ELITE_MAX)
    ELITE_PER_WAVE: 0.003,
    ELITE_MAX: 0.25,
    ELITE_HP: 3.5,
    ELITE_DMG: 1.5,
    BOSS_HP_BASE: 0.6, // PV des boss : × (BASE + PAR_HÉROS × héros)
    BOSS_HP_PER_HERO: 0.25,
    WAVE_XP_BASE: 10, // récompense de fin de manche (par héros)
    WAVE_XP_PER_WAVE: 4,
    WAVE_GRELONS_BASE: 2,
    WAVE_GRELONS_PER_WAVE: 0.5,
    WAVE_ECUS_BASE: 15, // écus pour l'équipe en fin de manche
    WAVE_ECUS_PER_WAVE: 3,
    KILL_ECUS: 0.5, // part de la valeur d'un monstre versée en écus à l'équipe
    HARVEST_INTERVAL: 3, // paysans : une récolte toutes les X secondes
    HARVEST_BASE: 1.5,
    HARVEST_PER_LEVEL: 0.15
  };

  /* ------------------------------------------------------------------ */
  /* Statistiques : 1 point gagné à chaque niveau, réparti librement      */
  /* ------------------------------------------------------------------ */
  const pct = (v) => (Math.round(v * 1000) / 10).toString().replace('.', ',');
  const attr = (name, icon, per, what) => ({ name, icon, per, what, get desc() { return `+${pct(this.per)}% ${this.what} par point`; } });
  const ATTRIBUTES = {
    vie: attr('Vie', '❤️', 0.06, 'de PV max'),
    force: attr('Force', '⚔️', 0.05, 'de dégâts'),
    defense: attr('Défense', '🛡️', 0.02, 'de réduction des dégâts'),
    agilite: attr('Agilité', '🌀', 0.04, 'de vitesse d’attaque'),
    vitesse: attr('Vitesse', '👟', 0.03, 'de vitesse de déplacement'),
    critique: attr('Critique', '🎯', 0.015, 'de chances de coup critique')
  };
  const ATTR_IDS = Object.keys(ATTRIBUTES);
  const emptyAttrs = () => Object.fromEntries(ATTR_IDS.map((k) => [k, 0]));

  // Statistiques finales d'un héros (utilisé par le serveur ET affiché sur la page joueur)
  function computeStats(o) {
    const c = CLASSES[o.cls] || CLASSES.habitant;
    const a = { ...emptyAttrs(), ...(o.attrs || {}) };
    const up = o.upgrades || {};
    const gear = gearFor(o.cls, o.gear);
    let ihp = 0, iarmor = 0, idmg = 0, ispeed = 0;
    for (const s of SLOTS) if (gear[s]) { const st = itemStats(gear[s]); ihp += st.hp || 0; iarmor += st.armor || 0; idmg += st.dmg || 0; ispeed += st.speed || 0; }
    const sb = setBonuses(gear).bonus;
    const A = ATTRIBUTES;
    const baseDmg = c.dmg * (1 + A.force.per * a.force + idmg + (sb.dmg || 0));
    return {
      maxHp: Math.round(c.hp * (1 + ihp + (sb.hp || 0) + A.vie.per * a.vie)),
      baseDmg,
      dmg: baseDmg * (1 + 0.1 * (up.forge || 0)),
      armor: Math.min(0.75, (c.armor || 0) + iarmor + (sb.armor || 0) + A.defense.per * a.defense + 0.08 * (up.armory || 0)),
      cd: c.cd / (1 + A.agilite.per * a.agilite + (sb.atkspd || 0)),
      speed: c.speed * (1 + A.vitesse.per * a.vitesse + ispeed + (sb.speed || 0)),
      crit: Math.min(0.8, (c.crit || 0.05) + A.critique.per * a.critique + (sb.crit || 0)),
      ultRate: 1 + (sb.ult || 0),
      harvestMult: 1 + (sb.harvest || 0),
      range: c.range,
      leash: c.leash || 9999
    };
  }

  /* ------------------------------------------------------------------ */
  /* Équipement : objets uniques trouvés dans les glaçons                */
  /* Chaque objet = un modèle (pièce d'un set) + une rareté              */
  /* ------------------------------------------------------------------ */
  // Famille d'une classe : la classe de base (les spécialisations héritent de leur parent)
  const familyOf = (cls) => {
    const c = CLASSES[cls] || CLASSES.habitant;
    return c.tier === 2 ? c.parent : cls;
  };

  const SLOTS = ['head', 'body', 'legs', 'feet', 'weapon'];
  const SLOT_NAMES = { head: 'Casque', body: 'Torse', legs: 'Pantalon', feet: 'Chaussures', weapon: 'Arme' };

  // Raretés. « shape » = niveau de détail du dessin (1 à 4). La rareté mystique est secrète.
  const RARITIES = [
    { id: 'commun', name: 'Commun', color: '#b8b3c2', mult: 1, p: 0.5, shape: 1, recycle: 0.05 },
    { id: 'peu_commun', name: 'Peu commun', color: '#6cc86a', mult: 1.25, p: 0.28, shape: 1, recycle: 0.1 },
    { id: 'rare', name: 'Rare', color: '#4a9cff', mult: 1.55, p: 0.14, shape: 2, recycle: 0.2 },
    { id: 'epique', name: 'Épique', color: '#b066ff', mult: 1.9, p: 0.06, shape: 3, recycle: 0.4 },
    { id: 'legendaire', name: 'Légendaire', color: '#ff9f1a', mult: 2.4, p: 0.019, shape: 3, recycle: 0.7 },
    { id: 'mystique', name: 'Mystique', color: '#2fd6e0', mult: 3.2, p: 0.001, shape: 4, recycle: 1, hidden: true }
  ];
  function rollRarity(rnd) {
    let x = (rnd || Math.random)();
    for (let i = RARITIES.length - 1; i >= 0; i--) { x -= RARITIES[i].p; if (x < 0) return i; }
    return 0;
  }

  // Glaçons (coffres)
  // Contenu : 60% set universel, 35% set de sa classe, 5% set d'une AUTRE classe (à échanger sur la place marchande)
  const GLACONS = { PRICE: 75, PER_WAVE: 1, START: 3, UNIVERSAL_CHANCE: 0.6, OTHER_CLASS_CHANCE: 0.05 };
  // Recyclage : rapporte des Grêlons, une fraction du prix d'un glaçon selon la rareté (au maximum le prix d'un glaçon).
  // Le montant suit automatiquement GLACONS.PRICE.
  const recycleValue = (r) => Math.max(1, Math.round(GLACONS.PRICE * Math.min(1, (RARITIES[r] || RARITIES[0]).recycle)));

  /*
   * Styles de dessin (formes) : heavy (lourd), cloth (étoffe), leather (cuir), worker (travail).
   * Bonus de statistiques par style (multiplicateurs appliqués aux valeurs de base des emplacements).
   */
  const STYLE_MODS = { heavy: { hp: 1, armor: 1.5 }, cloth: { hp: 0.6, armor: 0.5, dmg: 0.04 }, leather: { hp: 0.8, armor: 0.9, speed: 0.025 }, worker: { hp: 1.3, armor: 0.8 } };
  const SLOT_BASE = { head: { hp: 0.05, armor: 0.015 }, body: { hp: 0.08, armor: 0.03 }, legs: { hp: 0.045, armor: 0.02 }, feet: { hp: 0.03, armor: 0.01 }, weapon: { dmg: 0.12 } };
  const STYLE_NOUNS = {
    heavy: { head: 'Heaume', body: 'Cuirasse', legs: 'Jambières', feet: 'Solerets' },
    cloth: { head: 'Chapeau', body: 'Robe', legs: 'Chausses', feet: 'Souliers' },
    leather: { head: 'Capuche', body: 'Brigandine', legs: 'Pantalon', feet: 'Bottes' },
    worker: { head: 'Chapeau', body: 'Tablier', legs: 'Salopette', feet: 'Bottes' }
  };

  /*
   * Sets. families = familles autorisées (null = toutes les classes).
   * bonus[n] = bonus actif quand n pièces du set sont portées (hp/dmg/armor/speed/crit/atkspd/ult/harvest).
   */
  const SETS = {
    rempart: { name: 'Rempart', of: 'du Rempart', families: ['soldat'], style: 'heavy', main: '#b8c1cc', trim: '#4e6d95', bonus: { 2: { hp: 0.1 }, 4: { armor: 0.08 }, 5: { dmg: 0.15 } } },
    arcaniste: { name: 'Arcaniste', of: 'de l’Arcaniste', families: ['mage'], style: 'cloth', main: '#3b5bb5', trim: '#f2c14e', bonus: { 2: { dmg: 0.1 }, 4: { ult: 0.25 }, 5: { dmg: 0.15 } } },
    maitrebete: { name: 'Maître-bête', of: 'du Maître-bête', families: ['eleveur'], style: 'leather', main: '#6e4526', trim: '#2e9e57', bonus: { 2: { hp: 0.1 }, 4: { dmg: 0.12 }, 5: { ult: 0.25 } } },
    faucon: { name: 'Œil-de-faucon', of: 'de l’Œil-de-faucon', families: ['archer'], style: 'leather', main: '#3f5a3a', trim: '#c8a24a', bonus: { 2: { crit: 0.05 }, 4: { atkspd: 0.15 }, 5: { dmg: 0.15 } } },
    lamenuit: { name: 'Lame-nuit', of: 'de la Lame-nuit', families: ['assassin'], style: 'leather', main: '#2b2433', trim: '#e74c3c', bonus: { 2: { speed: 0.1 }, 4: { crit: 0.1 }, 5: { dmg: 0.2 } } },
    moisson: { name: 'Moisson', of: 'de la Moisson', families: ['paysan'], style: 'worker', main: '#a35a2a', trim: '#f1c40f', bonus: { 2: { hp: 0.15 }, 4: { harvest: 0.3 }, 5: { armor: 0.1 } } },
    voyageur: { name: 'Voyageur', of: 'du Voyageur', families: null, style: 'leather', main: '#9a6a3e', trim: '#5e3a1f', bonus: { 2: { speed: 0.06 }, 4: { hp: 0.1 } } },
    givre: { name: 'Givre éternel', of: 'du Givre éternel', families: null, style: 'heavy', main: '#bfe6ff', trim: '#2f6fd1', bonus: { 2: { armor: 0.05 }, 4: { hp: 0.12 } } },
    braise: { name: 'Braise', of: 'de Braise', families: null, style: 'cloth', main: '#9b2f4a', trim: '#ff7a1a', bonus: { 2: { dmg: 0.06 }, 4: { crit: 0.06 } } }
  };
  // Modèles d'objets : une pièce par emplacement et par set (les sets de classe ont aussi une arme)
  const TEMPLATES = {};
  for (const [sid, set] of Object.entries(SETS)) {
    for (const slot of SLOTS) {
      if (slot === 'weapon' && !set.families) continue;
      const base = SLOT_BASE[slot], m = STYLE_MODS[set.style];
      TEMPLATES[`${sid}_${slot}`] = {
        set: sid, slot, style: set.style, families: set.families,
        name: slot === 'weapon' ? `Arme ${set.of}` : `${STYLE_NOUNS[set.style][slot]} ${set.of}`,
        hp: (base.hp || 0) * (m.hp || 1), armor: (base.armor || 0) * (m.armor || 1), dmg: (base.dmg || 0) + (slot !== 'weapon' ? m.dmg || 0 : 0), speed: slot === 'feet' ? (m.speed || 0) * 2 : m.speed || 0
      };
    }
  }
  const STAT_NAMES = { hp: 'PV', dmg: 'dégâts', armor: 'défense', speed: 'vitesse', crit: 'critique', atkspd: 'vitesse d’attaque', ult: 'charge de l’ultime', harvest: 'récolte' };

  // Un objet (modèle) est-il utilisable par cette classe ?
  function canUse(tid, cls) {
    const t = TEMPLATES[tid];
    if (!t) return false;
    return !t.families || t.families.includes(familyOf(cls));
  }
  // Statistiques d'un objet selon sa rareté
  function itemStats(item) {
    const t = TEMPLATES[item.t], r = RARITIES[item.r] || RARITIES[0];
    if (!t) return {};
    const out = {};
    for (const k of ['hp', 'armor', 'dmg', 'speed']) if (t[k]) out[k] = +(t[k] * r.mult).toFixed(3);
    return out;
  }
  // Nom affiché : les armes prennent le nom de l'arme réelle de la classe (marteau, arbalète…)
  const WEAPON_KIND = { club: 'Gourdin', sword: 'Épée', hammer: 'Marteau', lance: 'Lance', staff: 'Bâton', whip: 'Fouet', scythe: 'Faux', bow: 'Arc', longbow: 'Arc long', crossbow: 'Arbalète', daggers: 'Dagues', pitchfork: 'Fourche', axe: 'Hache', pickaxe: 'Pioche' };
  function itemName(item, cls) {
    const t = TEMPLATES[item && item.t];
    if (!t) return '?';
    if (t.slot !== 'weapon') return t.name;
    const fam = t.families[0];
    const c = cls && familyOf(cls) === fam ? CLASSES[cls] : CLASSES[fam];
    return `${WEAPON_KIND[c.weapon] || 'Arme'} ${SETS[t.set].of}`;
  }
  // Équipement porté et utilisable : { slot: {t, r} | null }
  function gearFor(cls, gear) {
    const out = {};
    for (const s of SLOTS) {
      const it = (gear || {})[s];
      out[s] = it && TEMPLATES[it.t] && TEMPLATES[it.t].slot === s && canUse(it.t, cls) ? it : null;
    }
    return out;
  }
  // Nombre de pièces portées par set et bonus actifs
  function setBonuses(gear) {
    const count = {};
    for (const it of Object.values(gear)) if (it) { const s = TEMPLATES[it.t].set; count[s] = (count[s] || 0) + 1; }
    const bonus = {};
    const active = [];
    for (const [sid, n] of Object.entries(count)) {
      for (const [need, b] of Object.entries(SETS[sid].bonus)) {
        if (n >= Number(need)) { active.push({ set: sid, pieces: Number(need), bonus: b }); for (const [k, v] of Object.entries(b)) bonus[k] = (bonus[k] || 0) + v; }
      }
    }
    return { count, bonus, active };
  }
  // Apparence d'une pièce pour le dessin
  function itemLook(item) {
    const t = TEMPLATES[item && item.t];
    if (!t) return null;
    const set = SETS[t.set], r = RARITIES[item.r] || RARITIES[0];
    return { style: t.style, shape: r.shape, main: set.main, trim: item.r >= 5 ? '#2fd6e0' : item.r >= 4 ? '#f2c14e' : set.trim, rune: item.r >= 5, rarity: item.r };
  }
  // Couleur du métal des armes selon le niveau de forme (0 = arme de départ)
  const WEAPON_METAL = ['#d8dde3', '#c9cfd6', '#eef3f8', '#9fd3ff', '#f2c14e'];

  /* ------------------------------------------------------------------ */
  /* IA personnalisable                                                  */
  /* ------------------------------------------------------------------ */
  const AI_OPTIONS = {
    stance: { offensive: 'Offensive (chasse partout)', balanced: 'Équilibrée', defensive: 'Défensive (près de la tour)' },
    target: { nearest: 'Le plus proche', weakest: 'Le plus faible', strongest: 'Le plus fort (élites, boss)', tower: 'Ceux qui attaquent la tour' },
    retreat: { 0: 'Jamais', 25: 'Sous 25% PV', 50: 'Sous 50% PV' },
    ult: { asap: 'Dès qu’il est prêt', smart: 'Au bon moment (groupe / urgence)', boss: 'Garder pour les boss' }
  };
  const DEFAULT_AI = { stance: 'balanced', target: 'nearest', retreat: 25, ult: 'smart' };

  /* ------------------------------------------------------------------ */
  /* Monstres                                                            */
  /* era : 1 = givre (1-30), 2 = corruption (31-60), 3 = feu (61-90)      */
  /* ------------------------------------------------------------------ */
  const MOBS = {
    // Ère 1 — prairie / givre
    gobelin: { name: 'Gobelin', era: 1, from: 1, shape: 'goblin', color: '#5fae3a', hp: 32, dmg: 5, speed: 62, range: 22, cd: 1, size: 13, xp: 4, gold: 1, w: 10 },
    loup: { name: 'Loup', era: 1, from: 2, shape: 'wolf', color: '#8a8378', hp: 24, dmg: 4, speed: 108, range: 22, cd: 0.8, size: 13, xp: 4, gold: 1, w: 7 },
    gobelin_archer: { name: 'Gobelin archer', era: 1, from: 3, shape: 'goblin', bow: true, color: '#4d8f2f', hp: 22, dmg: 5, speed: 58, range: 200, cd: 1.6, size: 12, ranged: 'arrow', xp: 5, gold: 1, w: 5 },
    sanglier: { name: 'Sanglier', era: 1, from: 4, shape: 'boar', color: '#7a5135', hp: 65, dmg: 9, speed: 72, range: 24, cd: 1.1, size: 16, xp: 7, gold: 2, w: 5 },
    loup_neige: { name: 'Loup des neiges', era: 1, from: 6, shape: 'wolf', color: '#e3edf5', hp: 42, dmg: 6, speed: 112, range: 22, cd: 0.8, size: 14, onHit: { slow: 0.25, dur: 1.2 }, xp: 7, gold: 2, w: 6 },
    golem_glace: { name: 'Golem de glace', era: 1, from: 11, shape: 'golem', color: '#9fd3ff', hp: 170, dmg: 14, speed: 40, range: 30, cd: 1.6, size: 22, xp: 18, gold: 5, w: 3 },
    esprit_givre: { name: 'Esprit du givre', era: 1, from: 16, shape: 'wisp', color: '#bfe6ff', hp: 38, dmg: 7, speed: 70, range: 220, cd: 1.8, size: 12, ranged: 'frost', onHit: { slow: 0.3, dur: 1.5 }, xp: 9, gold: 2, w: 4 },
    treant: { name: 'Arbre déraciné', era: 1, from: 999, shape: 'treant', color: '#2f6b4a', hp: 130, dmg: 12, speed: 46, range: 30, cd: 1.4, size: 20, xp: 14, gold: 4, w: 0 },

    // Ère 2 — corruption verte
    rampant: { name: 'Rampant putride', era: 2, from: 31, shape: 'crawler', color: '#7fd13b', hp: 80, dmg: 8, speed: 70, range: 22, cd: 1, size: 14, onHit: { poison: 3, dur: 4 }, xp: 10, gold: 3, w: 9 },
    crapaud: { name: 'Crapaud toxique', era: 2, from: 32, shape: 'toad', color: '#58a62a', hp: 60, dmg: 7, speed: 55, range: 210, cd: 1.8, size: 14, ranged: 'poison', onHit: { poison: 3, dur: 3 }, xp: 11, gold: 3, w: 5 },
    champignon: { name: 'Champignon explosif', era: 2, from: 33, shape: 'shroom', color: '#b14cff', hp: 50, dmg: 26, speed: 78, range: 26, cd: 1, size: 13, explode: { radius: 90, poison: 4, dur: 4 }, xp: 9, gold: 3, w: 4 },
    mutant: { name: 'Mutant', era: 2, from: 36, shape: 'zombie', color: '#6b8f3a', hp: 240, dmg: 16, speed: 42, range: 28, cd: 1.5, size: 20, xp: 22, gold: 6, w: 3 },
    araignee: { name: 'Araignée', era: 2, from: 40, shape: 'spider', color: '#3e4a2a', hp: 45, dmg: 6, speed: 120, range: 20, cd: 0.7, size: 11, onHit: { poison: 2, dur: 3 }, xp: 7, gold: 2, w: 5 },

    // Ère 3 — feu
    diablotin: { name: 'Diablotin', era: 3, from: 61, shape: 'imp', color: '#e5462e', hp: 90, dmg: 10, speed: 105, range: 22, cd: 0.8, size: 12, onHit: { burn: 3, dur: 3 }, xp: 12, gold: 3, w: 9 },
    salamandre: { name: 'Salamandre', era: 3, from: 62, shape: 'salamander', color: '#ff8a1a', hp: 80, dmg: 10, speed: 60, range: 230, cd: 1.7, size: 14, ranged: 'fire', onHit: { burn: 3, dur: 3 }, xp: 13, gold: 3, w: 5 },
    chien_infernal: { name: 'Chien infernal', era: 3, from: 64, shape: 'hound', color: '#5a2320', hp: 120, dmg: 13, speed: 120, range: 24, cd: 0.8, size: 15, xp: 14, gold: 4, w: 5 },
    elementaire: { name: 'Élémentaire de feu', era: 3, from: 67, shape: 'elemental', color: '#ff7a1a', hp: 360, dmg: 20, speed: 40, range: 30, cd: 1.5, size: 22, aura: { burn: 2, radius: 70 }, xp: 28, gold: 8, w: 3 },

    // Bosses (abilities : slam / summon / volley / charge)
    sanglier_geant: { name: 'Sanglier géant', boss: 1, shape: 'boar', color: '#5e3a22', hp: 900, dmg: 22, speed: 55, range: 40, cd: 1.4, size: 38, xp: 120, gold: 40, abilities: [{ type: 'charge', cd: 7, dmg: 2 }] },
    yeti: { name: 'Yéti', boss: 1, shape: 'golem', color: '#f2f6fa', hp: 1600, dmg: 28, speed: 50, range: 46, cd: 1.6, size: 42, xp: 180, gold: 60, abilities: [{ type: 'slam', cd: 6, radius: 150, dmg: 1.5, slow: 0.4 }] },
    loup_alpha: { name: 'Loup alpha', boss: 1, shape: 'wolf', color: '#5c5650', hp: 2200, dmg: 30, speed: 90, range: 40, cd: 1, size: 36, xp: 240, gold: 80, abilities: [{ type: 'summon', cd: 8, mob: 'loup_neige', count: 4 }] },
    golem_ancien: { name: 'Golem de givre ancien', boss: 1, shape: 'golem', color: '#7cb8e8', hp: 3600, dmg: 40, speed: 38, range: 50, cd: 1.8, size: 48, xp: 320, gold: 110, abilities: [{ type: 'slam', cd: 6, radius: 180, dmg: 1.5, slow: 0.5 }, { type: 'volley', cd: 9, count: 12, proj: 'frost', dmg: 0.6 }] },
    sorciere_givre: { name: 'Sorcière du givre', boss: 1, shape: 'wisp', color: '#d6f0ff', hp: 3800, dmg: 30, speed: 55, range: 260, cd: 1.4, size: 34, ranged: 'frost', onHit: { slow: 0.4, dur: 2 }, xp: 380, gold: 130, abilities: [{ type: 'volley', cd: 5, count: 16, proj: 'frost', dmg: 0.7 }, { type: 'summon', cd: 10, mob: 'esprit_givre', count: 4 }] },
    treant_colossal: { name: 'Tréant colossal', boss: 2, shape: 'treant', color: '#24563a', hp: 9000, dmg: 55, speed: 32, range: 60, cd: 2, size: 70, xp: 900, gold: 350, abilities: [{ type: 'slam', cd: 6, radius: 220, dmg: 1.4, slow: 0.4 }, { type: 'summon', cd: 9, mob: 'treant', count: 3 }] },

    crapaud_roi: { name: 'Crapaud-roi', boss: 1, shape: 'toad', color: '#3f8a1e', hp: 6500, dmg: 45, speed: 45, range: 240, cd: 1.6, size: 40, ranged: 'poison', onHit: { poison: 6, dur: 4 }, xp: 450, gold: 150, abilities: [{ type: 'volley', cd: 6, count: 14, proj: 'poison', dmg: 0.6 }] },
    araignee_reine: { name: 'Araignée reine', boss: 1, shape: 'spider', color: '#2b3320', hp: 8000, dmg: 50, speed: 70, range: 46, cd: 1.2, size: 42, onHit: { poison: 6, dur: 4 }, xp: 520, gold: 170, abilities: [{ type: 'summon', cd: 7, mob: 'araignee', count: 6 }] },
    champignon_titan: { name: 'Champignon titan', boss: 1, shape: 'shroom', color: '#9a2fe6', hp: 10000, dmg: 55, speed: 40, range: 50, cd: 1.6, size: 48, xp: 600, gold: 190, abilities: [{ type: 'slam', cd: 6, radius: 200, dmg: 1.2, poison: 8 }, { type: 'summon', cd: 9, mob: 'champignon', count: 4 }] },
    abomination: { name: 'Abomination', boss: 1, shape: 'zombie', color: '#4f6e2a', hp: 13000, dmg: 70, speed: 42, range: 56, cd: 1.6, size: 52, xp: 700, gold: 220, abilities: [{ type: 'charge', cd: 7, dmg: 2 }, { type: 'slam', cd: 8, radius: 170, dmg: 1.3, poison: 6 }] },
    liche_putride: { name: 'Liche putride', boss: 1, shape: 'wisp', color: '#a8ff5e', hp: 14000, dmg: 55, speed: 55, range: 280, cd: 1.3, size: 38, ranged: 'poison', onHit: { poison: 8, dur: 4 }, xp: 800, gold: 250, abilities: [{ type: 'volley', cd: 5, count: 18, proj: 'poison', dmg: 0.6 }, { type: 'summon', cd: 10, mob: 'mutant', count: 2 }] },
    mere_spore: { name: 'La Mère-Spore', boss: 2, shape: 'mother', color: '#c6ff5e', hp: 32000, dmg: 80, speed: 28, range: 70, cd: 2, size: 80, xp: 2000, gold: 700, abilities: [{ type: 'volley', cd: 5, count: 20, proj: 'poison', dmg: 0.5 }, { type: 'summon', cd: 7, mob: 'champignon', count: 5 }, { type: 'slam', cd: 9, radius: 260, dmg: 1.2, poison: 10 }] },

    seigneur_diablotin: { name: 'Seigneur diablotin', boss: 1, shape: 'imp', color: '#b8251a', hp: 18000, dmg: 75, speed: 80, range: 46, cd: 1, size: 36, onHit: { burn: 8, dur: 3 }, xp: 900, gold: 280, abilities: [{ type: 'summon', cd: 6, mob: 'diablotin', count: 6 }] },
    salamandre_ancienne: { name: 'Salamandre ancienne', boss: 1, shape: 'salamander', color: '#ff5a1a', hp: 21000, dmg: 70, speed: 50, range: 280, cd: 1.4, size: 44, ranged: 'fire', onHit: { burn: 10, dur: 3 }, xp: 1000, gold: 300, abilities: [{ type: 'volley', cd: 5, count: 18, proj: 'fire', dmg: 0.6 }] },
    cerbere: { name: 'Cerbère', boss: 1, shape: 'hound', color: '#3a1512', hp: 25000, dmg: 90, speed: 95, range: 50, cd: 0.9, size: 46, xp: 1100, gold: 330, abilities: [{ type: 'charge', cd: 6, dmg: 2 }, { type: 'summon', cd: 9, mob: 'chien_infernal', count: 3 }] },
    golem_obsidienne: { name: 'Golem d’obsidienne', boss: 1, shape: 'golem', color: '#2a2030', hp: 32000, dmg: 110, speed: 36, range: 56, cd: 1.8, size: 54, xp: 1300, gold: 380, abilities: [{ type: 'slam', cd: 6, radius: 220, dmg: 1.4, burn: 10 }] },
    phenix_noir: { name: 'Phénix noir', boss: 1, shape: 'wisp', color: '#ff3d1a', hp: 30000, dmg: 80, speed: 75, range: 300, cd: 1.2, size: 40, ranged: 'fire', onHit: { burn: 10, dur: 3 }, xp: 1400, gold: 400, abilities: [{ type: 'volley', cd: 4, count: 20, proj: 'fire', dmg: 0.55 }] },
    geant_magma: { name: 'Géant de magma', boss: 2, shape: 'elemental', color: '#ff5a1a', hp: 70000, dmg: 140, speed: 30, range: 80, cd: 2, size: 90, aura: { burn: 8, radius: 160 }, xp: 4000, gold: 1200, abilities: [{ type: 'slam', cd: 6, radius: 280, dmg: 1.4, burn: 14 }, { type: 'volley', cd: 7, count: 22, proj: 'fire', dmg: 0.5 }, { type: 'summon', cd: 10, mob: 'elementaire', count: 2 }] },

    // Invocations alliées (dessinées avec le même style)
    ally_wolf: { name: 'Loup', ally: true, shape: 'wolf', color: '#9a8a74', hp: 0.6, dmg: 0.6, speed: 115, range: 22, cd: 0.8, size: 12 },
    ally_bear: { name: 'Ours', ally: true, shape: 'boar', color: '#6b4a2e', hp: 1.6, dmg: 1.0, speed: 75, range: 30, cd: 1.3, size: 18 },
    ally_skeleton: { name: 'Squelette', ally: true, shape: 'skeleton', color: '#e8e2cf', hp: 0.5, dmg: 0.5, speed: 85, range: 24, cd: 1, size: 12 }
  };
  const MOB_IDS = Object.keys(MOBS);

  // Bosses par manche
  const BOSS_WAVES = {
    5: ['sanglier_geant'], 10: ['yeti'], 15: ['loup_alpha'], 20: ['golem_ancien'], 25: ['sorciere_givre'], 30: ['treant_colossal'],
    35: ['crapaud_roi'], 40: ['araignee_reine'], 45: ['champignon_titan'], 50: ['abomination'], 55: ['liche_putride'], 60: ['mere_spore'],
    65: ['seigneur_diablotin'], 70: ['salamandre_ancienne'], 75: ['cerbere'], 80: ['golem_obsidienne'], 85: ['phenix_noir'], 90: ['geant_magma'],
    95: ['golem_ancien', 'liche_putride', 'cerbere'],
    100: ['treant_colossal', 'mere_spore', 'geant_magma']
  };

  /* ------------------------------------------------------------------ */
  /* Améliorations d'équipe                 */
  /* ------------------------------------------------------------------ */

  // Améliorations d'équipe (votées pendant l'entracte avec les écus de la partie)
  const UPGRADES = {
    walls: { name: 'Remparts', icon: '🧱', desc: '+15% PV max de la tour (et soin équivalent)', cost: 60, growth: 1.5, max: 10, unlock: 0 },
    ballista: { name: 'Baliste', icon: '🏹', desc: 'La tour tire sur les ennemis (+1 niveau de baliste)', cost: 80, growth: 1.6, max: 8, unlock: 0 },
    forge: { name: 'Forge', icon: '🔨', desc: '+10% dégâts pour tous les héros', cost: 100, growth: 1.55, max: 10, unlock: 0 },
    infirmary: { name: 'Infirmerie', icon: '⛑️', desc: 'Régénération près de la tour, réapparition plus rapide', cost: 90, growth: 1.6, max: 6, unlock: 0 },
    armory: { name: 'Armurerie', icon: '🛡️', desc: '+8% de réduction de dégâts pour les héros', cost: 150, growth: 1.6, max: 5, unlock: 250 },
    shrine: { name: 'Autel arcanique', icon: '🔮', desc: 'Les ultimes se chargent 20% plus vite', cost: 220, growth: 1.7, max: 5, unlock: 400 },
    catapult: { name: 'Catapulte', icon: '☄️', desc: 'La tour lance des rochers explosifs', cost: 400, growth: 1.7, max: 5, unlock: 800 },
    banner: { name: 'Étendard royal', icon: '🚩', desc: '+20% d’XP et de Grêlons gagnés', cost: 350, growth: 1.8, max: 5, unlock: 600 },
    pact: { name: 'Pacte de sang', icon: '💀', desc: 'Manche suivante : ennemis +50% PV et nombre, récompenses ×2', cost: 0, growth: 1, max: 999, unlock: 0, challenge: true }
  };

  /* ------------------------------------------------------------------ */
  /* Biomes / ères                                                       */
  /* ------------------------------------------------------------------ */
  const ERAS = [
    { id: 'frost', name: 'L’Hiver éternel', from: 1, to: 30 },
    { id: 'poison', name: 'La Corruption', from: 31, to: 60 },
    { id: 'fire', name: 'Les Terres brûlées', from: 61, to: 90 },
    { id: 'mix', name: 'Le Chaos', from: 91, to: 100 }
  ];
  const eraOfWave = (w) => ERAS.find((e) => w >= e.from && w <= e.to) || ERAS[ERAS.length - 1];

  /* Codes réseau compacts (instantanés serveur -> écran) */
  const NET = {
    PROJ_KINDS: ['arrow', 'bolt', 'orb', 'ice', 'fire', 'holy', 'frost', 'poison', 'fireball', 'rock', 'ballista'],
    ZONE_KINDS: ['smoke', 'poison', 'telegraph', 'tline', 'fire'],
    HF: { DEAD: 1, STEALTH: 2, ZOMBIE: 4, ATTACK: 8, FURY: 16, SHIELD: 32, SLOW: 64, POISON: 128, BURN: 256, HARVEST: 512, ULT: 1024, RETREAT: 2048, DASH: 4096 },
    MF: { ELITE: 1, BOSS: 2, ATTACK: 4, SLOW: 8, POISON: 16, BURN: 32, CHARGE: 64, FROZEN: 128 }
  };

  // Modifie une valeur d'équilibrage (chemin = ['MOBS', 'gobelin', 'hp'])
  const ROOTS = () => ({ BALANCE, PROGRESSION, ATTRIBUTES, GLACONS, RARITIES, CLASSES, MOBS, UPGRADES, TEMPLATES, SETS });
  function getPath(path) {
    let o = ROOTS()[path[0]];
    for (let i = 1; i < path.length && o != null; i++) o = o[path[i]];
    return o;
  }
  function setPath(path, value) {
    let o = ROOTS()[path[0]];
    for (let i = 1; i < path.length - 1; i++) { if (o[path[i]] == null) o[path[i]] = {}; o = o[path[i]]; }
    o[path[path.length - 1]] = value;
  }
  function applyBalance(overrides) {
    for (const [k, v] of Object.entries(overrides || {})) { try { setPath(k.split('.'), v); } catch (e) { /* chemin obsolète */ } }
  }

  return { getPath, setPath, applyBalance, BALANCE, NET, WORLD, PALETTE, CLASSES, BASE_CLASSES, CLASS_IDS, specsOf, PROGRESSION, ATTRIBUTES, ATTR_IDS, emptyAttrs, computeStats, familyOf, SLOTS, SLOT_NAMES, RARITIES, rollRarity, GLACONS, recycleValue, SETS, TEMPLATES, STAT_NAMES, canUse, itemStats, itemName, gearFor, setBonuses, itemLook, WEAPON_METAL, AI_OPTIONS, DEFAULT_AI, MOBS, MOB_IDS, BOSS_WAVES, UPGRADES, ERAS, eraOfWave };
});
