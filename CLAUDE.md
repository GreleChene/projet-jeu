# Tour des Viewers — guide pour Claude

Jeu de **défense de tour pour viewers Twitch** (en français). Chaque viewer a un héros autonome (IA réglable) ; le streamer diffuse la bataille dans OBS. Le README décrit toutes les règles du jeu : **le tenir à jour à chaque changement visible**.

## Commandes

```bash
npm start                         # serveur (port 3000 ; PORT et DATA_FILE pour changer)
npm test                          # tests node:test (test/*.test.js) — toujours les lancer avant de pousser
npm run sim:duree                 # durée des parties gagnées (option --normal : parties réelles)
npm run sim:economie              # écus gagnés / dépensés / surplus (option --manche=20)
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
  `SETS` / `TEMPLATES` / `RARITIES` (objets des glaçons), `UPGRADES` (votes d'équipe), `MOBS`, `BOSS_WAVES`, `NET` (indices réseau).
- `server/index.js` — Express + Socket.IO : API joueur/admin, règles de l'arbre (`/api/me/skill`), glaçons, marché.
- `server/db.js` — base JSON (`data/db.json`) ; **toute évolution du format passe par une migration dans `migrateUser`** (drapeau `xxxV1`).
- `server/game/engine.js` — boucle (20 Hz), manches, votes, habitations, statistiques des héros (`refreshHero`), instantanés réseau.
- `server/game/heroes.js` — IA des héros, passifs de classe, invocations (`summonPlan`), ultimes (`wantsUlt` / `useUlt`).
- `server/game/mobs.js` — monstres, apparition (`edgePoint` : bord de la vue dézoomée), dégâts (`damageMob`), récompenses.
- `server/twitch.js` — chat Twitch anonyme (!join, !lier, votes) et abonnements (Grêlons).
- `public/js/art.js` — **tout le dessin** : héros pixel art composés (`buildHeroPixels`, armes `drawWeaponPx`, monture), monstres en sprites, bâtiments, tour, projectiles.
- `public/js/sprites.js` — **généré** par `tools/pixelart/export.py` (ne pas éditer à la main) ; sources Python dans `tools/pixelart/` (`s_*.py`, `build.py` pour un aperçu).
- `public/js/stream.js` — rendu du stream (caméra, dézoom + brume pendant les vagues, effets, HUD, votes).
- `public/js/player.js` — page joueur (arbre de compétences en étoile, équipement, glaçons, IA, compte).

## Règles de conception (demandées par le propriétaire)

- Tout le texte visible est **en français**, commentaires de code aussi.
- Style graphique : **pixel art clair et coloré** (pas de thème sombre pour le jeu), contours foncés `#120c0a`.
- Partie **classique gagnée ≤ 60 min** (cible ≈ 45-52 min), partie rapide ≈ 12-15 min. Vérifier avec `npm run sim:duree` après tout changement de durée, de vitesse ou d'apparition des monstres.
- **Pas de surplus d'écus** en fin de partie (vérifier avec `npm run sim:economie`).
- Arbre : centre Paysan (identifiant interne `habitant`), branche de classe (niveau 7), sous-branche (initiation 3/3), 5 compétences, ultime (niveau 30), 2 compétences d'après-ultime ; **2 points requis dans le nœud précédent** ; aucune compétence d'avant l'ultime ne charge l'ultime.
- Invocations : 1 créature par nœud, 2 au rang 3 ; **6 au plus, 9 avec la compétence d'après-ultime** ; une toutes les 10 s, 5 s après une mort ; statistiques relatives aux statistiques réelles du héros.
- Chaque classe sauf le Paysan a un passif (champ dans `CLASSES`, texte généré par `passiveLines`, effet dans `heroes.js` / `mobs.js`).
- Les statistiques d'un héros sont **figées pendant une bataille** (profil verrouillé), les récompenses versées en fin de partie.

## Façon de travailler

1. Modifier → `npm test`.
2. Mécanique de jeu : la simulation adaptée (`tools/sim/`). Visuel : `npm run captures …` puis regarder l'image.
3. Mettre à jour le README (et la page Règles dans `player.js` si besoin).
4. Rappeler au propriétaire de **redémarrer le serveur** (et Ctrl+F5 sur le navigateur / « Actualiser le cache » dans OBS) : beaucoup de « bugs » signalés venaient d'un serveur ancien.

Pièges connus : `startedBranch` / `requiredRank` doivent rester identiques côté serveur (`server/index.js`) et page (`player.js`) ; un nouvel identifiant de projectile, zone ou drapeau réseau s'ajoute dans `NET` (constants) et se dessine dans `stream.js` / `art.js`.
