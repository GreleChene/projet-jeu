# Tour des Viewers ⚔️🏰

Jeu de **défense de tour** pour les viewers Twitch. Chaque viewer crée un compte sur le site et obtient un **héros autonome** (piloté par une IA qu'il personnalise). Les héros défendent ensemble une tour au centre de l'écran contre des vagues de monstres venues de tous les bords. Le streamer diffuse la bataille via OBS. Les viewers interviennent depuis leur téléphone ou leur PC.

## Démarrage

```bash
npm install
```

```bash
ADMIN_PSEUDO=monpseudo ADMIN_PASSWORD=motdepasse npm start
```

| Page | URL | Usage |
|---|---|---|
| Joueur | `http://localhost:3000/` | inscription (pseudo + mot de passe), classe, armures, IA, choix en bataille, votes |
| Stream | `http://localhost:3000/stream` | **source Navigateur OBS en 1920×1080** (publique, en lecture seule) |
| Admin | `http://localhost:3000/admin` | lancer, mettre en pause ou arrêter une partie, aller à une manche, régler, bots de test, comptes |

Le **premier compte créé** devient administrateur, tout comme le compte défini par `ADMIN_PSEUDO` et `ADMIN_PASSWORD`.

### Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | port HTTP |
| `DATA_FILE` | `data/db.json` | fichier de sauvegarde (comptes, progression, réglages) |
| `ADMIN_PSEUDO` / `ADMIN_PASSWORD` | – | compte admin créé ou promu au démarrage |
| `PUBLIC_URL` | hôte courant | adresse affichée sur le stream (« Rejoins la défense : … ») |
| `SECURE_COOKIES` | `0` | à mettre à `1` derrière HTTPS |

En production, placez le serveur derrière un proxy HTTPS (Caddy ou Nginx) qui transmet les WebSockets.

## Le jeu

- **Mode défense de tour.** Les monstres arrivent de tous les bords. Si la tour tombe, la partie est perdue. Il y a 100 manches.
- **Classes évolutives.** Tout le monde commence *Habitant*. Au niveau 3, le joueur choisit une classe. Au niveau 8, il choisit une spécialisation, qui donne un **ultime** :
  - Soldat → Paladin (tourbillon en cercle) / Chevalier (charge à 200 %)
  - Mage → Glace (cône de froid) / Feu (boule de feu) / Soin (soin de zone de 350 px)
  - Éleveur (laisse de 800 px) → Dompteur (renforce et soigne ses bêtes) / Nécromancien (relève un allié mort à 75 % de ses PV, qui perd ensuite 1 % de PV par seconde)
  - Archer (laisse de 800 px) → Arbalétrier (cadence ×3) / Arc long (3 flèches perforantes à 150 %)
  - Assassin → Ombre (invisible toutes les 10 s, écran de fumée) / Flèche (dash critique toutes les 6 s, dash en chaîne sans limite)
  - Paysan (laisse de 500 px, récolte la richesse de l'équipe) → Agriculteur (soigne les alliés) / Bûcheron (soigne la tour) / Mineur (augmente les PV max de la tour)
- **IA personnalisable.** Le joueur règle la posture, la cible prioritaire, le seuil de retraite et l'usage de l'ultime. Les changements s'appliquent en direct.
- **Armures.** Casques et plastrons en 5 tiers (tissu → runique), achetés avec des écus gagnés en jeu et conservés d'une partie à l'autre. Elles sont visibles sur le personnage.
- **Choix en bataille** (sur le site). Toutes les 40 s environ, chaque joueur reçoit une carte : Fureur, Potion, Concentration, Bouclier, Célérité, ou **Défi** (3 élites apparaissent, contre des récompenses doublées).
- **Votes d'équipe.** Pendant l'entracte, les joueurs votent pour dépenser la richesse (remparts, baliste, forge, infirmerie…). Les meilleures améliorations se débloquent quand l'équipe a accumulé plus de richesse. Le vote peut aussi porter sur le **Pacte de sang** (manche plus dure, récompenses ×2). Les améliorations apparaissent sur la tour.

### Progression du terrain

| Manches | Biome | Boss |
|---|---|---|
| 1–30 | Prairie, puis le **givre** gagne du terrain depuis les bords après chaque boss (toutes les 5 manches) | 30 : tous les sapins se déracinent, puis le **Tréant colossal** apparaît |
| 31–60 | **Corruption verte fluo**, avec des mobs empoisonneurs | 60 : **La Mère-Spore** *(proposition, à valider)* |
| 61–90 | **Terres brûlées** et coulées de lave (décor) | 90 : **Géant de magma** |
| 91–100 | Mélange des trois terrains, avec tous les monstres | 100 : les trois grands boss ensemble |

## Architecture

```
server/             Node.js (Express + Socket.IO)
  index.js          API comptes / joueur / admin, sessions, temps réel
  db.js             stockage JSON (écriture atomique)
  game/engine.js    boucle de jeu autoritaire (20 Hz), manches, votes, réseau
  game/heroes.js    IA des héros, passifs, ultimes, invocations
  game/mobs.js      vagues, IA des monstres, capacités des boss
shared/             partagé serveur ↔ navigateur
  constants.js      classes, armures, monstres, boss, palette graphique
  terrain.js        génération déterministe du terrain et des biomes
public/
  js/art.js         toute la direction artistique (un seul module de dessin)
  js/stream.js      écran du stream    js/player.js  page joueur    js/admin.js  admin
test/               tests du moteur (npm test)
```

**Cohérence graphique.** Toutes les couleurs viennent de `GameData.PALETTE`, et tous les dessins passent par `public/js/art.js`. Le style est le même partout : aplats, contour sombre unique, ombre portée et proportions « chibi ». Le stream, les aperçus de la page joueur et la boutique utilisent les mêmes fonctions de dessin.

L'équilibrage (PV, dégâts, mise à l'échelle par manche et par nombre de joueurs) se règle dans `shared/constants.js` et `server/game/mobs.js` (`scaling`). En cours de partie, l'admin dispose aussi d'un multiplicateur de difficulté.
