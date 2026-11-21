# Tour des Viewers ⚔️🏰

Jeu de **défense de tour** pour les viewers Twitch. Chaque viewer crée un compte sur le site et obtient un **héros autonome** (piloté par une IA qu'il personnalise). Les héros défendent ensemble une tour au centre de l'écran contre des vagues de monstres venues de tous les bords. Le streamer diffuse la bataille via OBS. Les viewers interviennent depuis leur téléphone ou leur PC.

## Démarrage

```bash
npm install
```

```bash
npm start
```

| Page | URL | Usage |
|---|---|---|
| Joueur | `http://localhost:3000/` | inscription (pseudo + mot de passe), classe, statistiques, armures, IA, votes |
| Stream | `http://localhost:3000/stream` | **source Navigateur OBS en 1920×1080** (publique, en lecture seule) |
| Admin | `http://localhost:3000/admin` | lancer, mettre en pause ou arrêter une partie, aller à une manche, régler, bots de test (classe et niveau au choix), comptes (donner de l'XP, des Grêlons ou des glaçons), **onglet Équilibrage** |

**Administration :** au premier démarrage, le compte **`admin`** est créé avec le mot de passe **`123456`**. C'est le **seul** compte qui a accès à `/admin` et à l'API d'administration ; la page redirige tous les autres vers l'accueil, et personne ne peut s'inscrire sous le pseudo « admin ». Change ce mot de passe dès la mise en ligne (onglet « Compte » de la page joueur, connecté en tant qu'`admin`).

### Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | port HTTP |
| `DATA_FILE` | `data/db.json` | fichier de sauvegarde (comptes, progression, réglages) |
| `PUBLIC_URL` | hôte courant | adresse affichée sur le stream (« Rejoins la défense : … ») |
| `SECURE_COOKIES` | `0` | à mettre à `1` derrière HTTPS |

En production, placez le serveur derrière un proxy HTTPS (Caddy ou Nginx) qui transmet les WebSockets.

## Le jeu

- **Lancement par l'admin et inscriptions limitées.** Le bouton « Rejoindre la bataille » n'apparaît que lorsque l'admin a lancé une bataille, et seulement pendant la durée d'inscription qu'il a choisie (180 s par défaut, réglable ; l'admin peut aussi rouvrir ou fermer les inscriptions). Ensuite, plus personne ne peut rejoindre. Chaque nouvelle bataille demande de rejoindre à nouveau.
- **Twitch** (chaîne `hyoneko_` par défaut, réglable dans l'admin). Le serveur lit le chat en anonyme, sans identifiants, et reconnaît trois commandes :
  - `!lier CODE` : lie le compte Twitch au compte du site (le code est affiché dans l'onglet Compte) ;
  - `!join` : fait rejoindre la bataille au héros du compte lié ;
  - `!1`, `!2`… : votes d'équipe (ouverts à tout le chat ou aux seuls héros, au choix).

  L'admin dispose d'un simulateur de messages pour tester sans être en live.
- **Mode défense de tour.** Les monstres arrivent de tous les bords. La tour commence avec **200 PV** ; si elle tombe, la partie est perdue. Il y a 100 manches.
- **Arbres de compétences.**
  - Tout le monde commence Habitant, avec un **arbre d'initiation** : une compétence liée à chaque classe.
  - Le **choix de la classe se fait au niveau 7**. L'initiation de la classe choisie est conservée et les points des autres sont rendus.
  - L'arbre de la classe a une branche par spécialisation : 5 compétences passives (3 rangs chacune), l'**ultime au bout (niveau 30 requis)**, qui fait devenir la spécialisation, puis une maîtrise (5 rangs).
  - **Une seule spécialisation** : dès qu'un point est placé dans une branche, les autres sont bloquées.
  - On gagne 1 point de compétence tous les 2 niveaux.
  - La reconversion remet tout à zéro (changement de classe possible) mais fait perdre un quart des points attribués.
- **Habitations.** Chaque héros a la sienne, du type de sa classe, dans la limite de **5 par classe** (réglable). Au-delà, le joueur partage l'habitation la moins occupée de sa classe, et leurs **PV fusionnent** : 100 PV par occupant. Quand une place se libère, un occupant récupère sa propre habitation. Les habitations sont placées au hasard autour de la tour, classes mélangées, y compris au nord (la tour peut les cacher en partie). Les monstres frappent celles qui se trouvent sur leur trajet vers la tour. Pendant l'entracte, chaque héros rentre se soigner dans la sienne, ce qui devient impossible si elle est détruite.
- **Amélioration de bâtiment** (onglet dédié, achats en Grêlons, conservés d'une partie à l'autre) :
  - *Murs renforcés* : +25 % de PV par niveau. Quand une habitation est partagée, les PV des occupants s'additionnent.
  - *Lits douillets* : +20 % de puissance de soin par niveau. Une habitation partagée applique la **moyenne** des occupants, pas un double soin.
  - Une amélioration **spéciale par classe** :

    | Classe | Amélioration | Effet |
    |---|---|---|
    | Paysan | Grenier | plus d'écus récoltés |
    | Habitant | Foyer | plus d'XP |
    | Mage | Bibliothèque | charge de l'ultime plus rapide |
    | Éleveur | Enclos | invocations plus fortes |
    | Archer | Vigie | la tour de guet tire sur les ennemis proches |
    | Assassin | Pièges | les ennemis proches du repaire sont ralentis |
    | Soldat | Râtelier | plus de défense |

    Pour les effets de bâtiment (Vigie, Pièges), c'est le meilleur niveau des occupants qui compte.
  - Coûts et effets sont réglables dans l'onglet Équilibrage.
- **Zones de biome.** À chaque manche, de petites zones apparaissent au hasard, sur des tuiles du biome correspondant et sans se chevaucher : glace (ralentit les héros), poison (−1 % des PV max toutes les 3 s), lave (−1 % toutes les 2 s). Pendant les manches 91 à 100, les trois types coexistent. Tout est réglable dans l'onglet Équilibrage.
- **Adaptation au nombre de joueurs.** La puissance des monstres (PV et dégâts), leur nombre et la durée des manches augmentent avec le nombre de héros. Tout est réglable dans l'onglet Équilibrage.
- **Niveaux et statistiques.** Monter de niveau n'augmente pas les statistiques. Chaque niveau rapporte **1 point de stat** (Vie, Force, Défense, Agilité, Vitesse, Critique), réinitialisable gratuitement, et **1 glaçon**. Seuls les points de stat et l'équipement renforcent un héros. Les comptes existants ont reçu rétroactivement 1 glaçon par niveau déjà gagné.
- **Classes évolutives.** Tout le monde commence *Habitant*. Au niveau 3, le joueur choisit une classe. Au niveau 8, il choisit une spécialisation, qui donne un **ultime** :
  - Soldat → Paladin (tourbillon en cercle) / Chevalier (charge à 200 %)
  - Mage → Glace (cône de froid) / Feu (boule de feu) / Soin (soin de zone de 350 px)
  - Éleveur (laisse de 800 px) → Dompteur (renforce et soigne ses bêtes) / Nécromancien (relève un allié mort à 75 % de ses PV, qui perd ensuite 1 % de PV par seconde)
  - Archer (laisse de 800 px) → Arbalétrier (cadence ×3) / Arc long (3 flèches perforantes à 150 %)
  - Assassin → Ombre (invisible toutes les 10 s, écran de fumée) / Flèche (dash critique toutes les 6 s, dash en chaîne sans limite)
  - Paysan (laisse de 500 px, récolte les écus de l'équipe) → Agriculteur (soigne les alliés) / Bûcheron (soigne la tour) / Mineur (augmente les PV max de la tour)
- **IA personnalisable.** Le joueur règle la posture, la cible prioritaire, le seuil de retraite et l'usage de l'ultime. Les changements s'appliquent en direct.
- **Deux monnaies.**
  - **Grêlons** : monnaie personnelle, gagnée en combattant et conservée entre les parties. Elle sert à acheter des glaçons, et le recyclage d'objets en rapporte.
  - **Écus** 🪙 : trésor collectif de la partie en cours (éliminations, récoltes des paysans). L'équipe le dépense lors des votes.
- **Glaçons 🧊 (coffres).**
  - On gagne 1 glaçon par manche passée, ou on l'achète 75 Grêlons.
  - Contenu : 60 % une pièce d'un set universel, 35 % une pièce du set de sa classe, 5 % une pièce du set d'une **autre** classe (à vendre, donner ou échanger).
  - À l'ouverture, une animation montre le glaçon qui tremble, se fissure et éclate. Sa lueur intérieure trahit la rareté.
  - **Recyclage** : un objet recyclé rapporte des Grêlons, une fraction du prix d'un glaçon selon sa rareté (5 %, 10 %, 20 %, 40 %, 70 %, 100 %). Le maximum est le prix d'un glaçon, et ces montants suivent automatiquement le prix du glaçon s'il change.
- **Raretés.**

  | Rareté | Probabilité | Bonus |
  |---|---|---|
  | Commun | 50 % | ×1 |
  | Peu commun | 28 % | ×1,25 |
  | Rare | 14 % | ×1,55 |
  | Épique | 6 % | ×1,9 |
  | Légendaire | 1,9 % | ×2,4 |
  | Mystique | 0,1 % | ×3,2 |

  La rareté mystique est **entièrement cachée** (règles, inventaire, place marchande, journal du stream) tant que le joueur n'en a pas trouvé une. Plus la rareté est haute, plus l'objet est détaillé sur le personnage.
- **Place marchande.** Les joueurs vendent leurs objets en Grêlons (éventuellement réservés à un joueur), les offrent, ou proposent des échanges objet contre objet (+ Grêlons). Un objet en vente ou en échange ne peut être ni porté ni recyclé.
- **Sets.** Il y a 5 emplacements : casque, torse, pantalon, chaussures et arme.
  - Un set par famille de classes (5 pièces, arme comprise) : Rempart (soldat), Arcaniste (mage), Maître-bête (éleveur), Œil-de-faucon (archer), Lame-nuit (assassin), Moisson (paysan).
  - Trois sets universels (4 pièces), portables par toutes les classes : Voyageur, Givre éternel, Braise.
  - Porter 2, 4 ou 5 pièces d'un même set donne des bonus. Tout le détail est dans l'onglet **📜 Règles** du site.
- **Votes d'équipe.** Toutes les **2 manches** (réglable dans l'admin), pendant l'entracte, les joueurs votent pour dépenser les écus de l'équipe (remparts, baliste, forge, infirmerie…). Les meilleures améliorations se débloquent quand l'équipe a accumulé plus d'écus. Le vote peut aussi porter sur le **Pacte de sang** (manche plus dure, récompenses ×2). Les améliorations apparaissent sur la tour.

### Progression du terrain

| Manches | Biome | Boss |
|---|---|---|
| 1–30 | Prairie, puis le **givre** gagne du terrain depuis les bords après chaque boss (toutes les 5 manches) | 30 : tous les sapins se déracinent, puis le **Tréant colossal** apparaît |
| 31–60 | **Corruption verte fluo**, avec des mobs empoisonneurs | 60 : **La Mère-Spore** *(proposition, à valider)* |
| 61–90 | **Terres brûlées** et coulées de lave (décor) | 90 : **Géant de magma** |
| 91–100 | Mélange des trois terrains, avec tous les monstres | 100 : les trois grands boss ensemble |

## Équilibrage en direct (admin)

L'onglet **📊 Équilibrage** de la page admin affiche toutes les valeurs du jeu et permet de les modifier :
- les réglages généraux (PV de la tour, croissance des monstres par manche, élites, boss, récompenses, récolte…) ;
- la progression (niveaux, XP, points et glaçons par niveau) et l'effet de chaque point de stat ;
- les glaçons (prix, contenu) et les raretés (probabilités, multiplicateurs, recyclage) ;
- les stats de chaque classe, de chaque monstre et boss, et des capacités des boss ;
- chaque pièce d'équipement, les bonus de sets et les améliorations de la tour.

Chaque modification est enregistrée dans la base et appliquée **immédiatement** au serveur, aux pages des joueurs et au stream, sans redémarrage ni passage par le code. Un bouton « ↺ » remet la valeur d'origine.

## Architecture

```
server/             Node.js (Express + Socket.IO)
  index.js          API comptes / joueur / admin, sessions, temps réel
  balance.js        équilibrage modifiable en direct depuis l'admin
  twitch.js         lecture du chat Twitch (!join, !lier, votes)
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
