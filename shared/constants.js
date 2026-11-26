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
  // Dézoom du stream pendant les vagues : les monstres apparaissent au bord de cette vue élargie (dans la brume)
  WORLD.WAVE_ZOOM = 0.75;
  WORLD.SPAWN_MX = Math.round((WORLD.W / WORLD.WAVE_ZOOM - WORLD.W) / 2); // marge horizontale visible au-delà de la carte
  WORLD.SPAWN_MY = Math.round((WORLD.H / WORLD.WAVE_ZOOM - WORLD.H) / 2); // marge verticale

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
    // 5 teintes naturelles puis 5 teintes fantaisie (orange, rouge, bleu, vert, violet)
    skin: ['#f6d2b0', '#e2ab7f', '#bf8358', '#8e5a37', '#5d3a24', '#f0904a', '#d9503f', '#6a9ae8', '#7cc46a', '#a07ad8'],
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
    habitant: { name: 'Paysan', tier: 0, parent: null, color: '#b89b72', weapon: 'club', hp: 100, dmg: 8, range: 36, cd: 1.0, speed: 82, armor: 0, desc: 'Tout le monde commence ici, au centre de l’arbre. Un bâton, du courage.' },

    soldat: { name: 'Soldat', tier: 1, parent: 'habitant', guard: { r: 120, red: 0.1 }, color: '#c0392b', weapon: 'sword', shield: true, hp: 170, dmg: 12, range: 42, cd: 0.9, speed: 80, armor: 0.15, desc: 'Combattant au corps à corps, solide et fiable.' },
    paladin: { name: 'Paladin', tier: 2, parent: 'soldat', parry: { chance: 0.15, heal: 0.05 }, color: '#f2c14e', weapon: 'hammer', shield: true, hp: 240, dmg: 15, range: 46, cd: 0.95, speed: 78, armor: 0.25, ult: 'whirl', ultName: 'Tourbillon sacré', ultDesc: "Coup d'épée en cercle : 250% des dégâts à tous les ennemis autour.", desc: 'Rempart sacré du royaume.' },
    berserker: { name: 'Barbare', tier: 2, parent: 'soldat', color: '#a8322d', weapon: 'greataxe', hp: 225, dmg: 18, range: 46, cd: 0.95, speed: 84, armor: 0.12, rage: { max: 0.4, leech: 0.03 }, ult: 'frenzy', ultName: 'Frénésie', ultDesc: 'Pendant 8 s : +50 % de vitesse d’attaque, ne peut pas tomber sous 1 PV, chaque coup touche les ennemis proches. Ensuite ralenti 2 s.', desc: 'Plus il est blessé, plus il frappe fort (+40 % de dégâts sous 30 % de PV) ; se soigne de 3 % des dégâts infligés.' },
    chevalier: { name: 'Chevalier', tier: 2, parent: 'soldat', momentum: { dist: 150, mult: 2, stun: 0.5 }, color: '#2f6fd1', weapon: 'lance', shield: true, mount: 'horse', hp: 215, dmg: 17, range: 52, cd: 0.9, speed: 86, armor: 0.2, ult: 'charge', ultName: 'Charge héroïque', ultDesc: 'Charge en avant et inflige 200% de ses dégâts de base sur sa trajectoire.', desc: 'Lance au poing, toujours en première ligne. Monte à cheval (+16 % de vitesse) une fois l’ultime débloqué.' },

    mage: { name: 'Mage', tier: 1, parent: 'habitant', unstable: { every: 5, r: 60, mult: 0.8 }, color: '#8e44ad', weapon: 'staff', projectile: 'orb', hp: 90, dmg: 14, range: 260, cd: 1.2, speed: 75, armor: 0, desc: 'Lance des orbes arcaniques à distance.' },
    glace: { name: 'Mage de glace', tier: 2, parent: 'mage', color: '#6ec6ff', weapon: 'staff', projectile: 'ice', hp: 100, dmg: 15, range: 270, cd: 1.15, speed: 75, armor: 0.05, onHit: { slow: 0.35, dur: 1.5 }, ult: 'frostcone', ultName: 'Vague de froid', ultDesc: 'Cône glacial devant lui : 150 % des dégâts et gèle les ennemis 2,5 s.', desc: 'Ralentit tout ce qu’il touche.' },
    feu: { name: 'Mage de feu', tier: 2, parent: 'mage', color: '#ff6a1a', weapon: 'staff', projectile: 'fire', hp: 95, dmg: 18, range: 270, cd: 1.2, speed: 75, armor: 0.03, onHit: { burn: 0.25, dur: 3 }, ult: 'fireball', ultName: 'Boule de feu', ultDesc: 'Énorme boule de feu qui explose : 300 % des dégâts de base du héros en zone.', desc: 'Tout finit en cendres.' },
    soin: { name: 'Mage de soin', tier: 2, parent: 'mage', color: '#7dff8a', weapon: 'staff', projectile: 'holy', hp: 110, dmg: 10, range: 240, cd: 1.2, speed: 78, armor: 0.05, healer: true, ult: 'massheal', ultName: 'Bénédiction', ultDesc: 'Soigne tous les alliés de 75 % de leurs PV max.', desc: 'Soigne régulièrement l’allié le plus blessé.' },

    eleveur: { name: 'Éleveur', tier: 1, parent: 'habitant', color: '#2e9e57', weapon: 'whip', hp: 120, dmg: 9, range: 110, cd: 1.0, speed: 80, armor: 0.05, summons: { wolf: 1 }, desc: 'Combat aux côtés d’un loup apprivoisé.' },
    dompteur: { name: 'Dompteur', tier: 2, parent: 'eleveur', color: '#d98c3a', weapon: 'whip', hp: 150, dmg: 11, range: 120, cd: 1.0, speed: 80, armor: 0.08, pets: ['rat', 'wolf', 'bear'], extraPets: ['bear', 'wolf', 'rat'], ult: 'beastcall', ultName: 'Cri de la meute', ultDesc: 'Soigne ses bêtes et augmente leurs dégâts de 50 % pendant 10 s.', desc: 'Rats, loups et ours obéissent à sa voix (6 invocations au plus).' },
    fauconnier: { name: 'Fauconnier', tier: 2, parent: 'eleveur', color: '#b5835a', weapon: 'falcon', hp: 135, dmg: 11, range: 130, cd: 1.0, speed: 82, armor: 0.06, pets: ['pigeon', 'eagle', 'falcon'], extraPets: ['falcon', 'eagle', 'pigeon'], ult: 'hawkstorm', ultName: 'Nuée de rapaces', ultDesc: 'Ses oiseaux sont soignés et foncent sur les ennemis les plus proches : ils les aveuglent définitivement et font 50 % de dégâts en plus pendant 5 s.', desc: 'Ses pigeons harcèlent les ennemis, son aigle les marque (+100 % de dégâts reçus), ses faucons frappent fort (6 invocations au plus).' },
    necromancien: { name: 'Nécromancien', tier: 2, parent: 'eleveur', color: '#5b4a7a', weapon: 'scythe', hp: 130, dmg: 11, range: 140, cd: 1.0, speed: 78, armor: 0.05, pets: ['slime', 'zombie', 'skelarcher'], extraPets: ['skelarcher', 'zombie', 'slime'], ult: 'revive', ultName: 'Relève-toi', ultDesc: 'Ramène un allié mort à la vie avec 60 % de ses PV (sans allié mort : invoque 3 de ses créatures en renfort).', desc: 'Invoque slimes, zombies et squelettes archers (6 invocations au plus).' },

    archer: { name: 'Archer', tier: 1, parent: 'habitant', pierce: 2, color: '#27ae60', weapon: 'bow', projectile: 'arrow', hp: 100, dmg: 11, range: 340, cd: 0.9, speed: 85, armor: 0.02, desc: 'Tire de très loin.' },
    arbaletrier: { name: 'Arbalétrier', tier: 2, parent: 'archer', knock: 25, color: '#7f8c8d', weapon: 'crossbow', projectile: 'bolt', hp: 120, dmg: 17, range: 360, cd: 1.15, speed: 82, armor: 0.06, ult: 'rapidfire', ultName: 'Tir en rafale', ultDesc: 'Vitesse d’attaque ×3 pendant 6 s.', desc: 'Carreaux lourds, cadence implacable.' },
    trappeur: { name: 'Trappeur', tier: 2, parent: 'archer', color: '#6b8e23', weapon: 'shortbow', projectile: 'arrow', hp: 120, dmg: 13, range: 300, cd: 0.85, speed: 86, armor: 0.04, traps: { every: 6, max: 4, root: 2, mult: 3 }, ult: 'thorns', ultName: 'Champ de ronces', ultDesc: 'Zone de ronces géante pendant 10 s sur le flanc le plus menacé : monstres ralentis de 60 %.', desc: 'Pose des pièges à mâchoires qui immobilisent les monstres.' },
    arclong: { name: 'Arc long', tier: 2, parent: 'archer', farshot: { per: 20, max: 0.25 }, color: '#16a085', weapon: 'longbow', projectile: 'arrow', hp: 110, dmg: 15, range: 460, cd: 1.0, speed: 85, armor: 0.04, ult: 'tripleshot', ultName: 'Triple flèche', ultDesc: '3 flèches perforantes à 150% des dégâts de base.', desc: 'La plus longue portée du royaume.' },

    assassin: { name: 'Assassin', tier: 1, parent: 'habitant', backstab: 0.5, color: '#34495e', weapon: 'daggers', hp: 95, dmg: 15, range: 34, cd: 0.7, speed: 118, armor: 0.02, crit: 0.25, desc: 'Rapide, coups critiques fréquents.' },
    ombre: { name: 'Ombre', tier: 2, parent: 'assassin', color: '#5b4a7a', weapon: 'daggers', hp: 115, dmg: 18, range: 34, cd: 0.65, speed: 122, armor: 0.04, crit: 0.3, stealth: { every: 10, dur: 3 }, ult: 'smoke', ultName: 'Écran de fumée', ultDesc: 'Nuage de fumée : les alliés à l’intérieur deviennent invisibles pour les monstres.', desc: 'Disparaît toutes les 10 s.' },
    alchimiste: { name: 'Alchimiste', tier: 2, parent: 'assassin', color: '#7fd13b', weapon: 'flask', projectile: 'flask', hp: 110, dmg: 13, range: 210, cd: 0.9, speed: 112, armor: 0.03, crit: 0.2, venom: { max: 5, pct: 0.15, dur: 5, boss: 1.5 }, ult: 'acid', ultName: 'Pluie d’acide', ultDesc: '5 fioles sur les plus grands groupes : flaques d’acide pendant 6 s (3 doses de poison par seconde, +30 % de dégâts reçus).', desc: 'Ses fioles empoisonnent (jusqu’à 5 doses cumulées) ; poison renforcé contre les boss.' },
    fleche: { name: 'Flèche', tier: 2, parent: 'assassin', color: '#e74c3c', weapon: 'daggers', hp: 110, dmg: 19, range: 34, cd: 0.7, speed: 125, armor: 0.03, crit: 0.3, dash: { every: 6, range: 320 }, ult: 'chaindash', ultName: 'Danse mortelle', ultDesc: 'Dash critique derrière un ennemi ; s’il meurt, enchaîne sur un autre (5 fois au plus).', desc: 'Toutes les 6 s, surgit derrière l’ennemi le plus faible.' },


    menestrel: { name: 'Ménestrel', tier: 1, parent: 'habitant', color: '#d6457a', weapon: 'lute', projectile: 'note', pierce: 2, hp: 120, dmg: 9, range: 160, cd: 1.0, speed: 82, armor: 0.04, aura: { atkspd: 0.08, dmg: 0, r: 180 }, desc: 'Ses notes traversent les monstres ; les héros proches attaquent 8 % plus vite.' },
    troubadour: { name: 'Troubadour', tier: 2, parent: 'menestrel', color: '#ff9f43', weapon: 'lute', projectile: 'note', pierce: 3, hp: 140, dmg: 11, range: 170, cd: 0.95, speed: 82, armor: 0.05, aura: { atkspd: 0.12, dmg: 0.06, r: 200 }, ult: 'anthem', ultName: 'Hymne de bravoure', ultDesc: 'Pendant 8 s, tous les héros vivants ont +30 % de dégâts et +20 % de vitesse d’attaque (les hymnes ne se cumulent pas).', desc: 'Les héros proches attaquent 12 % plus vite et frappent 6 % plus fort.' },
    tambour: { name: 'Tambour de guerre', tier: 2, parent: 'menestrel', color: '#b5651d', weapon: 'drum', hp: 175, dmg: 11, range: 60, cd: 1.0, speed: 80, armor: 0.1, splash: 70, aura: { atkspd: 0.08, dmg: 0, r: 180 }, quake: { every: 7, r: 130, stun: 0.6, push: 45 }, ult: 'thunder', ultName: 'Roulement de tonnerre', ultDesc: 'Grande onde autour de lui : étourdit les monstres 2,5 s (boss ralentis) et inflige 300 % des dégâts.', desc: 'Toutes les 7 s, une onde de choc repousse et étourdit les monstres proches.' },
    enchanteresse: { name: 'Enchanteresse', tier: 2, parent: 'menestrel', color: '#ff7ad9', weapon: 'harp', projectile: 'charm', hp: 115, dmg: 12, range: 230, cd: 1.0, speed: 82, armor: 0.04, aura: { atkspd: 0.08, dmg: 0, r: 180 }, charm: { chance: 0.1, dur: 3 }, ult: 'enchant', ultName: 'Chant envoûtant', ultDesc: 'Charme jusqu’à 6 monstres pendant 10 s : ils se battent pour l’équipe, puis meurent. Les boss touchés sont seulement étourdis.', desc: '10 % de chances par attaque de charmer un monstre 3 s (il n’attaque plus).' }
  };
  const BASE_CLASSES = ['soldat', 'mage', 'eleveur', 'archer', 'assassin', 'menestrel'];

  /*
   * Arbres de compétences : une branche par spécialisation.
   * 3 compétences passives (3 rangs chacune), puis l'ultime en bout de branche
   * (débloquer l'ultime = devenir la spécialisation ; un seul ultime à la fois).
   */
  const SKILL_TREE = {
    paladin: [['Foi inébranlable', { hp: 0.05 }], ['Aura de protection', { armor: 0.03 }], ['Bouclier sacré', { hp: 0.06 }], ['Ferveur', { dmg: 0.04 }], ['Rempart vivant', { armor: 0.03 }]],
    berserker: [['Sang chaud', { dmg: 0.05 }], ['Peau épaisse', { hp: 0.05 }], ['Soif de sang', { leech: 0.01 }], ['Rage bouillonnante', { atkspd: 0.04 }], ['Carnage', { crit: 0.03 }]],
    chevalier: [['Entraînement martial', { dmg: 0.05 }], ['Galop', { speed: 0.05 }], ['Lance affûtée', { dmg: 0.06 }], ['Armure de joute', { armor: 0.03 }], ['Fougue', { atkspd: 0.04 }]],
    glace: [['Froid mordant', { frostMul: 0.1 }], ['Armure de givre', { armor: 0.03 }], ['Cœur de glace', { hp: 0.05 }], ['Gel profond', { frostMul: 0.1 }], ['Blizzard', { dmg: 0.05 }]],
    feu: [['Étincelle', { dmg: 0.05 }], ['Combustion', { burnMul: 0.15 }], ['Pyromancie', { dmg: 0.06 }], ['Brasier', { burnMul: 0.15 }], ['Âme ardente', { crit: 0.03 }]],
    soin: [['Prière', { healMul: 0.1 }], ['Lumière bénie', { armor: 0.02, hp: 0.03 }], ['Grâce', { healMul: 0.1 }], ['Robe sacrée', { hp: 0.05 }], ['Sanctuaire', { healMul: 0.1 }]],
    dompteur: [['Rats', {}, 'rat'], ['Complicité', { hp: 0.05 }], ['Loups', {}, 'wolf'], ['Instinct sauvage', { dmg: 0.05 }], ['Ours', {}, 'bear']],
    fauconnier: [['Pigeons', {}, 'pigeon'], ['Gant de cuir', { hp: 0.05 }], ['Aigle', {}, 'eagle'], ['Marque profonde', { mark: 0.1 }], ['Faucons', {}, 'falcon']],
    necromancien: [['Slimes', {}, 'slime'], ['Rites sombres', { dmg: 0.05 }], ['Zombies', {}, 'zombie'], ['Peau morte', { armor: 0.03 }], ['Squelettes archers', {}, 'skelarcher']],
    arbaletrier: [['Mécanisme huilé', { atkspd: 0.05 }], ['Carreaux lourds', { dmg: 0.05 }], ['Visée', { crit: 0.03 }], ['Cadence', { atkspd: 0.05 }], ['Perforation', { dmg: 0.05 }]],
    trappeur: [['Mâchoires d’acier', { trapRoot: 0.3 }], ['Ingéniosité', { trapMax: 1 }], ['Épines', { dmg: 0.05 }], ['Pistage', { speed: 0.05 }], ['Embuscade', { crit: 0.03 }]],
    arclong: [['Œil perçant', { crit: 0.03 }], ['Tension de la corde', { dmg: 0.05 }], ['Pas léger', { speed: 0.05 }], ['Archerie royale', { dmg: 0.05 }], ['Sang-froid', { crit: 0.03 }]],
    ombre: [['Discrétion', { speed: 0.05 }], ['Lames empoisonnées', { dmg: 0.05 }], ['Danse des ombres', { crit: 0.03 }], ['Voile', { stealthDur: 0.5 }], ['Assassinat', { dmg: 0.06 }]],
    alchimiste: [['Dosage', { venomMax: 1 }], ['Concentré', { venomMul: 0.05 }], ['Lancer précis', { atkspd: 0.05 }], ['Antidote', { hp: 0.05 }], ['Corrosion', { dmg: 0.05 }]],
    fleche: [['Précision', { crit: 0.03 }], ['Vivacité', { atkspd: 0.05 }], ['Exécution', { dmg: 0.06 }], ['Course', { speed: 0.05 }], ['Lame fatale', { crit: 0.03 }]],
    troubadour: [['Voix portante', { auraR: 0.15 }], ['Crescendo', { dmg: 0.05 }], ['Harmonie', { hp: 0.05 }], ['Mélodie entraînante', { auraPow: 0.1 }], ['Vibrato', { atkspd: 0.04 }]],
    tambour: [['Peau tendue', { hp: 0.05 }], ['Cadence', { quakeCd: 0.5 }], ['Écho', { quakeR: 0.1 }], ['Grondement', { dmg: 0.05 }], ['Tonnerre', { quakeStun: 0.2 }]],
    enchanteresse: [['Doigts agiles', { atkspd: 0.05 }], ['Mélopée', { charmChance: 0.02 }], ['Grâce', { crit: 0.03 }], ['Fascination', { charmDur: 0.5 }], ['Sérénade', { dmg: 0.05 }]]
  };
  // Compétences débloquées après l'ultime : elles améliorent l'ultime (ou le nombre d'invocations)
  const POST_ULT = {
    paladin: [['Ferveur divine', { ultDmg: 0.25 }], ['Onde sacrée', { ultArea: 0.15 }]],
    berserker: [['Fureur sans fin', { ultDur: 1 }], ['Massacre', { ultDmg: 0.15 }]],
    chevalier: [['Charge dévastatrice', { ultDmg: 0.3 }], ['Élan', { ultArea: 0.15 }]],
    glace: [['Hiver éternel', { ultDur: 0.5 }], ['Cône élargi', { ultArea: 0.15 }]],
    feu: [['Explosion', { ultDmg: 0.25 }], ['Déflagration', { ultArea: 0.15 }]],
    soin: [['Miracle', { ultHeal: 0.08 }], ['Bouclier béni', { ultDur: 2 }]],
    dompteur: [['Horde', { summonCap: 1 }], ['Rage animale', { ultDmg: 0.15 }]],
    fauconnier: [['Volée', { summonCap: 1 }], ['Fureur des cieux', { ultDur: 1 }]],
    necromancien: [['Armée des morts', { summonCap: 1 }], ['Résurrection', { ultHeal: 0.1 }]],
    arbaletrier: [['Rafale prolongée', { ultDur: 1 }], ['Carreaux explosifs', { ultDmg: 0.15 }]],
    trappeur: [['Ronces tenaces', { ultDur: 2 }], ['Taillis', { ultArea: 0.15 }]],
    arclong: [['Volée de flèches', { ultCount: 1 }], ['Pointes d’acier', { ultDmg: 0.2 }]],
    ombre: [['Brouillard épais', { ultDur: 2 }], ['Nuage étendu', { ultArea: 0.15 }]],
    alchimiste: [['Pluie redoublée', { ultCount: 1 }], ['Acide persistant', { ultDur: 1 }]],
    fleche: [['Danse infinie', { ultCount: 1 }], ['Coup fatal', { ultDmg: 0.15 }]],
    troubadour: [['Rappel', { ultDur: 1 }], ['Hymne héroïque', { ultDmg: 0.1 }]],
    tambour: [['Fracas', { ultDmg: 0.25 }], ['Résonance', { ultArea: 0.15 }]],
    enchanteresse: [['Chœur envoûtant', { ultCount: 1 }], ['Transe', { ultDur: 1 }]]
  };
  // Invocations débloquées par les nœuds de l'arbre (6 au plus, 9 avec la compétence d'après-ultime)
  const SUMMONS = {
    rat: { name: 'Rats', icon: '🐀', role: 'frappe à 60 % des dégâts du héros et empoisonne 2 s' },
    wolf: { name: 'Loups', icon: '🐺', role: 'frappe à 100 % des dégâts du héros, 1,5 fois plus vite que lui' },
    bear: { name: 'Ours', icon: '🐻', role: 'frappe à 200 % des dégâts du héros, à 0,9× sa vitesse' },
    pigeon: { name: 'Pigeons', icon: '🕊️', role: 'frappe à 50 % des dégâts du héros, 1,5 fois plus vite que lui' },
    eagle: { name: 'Aigle', icon: '🪶', role: 'marque un ennemi toutes les 5 s : +100 % de dégâts reçus pendant 3 s' },
    falcon: { name: 'Faucons', icon: '🦅', role: 'frappe à 150 % des dégâts du héros' },
    slime: { name: 'Slimes', icon: '🟢', role: '300 % des PV du héros, frappe à 75 % de ses dégâts et ralentit 2 s' },
    zombie: { name: 'Zombies', icon: '🧟', role: '90 % des PV du héros, frappe à 110 % de ses dégâts' },
    skelarcher: { name: 'Squelettes archers', icon: '🏹', role: 'tire 1,1 fois plus vite que le héros, 1,2 fois ses chances de critique' }
  };
  // 1 créature au rang 1 du nœud, une 2e au rang SUMMON_SECOND_RANK
  const SUMMON_CAP = 6, SUMMON_CAP_MAX = 9, SUMMON_RANK_POWER = 0.2, SUMMON_SECOND_RANK = 3;
  // une invocation toutes les SUMMON_EVERY s jusqu'au quota ; SUMMON_RESPAWN s après la mort d'une invocation
  const SUMMON_EVERY = 10, SUMMON_RESPAWN = 5;
  // Arbre d'initiation (avant le choix de classe) : une compétence liée à chaque classe.
  // En choisissant sa classe, les points des autres initiations sont rendus.
  const INITIATION = {
    soldat: ['Entraînement de recrue', { hp: 0.04 }],
    mage: ['Lecture des grimoires', { dmg: 0.04 }],
    eleveur: ['Ami des bêtes', { hp: 0.02, dmg: 0.02 }],
    archer: ['Tir à la cible', { crit: 0.02 }],
    assassin: ['Pas de velours', { speed: 0.03, crit: 0.01 }],
    menestrel: ['Gammes', { atkspd: 0.04 }]
  };
  const SKILL_MAX_RANK = 3;
  const SKILLS = {};
  // Centre de l'arbre (le Paysan) : disponible à tout moment, ne bloque aucune branche
  SKILLS.core_1 = { id: 'core_1', core: true, name: 'Courage du paysan', bonus: { hp: 0.02, dmg: 0.02 }, max: SKILL_MAX_RANK, requires: null };
  for (const [base, [name, bonus]] of Object.entries(INITIATION)) {
    SKILLS[`init_${base}`] = { id: `init_${base}`, init: true, base, name, bonus, max: SKILL_MAX_RANK, requires: null };
  }
  for (const [spec, nodes] of Object.entries(SKILL_TREE)) {
    const base = CLASSES[spec].parent;
    nodes.forEach(([name, bonus, summon], i) => {
      SKILLS[`${spec}_${i + 1}`] = { id: `${spec}_${i + 1}`, base, spec, step: i + 1, name, bonus, summon: summon || null, max: SKILL_MAX_RANK, requires: i ? `${spec}_${i}` : null };
    });
    SKILLS[`${spec}_ult`] = { id: `${spec}_ult`, base, spec, step: nodes.length + 1, ult: true, max: 1, requires: `${spec}_${nodes.length}` };
    (POST_ULT[spec] || []).forEach(([name, bonus], i) => {
      SKILLS[`${spec}_u${i + 1}`] = { id: `${spec}_u${i + 1}`, base, spec, step: nodes.length + 2 + i, post: true, name, bonus, max: SKILL_MAX_RANK, requires: i ? `${spec}_u${i}` : `${spec}_ult` };
    });
  }
  // Pour placer un point dans un nœud, il faut au moins 2 points dans le nœud précédent (1 pour l'ultime)
  const REQUIRED_RANK = 2;
  const requiredRank = (id) => Math.min(REQUIRED_RANK, (SKILLS[id] || { max: 1 }).max);
  // Invocations débloquées d'un héros : { type: rang du nœud }
  function summonRanks(skills, cls) {
    const out = {};
    for (const [id, r] of Object.entries(skills || {})) { const n = SKILLS[id]; if (r > 0 && n && n.summon && n.spec === cls) out[n.summon] = r; }
    return out;
  }
  // Effet d'un nœud d'invocation, pour l'affichage
  // Effets d'une créature, calculés à partir de ses statistiques (affichés dans les infobulles de l'arbre)
  function summonEffects(kind) {
    const d = MOBS['ally_' + kind];
    if (!d) return [];
    const pct = (v) => `${Math.round(v * 100)} %`;
    const out = [`PV : ${pct(d.hp)} de ceux du héros`, `Dégâts : ${pct(d.dmg)} de ceux du héros${d.ranged ? ' (tir à distance)' : ''}`];
    if (d.atkMul) out.push(`Vitesse d’attaque : ${String(d.atkMul).replace('.', ',')}× celle du héros`);
    if (d.critMul) out.push(`Critique : ${String(d.critMul).replace('.', ',')}× les chances du héros`);
    if (d.poison) out.push(`Empoisonne ${d.poison.dur} s (${pct(d.poison.pct)} des dégâts du héros par seconde)`);
    if (d.onHit && d.onHit.slow) out.push(`Ralentit de ${pct(d.onHit.slow)} pendant ${d.onHit.dur} s`);
    if (d.marks) out.push(`Marque un ennemi toutes les ${d.marks.every} s : +${pct(d.marks.v)} de dégâts reçus pendant ${d.marks.dur} s`);
    if (d.flying) out.push('Vole');
    return out;
  }
  // Passifs d'une classe, décrits à partir de ses données (affichés dans l'arbre de compétences)
  function passiveLines(cls) {
    const c = CLASSES[cls];
    if (!c) return [];
    const pct = (v) => `${Math.round(v * 100)} %`, sec = (v) => `${String(v).replace('.', ',')} s`;
    const out = [];
    if (c.rage) out.push(`Rage : jusqu’à +${pct(c.rage.max)} de dégâts quand ses PV baissent (maximum sous 30 % de PV) ; se soigne de ${pct(c.rage.leech)} des dégâts infligés`);
    if (c.onHit && c.onHit.slow) out.push(`Ses projectiles ralentissent de ${pct(c.onHit.slow)} pendant ${sec(c.onHit.dur)}`);
    if (c.onHit && c.onHit.burn) out.push(`Ses projectiles brûlent : ${pct(c.onHit.burn)} de ses dégâts par seconde pendant ${sec(c.onHit.dur)}`);
    if (c.healer) out.push('Toutes les 3 s, soigne l’allié le plus blessé (10 % de ses PV max + 120 % des dégâts du héros)');
    if (c.summons) out.push(`Invocation : ${Object.entries(c.summons).map(([k, n]) => `${n} ${(SUMMONS[k] || { name: k }).name.toLowerCase().replace(/s$/, '')} ${(SUMMONS[k] || {}).icon || ''}`).join(', ')} à ses côtés`);
    if (c.pets) out.push(`Invocations débloquées dans l’arbre : ${c.pets.map((k) => `${SUMMONS[k].icon} ${SUMMONS[k].name}`).join(', ')} (${SUMMON_CAP} au plus, ${SUMMON_CAP_MAX} après l’ultime)`);
    if (c.traps) out.push(`Pose un piège à mâchoires toutes les ${sec(c.traps.every)} (${c.traps.max} au plus) : immobilise ${sec(c.traps.root)} et inflige ${pct(c.traps.mult)} des dégâts`);
    if (c.stealth) out.push(`Devient invisible ${sec(c.stealth.dur)} toutes les ${sec(c.stealth.every)}`);
    if (c.venom) out.push(`Ses fioles empoisonnent : jusqu’à ${c.venom.max} doses, ${pct(c.venom.pct)} des dégâts par dose et par seconde pendant ${sec(c.venom.dur)} ; +${pct(c.venom.boss - 1)} contre les boss`);
    if (c.dash) out.push(`Toutes les ${sec(c.dash.every)}, surgit derrière l’ennemi le plus faible (portée ${c.dash.range}) et frappe à 220 %`);
    if (c.aura) out.push(`Aura : les héros à moins de ${c.aura.r} px attaquent ${pct(c.aura.atkspd)} plus vite${c.aura.dmg ? ` et font +${pct(c.aura.dmg)} de dégâts` : ''}`);
    if (c.pierce > 1) out.push(`${c.projectile === 'note' ? 'Ses notes traversent' : 'Tir perçant : ses flèches traversent'} jusqu’à ${c.pierce} monstres alignés`);
    if (c.quake) out.push(`Toutes les ${sec(c.quake.every)}, onde de choc (rayon ${c.quake.r}) : repousse et étourdit ${sec(c.quake.stun)} les monstres proches (boss ralentis)`);
    if (c.splash) out.push(`Ses coups touchent aussi les ennemis autour (60 % des dégâts, rayon ${c.splash})`);
    if (c.charm) out.push(`${pct(c.charm.chance)} de chances par attaque de charmer un monstre ${sec(c.charm.dur)} (il n’attaque plus)`);
    if (c.guard) out.push(`Garde : les héros à moins de ${c.guard.r} px de lui reçoivent ${pct(c.guard.red)} de dégâts en moins`);
    if (c.parry) out.push(`Parade sacrée : ${pct(c.parry.chance)} de chances de parer une attaque (dégâts annulés) et de se soigner de ${pct(c.parry.heal)} de ses PV max`);
    if (c.momentum) out.push(`Élan : après une course de plus de ${c.momentum.dist} px, son premier coup fait ${pct(c.momentum.mult)} des dégâts et renverse le monstre (${sec(c.momentum.stun)})`);
    if (c.unstable) out.push(`Orbe instable : toutes les ${c.unstable.every} attaques, l’orbe explose en zone (rayon ${c.unstable.r}, ${pct(c.unstable.mult)} des dégâts)`);
    if (c.knock) out.push(`Carreau lourd : chaque carreau repousse le monstre de ${c.knock} px (pas les boss)`);
    if (c.farshot) out.push(`Tir de loin : +1 % de dégâts par tranche de ${c.farshot.per} px entre lui et sa cible (jusqu’à +${pct(c.farshot.max)})`);
    if (c.backstab) out.push(`Coup dans le dos : +${pct(c.backstab)} de dégâts sur un monstre qui attaque un autre héros ou la tour, ou qui est ralenti, gelé ou marqué`);
    if (c.crit && c.crit >= 0.2) out.push(`Coups critiques fréquents : ${pct(c.crit)} de chances de base`);
    if (c.mount) out.push('Monte à cheval (+16 % de vitesse) une fois l’ultime débloqué');
    return out;
  }
  function summonText(n) {
    const S = SUMMONS[n.summon];
    return [`Invocation : ${S.name} ${S.icon}`, ...summonEffects(n.summon).map((l) => `• ${l}`),
      `Rang 1 : 1 créature · rang ${SUMMON_SECOND_RANK} : 2 créatures · +${Math.round(SUMMON_RANK_POWER * 100)} % de PV et de dégâts par rang`,
      `Une invocation toutes les ${SUMMON_EVERY} s (${SUMMON_RESPAWN} s après une mort) · ${SUMMON_CAP} invocations au plus (${SUMMON_CAP_MAX} après l’ultime)`].join('\n');
  }
  // Branche (spécialisation) déjà entamée : les autres branches sont alors bloquées
  // Arbre : le centre (Paysan), une branche par classe (initiation), une sous-branche par spécialisation.
  // Mettre un point dans une branche fait devenir la classe (puis la spécialisation) et grise les autres.
  const ultUnlocked = (skills, cls) => !!(skills && CLASSES[cls] && CLASSES[cls].tier === 2 && skills[`${cls}_ult`]);
  const startedBranch = (skills) => {
    for (const [id, r] of Object.entries(skills || {})) if (r > 0 && SKILLS[id] && SKILLS[id].spec) return SKILLS[id].spec;
    return null;
  };
  const skillsOfFamily = (base) => Object.values(SKILLS).filter((n) => n.base === base);
  function skillPoints(u) {
    const earned = Math.floor((u.level || 1) / PROGRESSION.SKILL_EVERY);
    const spent = Object.values(u.skills || {}).reduce((a, b) => a + b, 0);
    return { earned, spent, lost: u.skillLost || 0, free: Math.max(0, earned - spent - (u.skillLost || 0)) };
  }
  // Bonus cumulés des compétences
  function skillBonus(skills) {
    const out = {};
    for (const [id, rank] of Object.entries(skills || {})) {
      const n = SKILLS[id];
      if (!n || !n.bonus) continue;
      for (const [k, v] of Object.entries(n.bonus)) out[k] = (out[k] || 0) + v * rank;
    }
    return out;
  }
  const CLASS_IDS = Object.keys(CLASSES);
  const specsOf = (base) => CLASS_IDS.filter((id) => CLASSES[id].parent === base && CLASSES[id].tier === 2);

  /* ------------------------------------------------------------------ */
  /* Progression                                                         */
  /* ------------------------------------------------------------------ */
  // Le niveau n'augmente PAS les statistiques : seuls les points de stat (et l'équipement) le font.
  // Chaque niveau rapporte des points de stat et des glaçons.
  const PROGRESSION = {
    CLASS_LEVEL: 7, // niveau pour entrer dans une branche de classe (le Paysan est le centre de l'arbre ; identifiant interne « habitant »)
    ULT_LEVEL: 30, // niveau requis pour débloquer l'ultime (bout de branche)
    MAX_LEVEL: 100,
    POINTS_PER_LEVEL: 1,
    GLACONS_PER_LEVEL: 1,
    SKILL_EVERY: 2, // 1 point de compétence tous les X niveaux
    SKILL_RESPEC_LOSS: 0.25, // reconversion : part des points attribués définitivement perdue
    XP_BASE: 60, // XP pour passer de lvl à lvl+1 = XP_BASE × lvl^XP_EXP
    XP_EXP: 1.45,
    xpForLevel: (lvl) => Math.round(PROGRESSION.XP_BASE * Math.pow(lvl, PROGRESSION.XP_EXP))
  };

  /*
   * Réglages généraux d'équilibrage (à modifier ici, dans le code)
   */
  const BALANCE = {
    TOWER_BASE_HP: 200,
    ULT_TIME: 60, // secondes pour charger un ultime
    REVIVE_HP: 0.6, // vote « Résurrection » / Infirmerie : part des PV max rendus au héros réanimé
    INTERMISSION_HEAL: 0.1, // soin de la tour à chaque entracte (part des PV max des héros) ; +13 % par niveau de « Fontaine de vie »
    WAVE_HP_LINEAR: 0.05, // PV des monstres : +5 % par manche — × (1 + LIN×(m-1) + QUAD×(m-1)²)
    WAVE_HP_QUAD: 0,
    WAVE_DMG: 0.02, // dégâts des monstres : +2 % par manche — × (1 + DMG×(m-1))
    // Renforcement selon le nombre de joueurs : chaque valeur « PAR_HÉROS » est multipliée par (joueurs − 1)^HERO_SCALE_EXP.
    // Un exposant > 1 fait progresser la difficulté un peu plus vite que le nombre de joueurs (10 joueurs : un peu plus
    // que 2 fois la hausse de 5 joueurs), tout en laissant les grandes équipes aller plus loin.
    HERO_SCALE_EXP: 1.05,
    HP_PER_HERO: 0.015, // PV des monstres en plus par héros présent
    DMG_PER_HERO: 0.01, // dégâts des monstres en plus par héros présent
    WAVE_DURATION_BASE: 8, // durée d'apparition des monstres (s) = BASE + PAR_MANCHE×m + PAR_HÉROS×héros (objectif : partie classique ≈ 1 h)
    WAVE_DURATION_PER_WAVE: 0.05,
    WAVE_DURATION_PER_HERO: 0.4,
    WAVE_DURATION_MAX: 30,
    MOB_COUNT_BASE: 6, // nombre de monstres : (BASE + PAR_MANCHE×m) × facteur joueurs
    MOB_COUNT_PER_WAVE: 0.85,
    MOB_COUNT_PER_HERO: 0.1,
    MOB_COUNT_HERO_CAP: 12,
    MAX_WAVE_MOBS: 450,
    ELITE_BASE: 0.02, // chance d'élite : BASE + PAR_MANCHE×m (max ELITE_MAX)
    ELITE_PER_WAVE: 0.003,
    ELITE_MAX: 0.25,
    ELITE_HP: 3.5,
    ELITE_DMG: 1.5,
    BOSS_HP_BASE: 0.5, // PV des boss : × (BASE + PAR_HÉROS × héros)
    BOSS_HP_PER_HERO: 0.06,
    MOB_DMG: 0.4, // multiplicateur des dégâts de tous les monstres (calibré : 5 héros niv. 10 atteignent la manche 10 d'une partie rapide normale ; partie classique ≈ 1 h)
    BOSS_DMG: 0.6, // multiplicateur des dégâts des boss (en plus)
    BOSS_WAVE_EXP: 0.7, // les PV des boss suivent la croissance par manche à la puissance 0,7 (plus douce)
    TOWER_KEEP_PCT: 0.1, // vote « Donjon renforcé » : part des PV max de la tour ajoutée (et soignée) par niveau
    WAVE_XP_BASE: 10, // récompense de fin de manche (par héros)
    WAVE_XP_PER_WAVE: 4,
    WAVE_GRELONS_BASE: 2,
    WAVE_GRELONS_PER_WAVE: 0.5,
    HAZARD_BASE: 2, // zones dangereuses du biome par manche = BASE + PAR_MANCHE×m (max HAZARD_MAX)
    HAZARD_PER_WAVE: 0.08,
    HAZARD_MAX: 4,
    HAZARD_ICE_SLOW: 0.35, // zone de glace : ralentissement des héros
    HAZARD_POISON_PCT: 0.01, // zone de poison : % des PV max perdus…
    HAZARD_POISON_EVERY: 3, // …toutes les X secondes
    HAZARD_LAVA_PCT: 0.01, // zone de lave : % des PV max perdus…
    HAZARD_LAVA_EVERY: 2, // …toutes les X secondes
    BUILDING_HP: 100, // PV d'une habitation (s'additionnent quand plusieurs joueurs la partagent)
    BUILDINGS_PER_CLASS: 5, // habitations max par classe ; au-delà, les joueurs partagent
    BUILDING_HEAL: 0.25 // soin par seconde (part des PV max) dans son bâtiment pendant l'entracte
  };

  /*
   * Bâtiments : chaque héros a sa petite habitation, du type de sa classe (2 archers = 2 tours de guet).
   * Chaque classe a son secteur autour de la tour (angle en degrés, 0 = est, 90 = sud ; le nord reste libre
   * car la tour est dessinée en hauteur). Les classes de soutien sont les plus proches.
   */
  const BUILDINGS = [
    { family: 'habitant', name: 'Chaumière', angle: 129, dist: 160 },
    { family: 'mage', name: 'Tour des mages', angle: 171, dist: 200 },
    { family: 'eleveur', name: 'Étable', angle: 321, dist: 215 },
    { family: 'archer', name: 'Tour de guet', angle: 213, dist: 235 },
    { family: 'assassin', name: 'Repaire', angle: 3, dist: 245 },
    { family: 'soldat', name: 'Caserne', angle: 87, dist: 255 },
    { family: 'menestrel', name: 'Taverne', angle: 291, dist: 230 }
  ];
  const ellipsePos = (angleDeg, dist) => ({ x: WORLD.CX + Math.cos((angleDeg * Math.PI) / 180) * dist * 1.35, y: WORLD.CY + Math.sin((angleDeg * Math.PI) / 180) * dist * 0.85 });
  // Emplacements possibles : anneaux autour de la tour, y compris au nord (la tour peut alors les cacher en partie,
  // mais jamais entièrement : le corps de la tour reste dégagé)
  const BUILDING_SPOTS = [];
  // (espacement prévu pour les grandes habitations ; le plus éloigné reste dans le cercle où se tiennent les héros)
  const BUILDING_RINGS = [100, 152, 204];
  for (const d of BUILDING_RINGS) {
    const step = Math.max(6, (82 / (d * 1.1)) * (180 / Math.PI));
    for (let a = 0; a < 360; a += step) {
      const p = ellipsePos(a, d);
      if (Math.abs(p.x - WORLD.CX) < 100 && p.y > WORLD.CY - 340 && p.y < WORLD.CY + 150) continue; // derrière / devant la tour
      if (p.x < 50 || p.x > WORLD.W - 50 || p.y < 70 || p.y > WORLD.H - 40) continue;
      BUILDING_SPOTS.push({ a, d, ...p });
    }
  }
  // Classes de soutien (ferme, mine, scierie, chaumière) : au plus près de la tour
  const SUPPORT_FAMILIES = ['habitant'];
  // Choisit un emplacement libre, sans chevaucher les habitations existantes : les classes de soutien prennent
  // l'anneau libre le plus proche de la tour ; les autres un emplacement au hasard (classes mélangées), un peu plus loin.
  function placeBuilding(family, taken, rnd) {
    const r = rnd || Math.random;
    const free = BUILDING_SPOTS.filter((s) => !taken.some((t) => (t.x - s.x) ** 2 + (t.y - s.y) ** 2 < 78 * 78)); // léger chevauchement toléré
    // plus de place libre : l'emplacement le moins encombré (chevauchement plutôt qu'un bâtiment hors du cercle)
    if (!free.length) {
      let best = BUILDING_SPOTS[0], bd = -1;
      for (const s of BUILDING_SPOTS) { const d = Math.min(...taken.map((t) => (t.x - s.x) ** 2 + (t.y - s.y) ** 2)); if (d > bd) { bd = d; best = s; } }
      return { x: best.x, y: best.y };
    }
    let pool;
    if (SUPPORT_FAMILIES.includes(family)) {
      const dmin = Math.min(...free.map((s) => s.d));
      pool = free.filter((s) => s.d === dmin);
    } else {
      pool = free.filter((s) => s.d > BUILDING_RINGS[0]);
      if (!pool.length) pool = free;
    }
    const s = pool[Math.floor(r() * pool.length)];
    return { x: s.x, y: s.y };
  }
  // Variante d'habitation selon la spécialisation (les paysans spécialisés ont leur propre bâtiment)
  // (les dessins de la ferme, de la mine et de la scierie restent disponibles dans art.js)
  const BUILDING_VARIANTS = {};
  /*
   * Améliorations d'habitation (achetées avec des Grêlons, conservées d'une partie à l'autre).
   * PV : s'additionnent quand l'habitation est partagée. Soin : moyenne des occupants (pas de double soin).
   * Spéciale : propre au type de bâtiment (donc à la classe actuelle du joueur).
   */
  const HOUSE_UPGRADES = {
    hp: { name: 'Murs renforcés', icon: '🧱', per: 0.12, max: 10, cost: 80, growth: 1.45, desc: (v) => `+${Math.round(v * 100)}% de PV pour ton habitation` },
    heal: { name: 'Lits douillets', icon: '🛏️', per: 0.1, max: 10, cost: 100, growth: 1.45, desc: (v) => `+${Math.round(v * 100)}% de puissance de soin` }
  };
  const HOUSE_SPECIALS = {
    habitant: { name: 'Foyer chaleureux', icon: '🔥', per: 0.03, max: 5, cost: 150, growth: 1.7, desc: (v) => `+${Math.round(v * 100)}% d’XP gagnée` },
    mage: { name: 'Bibliothèque', icon: '📚', per: 0.03, max: 5, cost: 200, growth: 1.7, desc: (v) => `+${Math.round(v * 100)}% de charge de l’ultime` },
    eleveur: { name: 'Enclos', icon: '🐺', per: 0.06, max: 5, cost: 200, growth: 1.7, desc: (v) => `+${Math.round(v * 100)}% de PV et dégâts des invocations` },
    archer: { name: 'Vigie', icon: '🏹', per: 1, max: 5, cost: 220, growth: 1.7, desc: (v) => (v ? `la tour de guet tire sur les ennemis proches (niveau ${v})` : 'la tour de guet tire sur les ennemis proches') },
    assassin: { name: 'Pièges', icon: '🪤', per: 0.05, max: 5, cost: 200, growth: 1.7, desc: (v) => `les ennemis proches du repaire sont ralentis de ${Math.round(v * 100)}%` },
    soldat: { name: 'Râtelier d’armes', icon: '🛡️', per: 0.01, max: 5, cost: 200, growth: 1.7, desc: (v) => `+${Math.round(v * 100)}% de défense` },
    menestrel: { name: 'Scène', icon: '🎵', per: 0.06, max: 5, cost: 200, growth: 1.7, desc: (v) => `+${Math.round(v * 100)}% de puissance et de rayon de l’aura` }
  };
  const houseCost = (def, lvl) => Math.round(def.cost * Math.pow(def.growth, lvl));
  const HOUSE_RESPEC_REFUND = 0.75; // reconversion : part des Grêlons dépensés remboursée
  // Grêlons dépensés en améliorations d'habitation
  function houseSpent(u) {
    const h = houseOf(u);
    let total = 0;
    const sum = (def, lvl) => { for (let i = 0; i < lvl; i++) total += houseCost(def, i); };
    sum(HOUSE_UPGRADES.hp, h.hp); sum(HOUSE_UPGRADES.heal, h.heal);
    for (const [f, lvl] of Object.entries(h.special)) if (HOUSE_SPECIALS[f]) sum(HOUSE_SPECIALS[f], lvl);
    return total;
  }
  // Niveaux d'amélioration d'un profil : { hp, heal, special: { famille: niveau } }
  const houseOf = (u) => ({ hp: 0, heal: 0, ...(u && u.house), special: { ...((u && u.house && u.house.special) || {}) } });
  const houseHp = (u) => BALANCE.BUILDING_HP * (1 + HOUSE_UPGRADES.hp.per * houseOf(u).hp);
  const houseHeal = (u) => BALANCE.BUILDING_HEAL * (1 + HOUSE_UPGRADES.heal.per * houseOf(u).heal);
  const houseSpecial = (u, family) => (houseOf(u).special[family] || 0);

  const buildingPos = (b) => placeBuilding(b.family, []);

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
    const sb = { ...setBonuses(gear).bonus };
    for (const [k, v] of Object.entries(skillBonus(o.skills))) sb[k] = (sb[k] || 0) + v;
    const A = ATTRIBUTES;
    const baseDmg = c.dmg * (1 + A.force.per * a.force + idmg + (sb.dmg || 0));
    return {
      maxHp: Math.round(c.hp * (1 + ihp + (sb.hp || 0) + A.vie.per * a.vie) * (1 + 0.08 * (up.so_vigor || 0))),
      baseDmg,
      dmg: baseDmg * (1 + 0.12 * (up.at_forge || 0)),
      armor: Math.min(0.75, (c.armor || 0) + iarmor + (sb.armor || 0) + A.defense.per * a.defense + 0.06 * (up.df_armor || 0)),
      cd: c.cd / (1 + A.agilite.per * a.agilite + (sb.atkspd || 0) + 0.08 * (up.at_cry || 0) + 0.04 * (up.mg_haste || 0)),
      speed: c.speed * (1 + A.vitesse.per * a.vitesse + ispeed + (sb.speed || 0)),
      crit: Math.min(0.8, (c.crit || 0.05) + A.critique.per * a.critique + (sb.crit || 0) + 0.05 * (up.at_crit || 0)),
      ultRate: (1 + (sb.ult || 0)) * (1 + 0.08 * (up.mg_focus || 0)),
      range: c.range,
      leash: c.leash || 9999,
      // bonus de spécialisation (rayon d'aura, pièges, poison…)
      mods: Object.fromEntries(Object.entries(sb).filter(([k]) => SKILL_MODS[k]))
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
  const GLACONS = { PRICE: 75, PER_BOSS: 1, START: 3, UNIVERSAL_CHANCE: 0.6, OTHER_CLASS_CHANCE: 0.05, FAST_OPEN_AFTER: 20, SCROLL_CHANCE: 0.03 };
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
   * bonus[n] = bonus actif quand n pièces du set sont portées (hp/dmg/armor/speed/crit/atkspd/ult).
   */
  const SETS = {
    rempart: { name: 'Rempart', of: 'du Rempart', families: ['soldat'], style: 'heavy', main: '#b8c1cc', trim: '#4e6d95', bonus: { 2: { hp: 0.1 }, 4: { armor: 0.08 }, 5: { dmg: 0.15 } } },
    arcaniste: { name: 'Arcaniste', of: 'de l’Arcaniste', families: ['mage'], style: 'cloth', main: '#3b5bb5', trim: '#f2c14e', bonus: { 2: { dmg: 0.1 }, 4: { ult: 0.25 }, 5: { dmg: 0.15 } } },
    maitrebete: { name: 'Maître-bête', of: 'du Maître-bête', families: ['eleveur'], style: 'leather', main: '#6e4526', trim: '#2e9e57', bonus: { 2: { hp: 0.1 }, 4: { dmg: 0.12 }, 5: { ult: 0.25 } } },
    faucon: { name: 'Œil-de-faucon', of: 'de l’Œil-de-faucon', families: ['archer'], style: 'leather', main: '#3f5a3a', trim: '#c8a24a', bonus: { 2: { crit: 0.05 }, 4: { atkspd: 0.15 }, 5: { dmg: 0.15 } } },
    lamenuit: { name: 'Lame-nuit', of: 'de la Lame-nuit', families: ['assassin'], style: 'leather', main: '#2b2433', trim: '#e74c3c', bonus: { 2: { speed: 0.1 }, 4: { crit: 0.1 }, 5: { dmg: 0.2 } } },
    barde: { name: 'Barde', of: 'du Barde', families: ['menestrel'], style: 'cloth', main: '#a33a6a', trim: '#f2c14e', bonus: { 2: { atkspd: 0.08 }, 4: { ult: 0.25 }, 5: { dmg: 0.12 } } },
    // sets universels (toutes classes) : 5 pièces, arme comprise (un peu moins forte qu'une arme de classe)
    voyageur: { name: 'Voyageur', of: 'du Voyageur', families: null, style: 'leather', main: '#9a6a3e', trim: '#5e3a1f', weapon: { dmg: 0.09, speed: 0.03 }, bonus: { 2: { speed: 0.06 }, 4: { hp: 0.1 }, 5: { dmg: 0.06 } } },
    givre: { name: 'Givre éternel', of: 'du Givre éternel', families: null, style: 'heavy', main: '#bfe6ff', trim: '#2f6fd1', weapon: { dmg: 0.09, armor: 0.02 }, bonus: { 2: { armor: 0.05 }, 4: { hp: 0.12 }, 5: { dmg: 0.06 } } },
    braise: { name: 'Braise', of: 'de Braise', families: null, style: 'cloth', main: '#9b2f4a', trim: '#ff7a1a', weapon: { dmg: 0.11 }, bonus: { 2: { dmg: 0.06 }, 4: { crit: 0.06 }, 5: { dmg: 0.06 } } },
    // armes du Paysan (avant le choix de classe) : arme seule, sans armure
    milice: { name: 'Milicien', of: 'du Milicien', families: ['habitant'], weaponOnly: true, style: 'worker', main: '#8a6a40', trim: '#c9a040', weapon: { dmg: 0.12, hp: 0.03 }, bonus: {} },
    pelerin: { name: 'Pèlerin', of: 'du Pèlerin', families: ['habitant'], weaponOnly: true, style: 'leather', main: '#6b5a3a', trim: '#8fc0e0', weapon: { dmg: 0.1, speed: 0.04 }, bonus: {} }
  };
  // Modèles d'objets : une pièce par emplacement et par set (les sets de classe ont aussi une arme)
  const TEMPLATES = {};
  for (const [sid, set] of Object.entries(SETS)) {
    for (const slot of SLOTS) {
      if (set.weaponOnly && slot !== 'weapon') continue;
      const base = SLOT_BASE[slot], m = STYLE_MODS[set.style];
      if (slot === 'weapon' && set.weapon) { // arme aux statistiques propres (sets universels, Habitant)
        TEMPLATES[`${sid}_${slot}`] = { set: sid, slot, style: set.style, families: set.families, name: `Arme ${set.of}`, hp: 0, armor: 0, dmg: 0, speed: 0, ...set.weapon };
        continue;
      }
      TEMPLATES[`${sid}_${slot}`] = {
        set: sid, slot, style: set.style, families: set.families,
        name: slot === 'weapon' ? `Arme ${set.of}` : `${STYLE_NOUNS[set.style][slot]} ${set.of}`,
        hp: (base.hp || 0) * (m.hp || 1), armor: (base.armor || 0) * (m.armor || 1), dmg: (base.dmg || 0) + (slot !== 'weapon' ? m.dmg || 0 : 0), speed: slot === 'feet' ? (m.speed || 0) * 2 : m.speed || 0
      };
    }
  }
  // Objets à usage unique (pas des pièces d'équipement) : trouvés dans les glaçons, échangeables et vendables.
  // Parchemin de mémoire : rend 1 point de compétence perdu lors d'une reconversion.
  TEMPLATES.memoire = { slot: 'consumable', consumable: 'skill', name: 'Parchemin de mémoire', icon: '📜', rarity: 3, desc: 'Rend 1 point de compétence perdu en reconversion', hp: 0, armor: 0, dmg: 0, speed: 0 };
  const isConsumable = (tid) => !!(TEMPLATES[tid] && TEMPLATES[tid].consumable);
  const setSize = (sid) => Object.values(TEMPLATES).filter((t) => t.set === sid).length;
  const STAT_NAMES = { hp: 'PV', dmg: 'dégâts', armor: 'défense', speed: 'vitesse', crit: 'critique', atkspd: 'vitesse d’attaque', ult: 'charge de l’ultime' };
  // Bonus propres à une spécialisation (mécaniques de classe), affichés avec leur propre format
  const SKILL_MODS = {
    leech: (v) => `+${Math.round(v * 100)} % de vol de vie`,
    frostMul: (v) => `+${Math.round(v * 100)} % de ralentissement du givre`,
    burnMul: (v) => `+${Math.round(v * 100)} % de dégâts de brûlure`,
    healMul: (v) => `+${Math.round(v * 100)} % de soins`,
    stealthDur: (v) => `+${fmtNum(v)} s d’invisibilité`,
    auraPow: (v) => `+${Math.round(v * 100)} % de puissance de l’aura`,
    charmDur: (v) => `+${fmtNum(v)} s de charme`,
    summonCap: (v) => `+${v} invocation${v > 1 ? 's' : ''} au maximum (jusqu’à 9)`,
    ultDmg: (v) => `+${Math.round(v * 100)} % de puissance de l’ultime`,
    ultArea: (v) => `+${Math.round(v * 100)} % de zone de l’ultime`,
    ultDur: (v) => `+${fmtNum(v)} s de durée de l’ultime`,
    ultHeal: (v) => `+${Math.round(v * 100)} % de PV rendus par l’ultime`,
    ultCount: (v) => `+${v} cible${v > 1 ? 's' : ''} / projectile${v > 1 ? 's' : ''} pour l’ultime`,
    mark: (v) => `+${Math.round(v * 100)} % de dégâts reçus par les ennemis marqués`,
    trapRoot: (v) => `+${fmtNum(v)} s d’immobilisation des pièges`,
    trapMax: (v) => `+${v} piège${v > 1 ? 's' : ''} maximum`,
    venomMax: (v) => `+${v} dose${v > 1 ? 's' : ''} de poison maximum`,
    venomMul: (v) => `+${Math.round(v * 100)} % de dégâts du poison`,
    auraR: (v) => `+${Math.round(v * 100)} % de rayon de l’aura`,
    quakeCd: (v) => `onde de choc ${fmtNum(v)} s plus tôt`,
    quakeR: (v) => `+${Math.round(v * 100)} % de rayon de l’onde`,
    quakeStun: (v) => `+${fmtNum(v)} s d’étourdissement`,
    charmChance: (v) => `+${Math.round(v * 100)} % de chance de charme`
  };
  const fmtNum = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
  // Texte d'un bonus (statistique ou bonus de spécialisation)
  const bonusText = (k, v) => (SKILL_MODS[k] ? SKILL_MODS[k](v) : `+${Math.round(v * 100)}% ${STAT_NAMES[k]}`);

  // Un objet (modèle) est-il utilisable par cette classe ?
  function canUse(tid, cls) {
    const t = TEMPLATES[tid];
    if (!t || t.consumable) return false;
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
  const WEAPON_KIND = { club: 'Gourdin', sword: 'Épée', hammer: 'Marteau', lance: 'Lance', staff: 'Bâton', whip: 'Fouet', scythe: 'Faux', bow: 'Arc', longbow: 'Arc long', crossbow: 'Arbalète', daggers: 'Dagues' };
  function itemName(item, cls) {
    const t = TEMPLATES[item && item.t];
    if (!t) return '?';
    if (t.slot !== 'weapon') return t.name;
    // arme universelle : prend la forme de l'arme de la classe du joueur
    if (!t.families) return `${(cls && CLASSES[cls] && WEAPON_KIND[CLASSES[cls].weapon]) || 'Arme'} ${SETS[t.set].of}`;
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
    if (!t || !t.set) return null;
    const set = SETS[t.set], r = RARITIES[item.r] || RARITIES[0];
    return { style: t.style, shape: r.shape, main: set.main, trim: item.r >= 5 ? '#2fd6e0' : item.r >= 4 ? '#f2c14e' : set.trim, rune: item.r >= 5, rarity: item.r };
  }
  // Couleur du métal des armes selon le niveau de forme (0 = arme de départ)
  const WEAPON_METAL = ['#d8dde3', '#c9cfd6', '#eef3f8', '#9fd3ff', '#f2c14e'];

  /* ------------------------------------------------------------------ */
  /* IA personnalisable                                                  */
  /* ------------------------------------------------------------------ */
  const AI_OPTIONS = {
    stance: { offensive: 'Offensive (chasse partout)', balanced: 'Équilibrée', defensive: 'Défensive (près de la tour)', home: 'Garde de son habitation (reste près d’elle)', harvest: 'Priorité à la récolte (sans se mettre en danger)' },
    target: { nearest: 'Le plus proche', weakest: 'Le plus faible', strongest: 'Le plus fort (élites, boss)', tower: 'Ceux qui attaquent la tour' },
    ult: { asap: 'Dès qu’il est prêt', smart: 'Au bon moment (groupe / urgence)', boss: 'Garder pour les boss' }
  };
  const DEFAULT_AI = { stance: 'balanced', target: 'nearest', ult: 'smart' };

  /* ------------------------------------------------------------------ */
  /* Personnalisation du visage (5 choix par trait)                      */
  /* ------------------------------------------------------------------ */
  const LOOK_OPTIONS = {
    hairStyle: ['Courte', 'En pics', 'Longue', 'Crête', 'Chignon'],
    eyes: ['Ronds', 'Brillants', 'Endormis', 'Féroces', 'Grands'],
    nose: ['Petit', 'Pointu', 'Rond', 'Retroussé', 'Discret'],
    mouth: ['Sourire', 'Neutre', 'Étonnée', 'Rieuse', 'Croc']
  };
  const DEFAULT_LOOK = { cape: 0, skin: 1, hair: 0, hairStyle: 0, eyes: 0, nose: 0, mouth: 0 };
  // Apparence aléatoire (nouveaux comptes, bots)
  function randomLook(rnd) {
    const r = rnd || Math.random, pick = (n) => Math.floor(r() * n);
    return { cape: pick(PALETTE.capes.length), skin: pick(5), hair: pick(PALETTE.hair.length), hairStyle: pick(5), eyes: pick(5), nose: pick(5), mouth: pick(5) };
  }
  // Valide et complète une apparence (valeurs hors limites -> défaut)
  function sanitizeLook(l) {
    const o = l || {}, ok = (v, n) => Number.isInteger(v) && v >= 0 && v < n;
    const lim = { cape: PALETTE.capes.length, skin: PALETTE.skin.length, hair: PALETTE.hair.length, hairStyle: 5, eyes: 5, nose: 5, mouth: 5 };
    const out = {};
    for (const k of Object.keys(lim)) out[k] = ok(o[k], lim[k]) ? o[k] : DEFAULT_LOOK[k];
    return out;
  }

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
    sanglier_geant: { name: 'Sanglier géant', boss: 1, shape: 'boar', color: '#5e3a22', hp: 600, dmg: 22, speed: 55, range: 40, cd: 1.4, size: 38, xp: 120, gold: 40, abilities: [{ type: 'charge', cd: 7, dmg: 2 }] },
    yeti: { name: 'Yéti', boss: 1, shape: 'golem', color: '#f2f6fa', hp: 900, dmg: 28, speed: 50, range: 46, cd: 1.6, size: 42, xp: 180, gold: 60, abilities: [{ type: 'slam', cd: 6, radius: 150, dmg: 1.5, slow: 0.4 }] },
    loup_alpha: { name: 'Loup alpha', boss: 1, shape: 'wolf', color: '#5c5650', hp: 1100, dmg: 30, speed: 90, range: 40, cd: 1, size: 36, xp: 240, gold: 80, abilities: [{ type: 'summon', cd: 8, mob: 'loup_neige', count: 4 }] },
    golem_ancien: { name: 'Golem de givre ancien', boss: 1, shape: 'golem', color: '#7cb8e8', hp: 1400, dmg: 40, speed: 38, range: 50, cd: 1.8, size: 48, xp: 320, gold: 110, abilities: [{ type: 'slam', cd: 6, radius: 180, dmg: 1.5, slow: 0.5 }, { type: 'volley', cd: 9, count: 12, proj: 'frost', dmg: 0.6 }] },
    sorciere_givre: { name: 'Sorcière du givre', boss: 1, shape: 'wisp', color: '#d6f0ff', hp: 1500, dmg: 30, speed: 55, range: 260, cd: 1.4, size: 34, ranged: 'frost', onHit: { slow: 0.4, dur: 2 }, xp: 380, gold: 130, abilities: [{ type: 'volley', cd: 5, count: 16, proj: 'frost', dmg: 0.7 }, { type: 'summon', cd: 10, mob: 'esprit_givre', count: 4 }] },
    treant_colossal: { name: 'Tréant colossal', boss: 2, shape: 'treant', color: '#24563a', hp: 2500, dmg: 55, speed: 32, range: 60, cd: 2, size: 70, xp: 900, gold: 350, abilities: [{ type: 'slam', cd: 6, radius: 220, dmg: 1.4, slow: 0.4 }, { type: 'summon', cd: 9, mob: 'treant', count: 3 }] },

    crapaud_roi: { name: 'Crapaud-roi', boss: 1, shape: 'toad', color: '#3f8a1e', hp: 1800, dmg: 45, speed: 45, range: 240, cd: 1.6, size: 40, ranged: 'poison', onHit: { poison: 6, dur: 4 }, xp: 450, gold: 150, abilities: [{ type: 'volley', cd: 6, count: 14, proj: 'poison', dmg: 0.6 }] },
    araignee_reine: { name: 'Araignée reine', boss: 1, shape: 'spider', color: '#2b3320', hp: 2000, dmg: 50, speed: 70, range: 46, cd: 1.2, size: 42, onHit: { poison: 6, dur: 4 }, xp: 520, gold: 170, abilities: [{ type: 'summon', cd: 7, mob: 'araignee', count: 6 }] },
    champignon_titan: { name: 'Champignon titan', boss: 1, shape: 'shroom', color: '#9a2fe6', hp: 2200, dmg: 55, speed: 40, range: 50, cd: 1.6, size: 48, xp: 600, gold: 190, abilities: [{ type: 'slam', cd: 6, radius: 200, dmg: 1.2, poison: 8 }, { type: 'summon', cd: 9, mob: 'champignon', count: 4 }] },
    abomination: { name: 'Abomination', boss: 1, shape: 'zombie', color: '#4f6e2a', hp: 2500, dmg: 70, speed: 42, range: 56, cd: 1.6, size: 52, xp: 700, gold: 220, abilities: [{ type: 'charge', cd: 7, dmg: 2 }, { type: 'slam', cd: 8, radius: 170, dmg: 1.3, poison: 6 }] },
    liche_putride: { name: 'Liche putride', boss: 1, shape: 'wisp', color: '#a8ff5e', hp: 2600, dmg: 55, speed: 55, range: 280, cd: 1.3, size: 38, ranged: 'poison', onHit: { poison: 8, dur: 4 }, xp: 800, gold: 250, abilities: [{ type: 'volley', cd: 5, count: 18, proj: 'poison', dmg: 0.6 }, { type: 'summon', cd: 10, mob: 'mutant', count: 2 }] },
    mere_spore: { name: 'La Mère-Spore', boss: 2, shape: 'mother', color: '#c6ff5e', hp: 4000, dmg: 80, speed: 28, range: 70, cd: 2, size: 80, xp: 2000, gold: 700, abilities: [{ type: 'volley', cd: 5, count: 20, proj: 'poison', dmg: 0.5 }, { type: 'summon', cd: 7, mob: 'champignon', count: 5 }, { type: 'slam', cd: 9, radius: 260, dmg: 1.2, poison: 10 }] },

    seigneur_diablotin: { name: 'Seigneur diablotin', boss: 1, shape: 'imp', color: '#b8251a', hp: 2800, dmg: 75, speed: 80, range: 46, cd: 1, size: 36, onHit: { burn: 8, dur: 3 }, xp: 900, gold: 280, abilities: [{ type: 'summon', cd: 6, mob: 'diablotin', count: 6 }] },
    salamandre_ancienne: { name: 'Salamandre ancienne', boss: 1, shape: 'salamander', color: '#ff5a1a', hp: 3000, dmg: 70, speed: 50, range: 280, cd: 1.4, size: 44, ranged: 'fire', onHit: { burn: 10, dur: 3 }, xp: 1000, gold: 300, abilities: [{ type: 'volley', cd: 5, count: 18, proj: 'fire', dmg: 0.6 }] },
    cerbere: { name: 'Cerbère', boss: 1, shape: 'hound', color: '#3a1512', hp: 3200, dmg: 90, speed: 95, range: 50, cd: 0.9, size: 46, xp: 1100, gold: 330, abilities: [{ type: 'charge', cd: 6, dmg: 2 }, { type: 'summon', cd: 9, mob: 'chien_infernal', count: 3 }] },
    golem_obsidienne: { name: 'Golem d’obsidienne', boss: 1, shape: 'golem', color: '#2a2030', hp: 3500, dmg: 110, speed: 36, range: 56, cd: 1.8, size: 54, xp: 1300, gold: 380, abilities: [{ type: 'slam', cd: 6, radius: 220, dmg: 1.4, burn: 10 }] },
    phenix_noir: { name: 'Phénix noir', boss: 1, shape: 'wisp', color: '#ff3d1a', hp: 3400, dmg: 80, speed: 75, range: 300, cd: 1.2, size: 40, ranged: 'fire', onHit: { burn: 10, dur: 3 }, xp: 1400, gold: 400, abilities: [{ type: 'volley', cd: 4, count: 20, proj: 'fire', dmg: 0.55 }] },
    geant_magma: { name: 'Géant de magma', boss: 2, shape: 'elemental', color: '#ff5a1a', hp: 5000, dmg: 140, speed: 30, range: 80, cd: 2, size: 90, aura: { burn: 8, radius: 160 }, xp: 4000, gold: 1200, abilities: [{ type: 'slam', cd: 6, radius: 280, dmg: 1.4, burn: 14 }, { type: 'volley', cd: 7, count: 22, proj: 'fire', dmg: 0.5 }, { type: 'summon', cd: 10, mob: 'elementaire', count: 2 }] },

    // Invocations alliées (dessinées avec le même style)
    ally_wolf: { name: 'Loup', ally: true, shape: 'wolf', color: '#9a8a74', hp: 0.6, dmg: 1.0, atkMul: 1.5, speed: 115, range: 22, cd: 0.8, size: 12 },
    ally_bear: { name: 'Ours', ally: true, shape: 'boar', color: '#6b4a2e', hp: 1.6, dmg: 2.0, atkMul: 0.9, speed: 75, range: 30, cd: 1.3, size: 18 },
    ally_skeleton: { name: 'Squelette', ally: true, shape: 'skeleton', color: '#e8e2cf', hp: 0.5, dmg: 0.5, speed: 85, range: 24, cd: 1, size: 12 },
    ally_rat: { name: 'Rat', ally: true, shape: 'rat', color: '#7d7684', hp: 0.25, dmg: 0.6, speed: 125, range: 18, cd: 0.9, size: 9, poison: { pct: 0.2, dur: 2 } },
    ally_slime: { name: 'Slime', ally: true, shape: 'slime', color: '#58c84a', hp: 3.0, dmg: 0.75, speed: 60, range: 22, cd: 1.1, size: 12, onHit: { slow: 0.3, dur: 2 } },
    ally_zombie: { name: 'Zombie', ally: true, shape: 'zombie', color: '#7a9a5a', hp: 0.9, dmg: 1.1, speed: 50, range: 26, cd: 1.3, size: 15 },
    ally_falcon: { name: 'Faucon', ally: true, flying: true, shape: 'bird', color: '#9a6a3e', hp: 0.45, dmg: 1.5, speed: 175, range: 20, cd: 1.0, size: 10 },
    ally_pigeon: { name: 'Pigeon', ally: true, flying: true, shape: 'bird', color: '#9aa3b0', hp: 0.25, dmg: 0.5, atkMul: 1.5, speed: 165, range: 18, cd: 0.8, size: 8 },
    ally_eagle: { name: 'Aigle', ally: true, flying: true, shape: 'bird', color: '#4a3220', hp: 0.7, dmg: 1.0, speed: 150, range: 24, cd: 1.2, size: 13, marks: { every: 5, v: 1.0, dur: 3 } },
    ally_skelarcher: { name: 'Squelette archer', ally: true, ranged: true, shape: 'skeleton', color: '#e8e2cf', hp: 0.5, dmg: 1.0, atkMul: 1.1, critMul: 1.2, speed: 80, range: 230, cd: 1.4, size: 12 }
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
  /*
   * Spécialisation de la tour : choisie au premier vote d'équipe (gratuit). Ensuite, chaque vote propose
   * 2 des 8 améliorations de cette tour, le Pacte de sang et « Économiser » (+ la Résurrection s'il y a un mort).
   */
  const TOWER_SPECS = {
    attaque: { name: 'Tour d’attaque', icon: '⚔️', color: '#c0392b', desc: 'Tirs puissants sur une cible unique et gros bonus d’attaque pour les héros.' },
    defense: { name: 'Tour de défense', icon: '🛡️', color: '#4e6d95', desc: 'Remparts autour des habitations (nord, sud, est, ouest) et défense des héros.' },
    soin: { name: 'Tour de soin', icon: '💚', color: '#2e9e57', desc: 'Soins des héros, murets autour des habitations, réanimation.' },
    mage: { name: 'Tour de mage', icon: '🔮', color: '#8e44ad', desc: 'Sorts de zone (feu, givre, éclairs, météores), vitesse d’attaque et charge d’ultime des héros.' }
  };
  const UPGRADES = {
    // premier vote : spécialisation de la tour (gratuite)
    spec_attaque: { towerSpec: 'attaque', name: 'Tour d’attaque', icon: '⚔️', desc: TOWER_SPECS.attaque.desc, cost: 0, growth: 1, max: 1 },
    spec_defense: { towerSpec: 'defense', name: 'Tour de défense', icon: '🛡️', desc: TOWER_SPECS.defense.desc, cost: 0, growth: 1, max: 1 },
    spec_soin: { towerSpec: 'soin', name: 'Tour de soin', icon: '💚', desc: TOWER_SPECS.soin.desc, cost: 0, growth: 1, max: 1 },
    spec_mage: { towerSpec: 'mage', name: 'Tour de mage', icon: '🔮', desc: TOWER_SPECS.mage.desc, cost: 0, growth: 1, max: 1 },
    // ---- tour d'attaque
    at_bolt: { tower: 'attaque', name: 'Grande arbalète', icon: '🏹', desc: 'La tour tire des carreaux sur une cible unique (boss et élites d’abord) ; +50 % de dégâts par niveau', cost: 60, growth: 1.45, max: 6 },
    at_rate: { tower: 'attaque', needs: 'at_bolt', name: 'Mécanisme rapide', icon: '⚙️', desc: '+20 % de cadence de tir de la tour', cost: 90, growth: 1.5, max: 5 },
    at_sniper: { tower: 'attaque', needs: 'at_bolt', name: 'Tir de précision', icon: '🎯', desc: '+30 % de dégâts de la tour contre les boss et les élites', cost: 100, growth: 1.5, max: 5 },
    at_mark: { tower: 'attaque', needs: 'at_bolt', name: 'Marque de la tour', icon: '📍', desc: 'Les cibles de la tour subissent +10 % de dégâts pendant 4 s', cost: 120, growth: 1.6, max: 3 },
    at_forge: { tower: 'attaque', name: 'Forge de guerre', icon: '🔨', desc: '+12 % de dégâts pour tous les héros', cost: 90, growth: 1.45, max: 8 },
    at_cry: { tower: 'attaque', name: 'Cri de guerre', icon: '📯', desc: '+8 % de vitesse d’attaque pour tous les héros', cost: 110, growth: 1.5, max: 5 },
    at_crit: { tower: 'attaque', name: 'Œil du chasseur', icon: '👁️', desc: '+5 % de chances de critique pour tous les héros', cost: 100, growth: 1.5, max: 5 },
    at_execute: { tower: 'attaque', name: 'Coup de grâce', icon: '🗡️', desc: 'Les héros font +20 % de dégâts aux monstres sous 30 % de PV', cost: 120, growth: 1.55, max: 4 },
    // ---- tour de défense
    df_wall_n: { tower: 'defense', wall: 'n', name: 'Rempart nord', icon: '🧱', desc: 'Construit (puis renforce) un rempart au nord des habitations : les monstres doivent le casser', cost: 70, growth: 1.5, max: 3 },
    df_wall_s: { tower: 'defense', wall: 's', name: 'Rempart sud', icon: '🧱', desc: 'Construit (puis renforce) un rempart au sud des habitations : les monstres doivent le casser', cost: 70, growth: 1.5, max: 3 },
    df_wall_e: { tower: 'defense', wall: 'e', name: 'Rempart est', icon: '🧱', desc: 'Construit (puis renforce) un rempart à l’est des habitations : les monstres doivent le casser', cost: 70, growth: 1.5, max: 3 },
    df_wall_w: { tower: 'defense', wall: 'w', name: 'Rempart ouest', icon: '🧱', desc: 'Construit (puis renforce) un rempart à l’ouest des habitations : les monstres doivent le casser', cost: 70, growth: 1.5, max: 3 },
    df_stone: { tower: 'defense', name: 'Pierre taillée', icon: '🪨', desc: '+30 % de PV pour tous les remparts (et les répare) ; dresse une tour d’angle entre deux remparts voisins pour fermer le passage', cost: 100, growth: 1.5, max: 5 },
    df_spikes: { tower: 'defense', name: 'Pieux', icon: '🔱', desc: 'Les monstres qui frappent un rempart se blessent', cost: 90, growth: 1.5, max: 4 },
    df_armor: { tower: 'defense', name: 'Armurerie', icon: '🛡️', desc: '+6 % de réduction de dégâts pour tous les héros', cost: 110, growth: 1.5, max: 5 },
    df_keep: { tower: 'defense', name: 'Donjon renforcé', icon: '🏰', desc: '+10 % de PV max pour la tour (et autant de soin)', cost: 60, growth: 1.25, max: 10 },
    // ---- tour de soin
    so_fountain: { tower: 'soin', name: 'Fontaine de vie', icon: '⛲', desc: 'Soin d’entracte de la tour : +13 % de PV (10 % → 75 % au niveau 5)', cost: 70, growth: 1.45, max: 5 },
    so_wall: { tower: 'soin', name: 'Murets', icon: '🌿', desc: 'Construit (puis renforce) de petits murets tout autour des habitations', cost: 90, growth: 1.5, max: 3 },
    so_wallheal: { tower: 'soin', needs: 'so_wall', name: 'Murets bénis', icon: '✨', desc: 'Les murets soignent un peu les héros à côté (0,4 % de PV par seconde par niveau)', cost: 100, growth: 1.6, max: 2 },
    so_vigor: { tower: 'soin', name: 'Vigueur', icon: '❤️', desc: '+8 % de PV max pour tous les héros', cost: 90, growth: 1.45, max: 5 },
    so_regen: { tower: 'soin', name: 'Souffle de vie', icon: '💚', desc: 'Les héros régénèrent 0,3 % de leurs PV max par seconde', cost: 110, growth: 1.55, max: 4 },
    so_leech: { tower: 'soin', name: 'Bénédiction', icon: '🕊️', desc: 'Les héros se soignent de 1 % des dégâts qu’ils infligent', cost: 100, growth: 1.5, max: 3 },
    so_cleanse: { tower: 'soin', name: 'Purification', icon: '💧', desc: 'Poison et brûlure durent 25 % moins longtemps sur les héros', cost: 80, growth: 1.5, max: 3 },
    so_sanctuary: { tower: 'soin', name: 'Sanctuaire des âmes', icon: '⛑️', desc: 'Réanime 1 héros mort à la fin de chaque manche (2 au niveau 2)', cost: 180, growth: 1.8, max: 2 },
    // ---- tour de mage
    mg_fire: { tower: 'mage', name: 'Boule de feu', icon: '🔥', desc: 'La tour lance des boules de feu sur le plus gros groupe de monstres', cost: 80, growth: 1.5, max: 5 },
    mg_frost: { tower: 'mage', name: 'Nova de givre', icon: '❄️', desc: 'Onde de givre autour de la tour : ralentit les monstres, et les gèle à partir du niveau 3', cost: 90, growth: 1.5, max: 4 },
    mg_lightning: { tower: 'mage', name: 'Chaîne d’éclairs', icon: '⚡', desc: 'Un éclair qui rebondit sur 2 monstres de plus par niveau', cost: 100, growth: 1.5, max: 4 },
    mg_meteor: { tower: 'mage', name: 'Pluie de météores', icon: '☄️', desc: 'Toutes les 15 s, des météores tombent sur les monstres (2 par niveau)', cost: 150, growth: 1.6, max: 3 },
    mg_amp: { tower: 'mage', name: 'Amplification', icon: '✴️', desc: '+20 % de dégâts des sorts de la tour', cost: 100, growth: 1.5, max: 5 },
    mg_rate: { tower: 'mage', name: 'Canalisation', icon: '⏳', desc: 'Sorts de la tour 10 % plus fréquents', cost: 100, growth: 1.5, max: 5 },
    mg_haste: { tower: 'mage', name: 'Hâte', icon: '💨', desc: '+4 % de vitesse d’attaque pour tous les héros', cost: 80, growth: 1.45, max: 5 },
    mg_focus: { tower: 'mage', name: 'Concentration', icon: '🔮', desc: 'Les ultimes des héros se chargent 8 % plus vite', cost: 90, growth: 1.45, max: 5 },
    // proposée seulement s'il y a au moins un héros mort (les héros ne réapparaissent pas d'eux-mêmes)
    revive: { name: 'Résurrection', icon: '💖', desc: 'Réanime un héros mort au hasard à 60% de ses PV', cost: 40, growth: 1.3, max: 999, revive: true },
    pact: { name: 'Pacte de sang', icon: '💀', desc: 'Manche suivante : ennemis +50% PV et nombre, récompenses ×2', cost: 0, growth: 1, max: 999, challenge: true },
    // proposée au hasard dans les votes quand la carte a été bien récoltée
    nature: { name: 'Vitalité de la nature', icon: '🌱', desc: 'Les points de récolte de la carte récupèrent 30 % de leurs ressources', cost: 0, growth: 1, max: 999, nature: true }
  };

  /* ------------------------------------------------------------------ */
  /* Ressources (pierre, bois, baies) : récoltées par les héros sur la carte (réserve d'équipe de la partie)
   * et gagnées dans les mini-jeux (réserve du compte)                                                     */
  /* ------------------------------------------------------------------ */
  const RESOURCES = {
    pierre: { name: 'Pierre', icon: '🪨', color: '#9aa3ae', node: 'rocher' },
    bois: { name: 'Bois', icon: '🪵', color: '#a8703f', node: 'arbre' },
    baies: { name: 'Baies', icon: '🫐', color: '#7a4fd6', node: 'buisson' }
  };
  const RES_IDS = Object.keys(RESOURCES);
  // ressource principale de chaque tour (la tour de mage équilibre les trois)
  const TOWER_RES = { attaque: 'bois', defense: 'pierre', soin: 'baies' };
  const HARVEST = {
    PER_KIND: 10,         // points de récolte de chaque sorte au début d'une partie
    AMOUNT: [110, 180],   // ressources dans un point de récolte
    RANGE: 70,            // un héros à moins de RANGE px d'un point récolte automatiquement
    RATE: 1.5,            // ressources par seconde et par héros
    NATURE_REGROW: 0.3,   // vote « Vitalité de la nature » : part des ressources rendue à chaque point
    NATURE_CHANCE: 0.4,   // chance que ce choix apparaisse dans un vote (si la carte a été entamée)
    START: 30             // réserve de chaque ressource au début de la partie
  };
  // Coût d'une amélioration au niveau lvl, en ressources : sa ressource principale + 1/3 d'une autre
  // (tour de mage : deux ressources à peu près équilibrées). Résurrection : des baies.
  function upgradeResCost(id, lvl) {
    const u = UPGRADES[id];
    if (!u || u.challenge || u.nature || u.towerSpec || !u.cost) return {};
    const v = Math.round(u.cost * Math.pow(u.growth, lvl || 0));
    if (u.revive) return { baies: v };
    const k = Object.keys(UPGRADES).filter((x) => UPGRADES[x].tower === u.tower).indexOf(id);
    if (u.tower === 'mage') {
      const [a, b] = [['pierre', 'bois'], ['bois', 'baies'], ['baies', 'pierre']][k % 3];
      return { [a]: Math.round(v * 0.7), [b]: Math.round(v * 0.62) };
    }
    const main = TOWER_RES[u.tower], others = RES_IDS.filter((r) => r !== main);
    return { [main]: v, [others[k % 2]]: Math.round(v / 3) };
  }
  const canPay = (stock, cost) => Object.entries(cost).every(([r, n]) => (stock[r] || 0) >= n);
  const costText = (cost) => Object.entries(cost).map(([r, n]) => `${RESOURCES[r].icon} ${n}`).join(' + ');
  // Remparts (tour de défense) et murets (tour de soin) : segments autour des habitations
  const WALLS = {
    D: 250,             // rayon (repère elliptique des habitations) où se dressent les remparts
    SPAN: 36,           // chaque côté couvre ±SPAN degrés (les angles restent ouverts sans tour d'angle)
    STEP: 12,           // un segment tous les STEP degrés
    SIDES: { e: 0, s: 90, w: 180, n: 270 },
    // tours d'angle (Pierre taillée) : entre deux remparts voisins construits
    CORNERS: { se: ['s', 'e', 45], sw: ['s', 'w', 135], nw: ['n', 'w', 225], ne: ['n', 'e', 315] },
    HP: { wall: 260, muret: 120, corner: 420 }, // PV d'un segment au niveau 1 (× 1 + 0,5 par niveau, × la manche)
    REPAIR: 0.05        // part des PV réparée à chaque fin de manche (entracte)
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
  /*
   * Modes de partie et difficultés (choisis par l'admin au lancement).
   * Partie rapide : 35 manches en 4 ères de 10-10-10-5 ; le terrain se corrompt à chaque manche ;
   * une seule zone dangereuse à la fois ; récompenses un peu moins intéressantes.
   */
  const MODES = {
    classic: { name: 'Classique', waves: 100, rewards: 1, hazardMax: 99, powerScale: 1 },
    // powerScale : puissance des monstres de la manche n = celle de la manche n × powerScale en classique
    // voteEvery : vote d'équipe toutes les N manches (sinon, réglage de l'admin)
    quick: { name: 'Partie rapide', waves: 35, rewards: 0.85, hazardMax: 1, powerScale: 1, voteEvery: 1 }
  };
  const DIFFICULTIES = {
    facile: { name: 'Facile', icon: '🟢', mobHp: 0.7, mobDmg: 0.75, mobCount: 0.85, rewards: 0.7 },
    normal: { name: 'Normal', icon: '🟡', mobHp: 1, mobDmg: 1, mobCount: 1, rewards: 1 },
    difficile: { name: 'Difficile', icon: '🔴', mobHp: 1.45, mobDmg: 1.3, mobCount: 1.2, rewards: 1.4 }
  };
  // Manche « équivalente » du mode classique (monstres, boss, puissance) : en partie rapide,
  // chaque ère de 10 manches couvre une ère classique de 30 manches ; les 5 dernières couvrent 91-100.
  function equivalentWave(mode, w) {
    if (mode !== 'quick') return w;
    if (w <= 30) { const era = Math.ceil(w / 10) - 1, i = w - era * 10; return era * 30 + i * 3; }
    return 90 + (w - 30) * 2;
  }
  // Ère affichée pour une manche (partie rapide : 1-10, 11-20, 21-30, 31-35)
  function eraFor(mode, w) {
    if (mode !== 'quick') return eraOfWave(w);
    return ERAS[Math.min(3, Math.floor((Math.max(1, w) - 1) / 10))];
  }

  const eraOfWave = (w) => ERAS.find((e) => w >= e.from && w <= e.to) || ERAS[ERAS.length - 1];

  /* Codes réseau compacts (instantanés serveur -> écran) */
  const NET = {
    PROJ_KINDS: ['arrow', 'bolt', 'orb', 'ice', 'fire', 'holy', 'frost', 'poison', 'fireball', 'rock', 'ballista', 'note', 'charm', 'flask', 'meteor'],
    ZONE_KINDS: ['smoke', 'poison', 'telegraph', 'tline', 'fire', 'ice', 'toxic', 'lava', 'trap', 'thorns', 'acid'],
    HF: { DEAD: 1, STEALTH: 2, ZOMBIE: 4, ATTACK: 8, FURY: 16, SHIELD: 32, SLOW: 64, POISON: 128, BURN: 256, ULT: 1024, RETREAT: 2048, DASH: 4096, SONG: 8192, ANTHEM: 16384 },
    MF: { ELITE: 1, BOSS: 2, ATTACK: 4, SLOW: 8, POISON: 16, BURN: 32, CHARGE: 64, FROZEN: 128, CHARM: 256, MARK: 512, BLIND: 1024 }
  };

  return { RESOURCES, RES_IDS, TOWER_RES, HARVEST, upgradeResCost, canPay, costText, TOWER_SPECS, WALLS, passiveLines, summonEffects, SUMMON_EVERY, SUMMON_RESPAWN, SUMMON_SECOND_RANK, POST_ULT, SUMMONS, SUMMON_CAP, SUMMON_CAP_MAX, SUMMON_RANK_POWER, requiredRank, summonRanks, summonText, ultUnlocked, SKILL_MODS, bonusText, isConsumable, setSize, BUILDING_VARIANTS, MODES, DIFFICULTIES, equivalentWave, eraFor, HOUSE_RESPEC_REFUND, houseSpent, HOUSE_UPGRADES, HOUSE_SPECIALS, houseCost, houseOf, houseHp, houseHeal, houseSpecial, placeBuilding, SKILLS, SKILL_TREE, INITIATION, startedBranch, SKILL_MAX_RANK, skillsOfFamily, skillPoints, skillBonus, BUILDINGS, buildingPos, BALANCE, NET, WORLD, PALETTE, CLASSES, BASE_CLASSES, CLASS_IDS, specsOf, PROGRESSION, ATTRIBUTES, ATTR_IDS, emptyAttrs, computeStats, familyOf, SLOTS, SLOT_NAMES, RARITIES, rollRarity, GLACONS, recycleValue, SETS, TEMPLATES, STAT_NAMES, canUse, itemStats, itemName, gearFor, setBonuses, itemLook, WEAPON_METAL, AI_OPTIONS, DEFAULT_AI, LOOK_OPTIONS, DEFAULT_LOOK, randomLook, sanitizeLook, MOBS, MOB_IDS, BOSS_WAVES, UPGRADES, ERAS, eraOfWave };
});
