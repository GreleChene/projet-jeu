# Tour des Viewers — guide pour Claude

Jeu de **défense de tour pour viewers Twitch** (en français). Chaque viewer a un héros autonome (IA réglable) ; le streamer diffuse la bataille dans OBS. Le README décrit toutes les règles du jeu : **le tenir à jour à chaque changement visible**.

## Commandes

```bash
npm start                         # serveur (port 3000 ; PORT et DATA_FILE pour changer)
npm test                          # tests node:test (test/*.test.js) — toujours les lancer avant de pousser
npm run sim:duree                 # durée des parties gagnées (option --normal : parties réelles)
npm run sim:economie              # ressources récoltées / dépensées / restes (options --manche=20 --tour=defense --recolteurs=2)
npm run sim:minijeux              # mini-jeux : salle atteinte, morts, ressources rapportées (options --mode=mine --familiers=k_loup,araignee:3)
npm run sim:classes [spec…]       # équilibrage : manche atteinte par 5 bots d'une même spécialisation
npm run sim:invocations           # nombre de créatures, cadence, ultimes utilisés
npm run sim:passifs               # déclenchements des passifs de classe
npm run captures -- stream        # captures/stream-calme.png et stream-vague.png
npm run captures -- joueur --onglet=hero [--mobile]   # captures/joueur-<onglet>.png
```

Pages : `/` (joueur), `/stream` (OBS, 1920×1080), `/admin` (compte `admin` / `123456`, recréé à chaque démarrage).

## Architecture

- `shared/constants.js` — **toutes les données et réglages** (partagé serveur + navigateur, `window.GameData`) :
  `WORLD` (carte 1920×1080, `WAVE_ZOOM`, marges d'apparition), `BALANCE` (durées, difficulté, écus, tour), `CLASSES`,
  `SKILL_TREE` / `POST_ULT` / `INITIATION` / `SKILLS` (arbre), `SUMMONS` (invocations), `SKILL_MODS` (bonus spéciaux),
  `SETS` / `TEMPLATES` / `RARITIES` (objets des glaçons), `TOWER_SPECS` + `UPGRADES` (votes : spécialisation de la tour puis ses 8 améliorations), `WALLS` (remparts), `RESOURCES` / `HARVEST` / `upgradeResCost` (pierre, bois, baies : récolte et coûts), `MINI` (mini-jeux), `PETS` + `petPower` (familiers), `MOBS`, `BOSS_WAVES`, `NET` (indices réseau).
- `server/index.js` — Express + Socket.IO : API joueur/admin, règles de l'arbre (`/api/me/skill`), glaçons, marché.
- `server/db.js` — base JSON (`data/db.json`) ; **toute évolution du format passe par une migration dans `migrateUser`** (drapeau `xxxV1`).
- `server/game/engine.js` — boucle (20 Hz), manches, votes, habitations, statistiques des héros (`refreshHero`), instantanés réseau.
- `server/game/heroes.js` — IA des héros, passifs de classe, invocations (`summonPlan`), ultimes (`wantsUlt` / `useUlt`).
- `server/game/mobs.js` — monstres, apparition (`edgePoint` : bord de la vue dézoomée), dégâts (`damageMob`), récompenses.
- `server/mini.js` — mini-jeux solo tour par tour (énergie, salles, élites, remonter/continuer, améliorations) ; état dans `u.mini`.
- `server/pets.js` — familiers des mini-jeux (chenil, œufs, repos/régénération, XP, familier principal du stream) ; état dans `u.pets`.
- `server/twitch.js` — chat Twitch anonyme (!join, !lier, votes) et abonnements (Grêlons).
- `public/js/art.js` — **tout le dessin** : héros pixel art composés (`buildHeroPixels`, armes `drawWeaponPx`, monture), monstres en sprites, bâtiments, tour, projectiles.
- `public/js/sprites.js` — **généré** par `tools/pixelart/export.py` (ne pas éditer à la main) ; sources Python dans `tools/pixelart/` (`s_*.py`, `build.py` pour un aperçu).
- `public/js/stream.js` — rendu du stream (caméra, dézoom + brume pendant les vagues, effets, HUD, votes).
- `public/js/mini.js` — onglet Mini-jeux (scènes des 3 × 3 × 6 décors, combats animés).
- `public/js/player.js` — page joueur (arbre de compétences en étoile, équipement, glaçons, IA, compte).

## Règles de conception (demandées par le propriétaire)

- Tout le texte visible est **en français**, commentaires de code aussi.
- Style graphique : **pixel art clair et coloré** (pas de thème sombre pour le jeu), contours foncés `#120c0a`.
- Partie **classique gagnée ≤ 60 min** (cible ≈ 45-52 min), partie rapide ≈ 12-15 min. Vérifier avec `npm run sim:duree` après tout changement de durée, de vitesse ou d'apparition des monstres.
- **Pas de gros surplus de ressources** en fin de partie (vérifier avec `npm run sim:economie`) ; les écus n'existent plus.
- Arbre : centre Paysan (identifiant interne `habitant`), branche de classe (niveau 7), sous-branche (initiation 3/3), 5 compétences, ultime (niveau 30), 2 compétences d'après-ultime ; **2 points requis dans le nœud précédent** ; aucune compétence d'avant l'ultime ne charge l'ultime.
- Invocations : 1 créature par nœud, 2 au rang 3 ; **6 au plus, 9 avec la compétence d'après-ultime** ; une toutes les 10 s, 5 s après une mort ; statistiques relatives aux statistiques réelles du héros.
- Votes : 1er vote = spécialisation de la tour (attaque, défense, soin, mage) ; ensuite 3 choix : 2 améliorations de la tour + Pacte de sang (remplacé par la Résurrection s'il y a un mort, sinon parfois par la Vitalité de la nature). Plus de « Économiser » ; sans vote, choix au hasard. Coûts en ressources : principale de la tour + 1/3 d'une autre (mage : deux équilibrées).
- Mini-jeux : 1 énergie / 6 h (3 max), élite toutes les 5 salles, remonter/continuer toutes les 3 salles (pas de fuite), mort = 75 % perdus ; statistiques propres aux mini-jeux (`MINI.BASE` + `miniStats`), bouclier à recharge (2 tours, remis à zéro à chaque salle, jamais incassable : vérifier avec `sim:minijeux`). Familiers : chenil 10 glaçons, œuf 1 % des récompenses d'élite (30 min d'incubation, monstre de la zone, rareté ; chaque monstre n'existe que dans une zone — test dans `pets.test.js`), 2 actifs, 20 % des coups sur eux, PV régénérés avec le temps (K.-O. → repos jusqu'à 50 %), évolution esthétique, familier principal niv. 10+ sur le stream. Remparts/murets = vrais murs à PV (`refreshWalls`, `wallBlocking`). Soin d'entracte 10 % → 75 % ; pas de retraite ni de soin continu près de la tour. L'admin peut donner une amélioration pour tester (action `upgrade`).
- Chaque classe sauf le Paysan a un passif (champ dans `CLASSES`, texte généré par `passiveLines`, effet dans `heroes.js` / `mobs.js`).
- Les statistiques d'un héros sont **figées pendant une bataille** (profil verrouillé), les récompenses versées en fin de partie.

## Façon de travailler

1. Modifier → `npm test`.
2. Mécanique de jeu : la simulation adaptée (`tools/sim/`). Visuel : `npm run captures …` puis regarder l'image.
3. Mettre à jour le README (et la page Règles dans `player.js` si besoin).
4. Rappeler au propriétaire de **redémarrer le serveur** (et Ctrl+F5 sur le navigateur / « Actualiser le cache » dans OBS) : beaucoup de « bugs » signalés venaient d'un serveur ancien.

Pièges connus : `startedBranch` / `requiredRank` doivent rester identiques côté serveur (`server/index.js`) et page (`player.js`) ; un nouvel identifiant de projectile, zone ou drapeau réseau s'ajoute dans `NET` (constants) et se dessine dans `stream.js` / `art.js`.
