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
| Admin | `http://localhost:3000/admin` | lancer, mettre en pause ou arrêter une partie, aller à une manche, accélérer le temps (x1, x2, x3, pour les tests), régler, bots de test (classe et niveau au choix), comptes (donner de l'XP, des Grêlons ou des glaçons) |

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
- **Soutien Twitch.** Un abonnement (Prime compris, réabonnements inclus) rapporte **300 Grêlons** au compte lié, et chaque abonnement offert rapporte **300 Grêlons** à celui qui l'offre (palier 2 : ×2, palier 3 : ×5 ; montants réglables dans l'admin). L'événement est annoncé sur le stream. Si le compte Twitch n'est pas encore lié, les Grêlons sont mis de côté et versés à la liaison (`!lier CODE`). L'admin peut simuler un abonnement, un Prime ou des abonnements offerts pour tester.
- **Stats figées et récompenses de fin de partie.** Dès qu'un joueur rejoint une bataille, la classe, les statistiques, les compétences, l'équipement et l'habitation de son héros sont figés jusqu'à la fin de la partie ; l'apparence et l'IA restent modifiables. **Un héros ne peut pas quitter une bataille.** **Un héros mort ne réapparaît pas** : seul un vote d'équipe « 💖 Résurrection », proposé quand il y a au moins un mort, réanime un héros mort tiré au hasard à 60 % de ses PV max. Elle coûte des baies 🫐, de plus en plus à chaque utilisation. L'ultime du nécromancien peut aussi relever un allié, et l'amélioration **Sanctuaire des âmes** de la tour de soin réanime un héros mort à chaque fin de manche (deux au niveau 2). Un héros mort continue de gagner les récompenses de chaque manche jusqu'à la fin de la partie. Toutes les récompenses (XP, Grêlons, glaçons) sont versées à la fin de la partie, avec un récapitulatif sur le stream (tous les héros, dont leur récolte 🪨 🪵 🫐) et sur la page joueur (fenêtre personnelle). L'écran de fin reste affiché sur le stream **jusqu'à ce qu'un admin le valide** (bouton « ✅ Valider l’écran de fin » dans l'admin) ; on revient alors à l'attente, ou une nouvelle partie démarre si l'option de relance est cochée. Elles sont aussi enregistrées au fur et à mesure : si le serveur redémarre en pleine partie, elles sont versées au redémarrage.
- **Mode défense de tour.** Les monstres arrivent de tous les bords. La tour commence avec **200 PV** ; si elle tombe, la partie est perdue. Il y a 100 manches.
- **Arbre de compétences (onglet « Classe & compétences »).** Un arbre en étoile, visible en entier à tout moment (y compris les effets de tous les ultimes), avec un zoom (−, Ajuster, +) :
  - **Centre : le Paysan**, les 6 classes tout autour et leurs sous-branches qui rayonnent vers l'extérieur, l'ultime au bout. Tout le monde commence Paysan ; la compétence « Courage du paysan » (3 rangs) est toujours disponible.
  - **Une branche par classe** (dès le niveau 7) : le premier point placé dans l'initiation d'une classe fait devenir cette classe.
  - **Une sous-branche par spécialisation** : quand l'initiation est à 3/3, le premier point placé dans une sous-branche fait devenir la spécialisation. Elle contient 5 compétences propres à la classe (3 rangs chacune, aucune n'accélère l'ultime), l'**ultime (niveau 30)**, qui doit être débloqué pour être utilisé en bataille, puis **2 compétences qui améliorent l'ultime** (puissance, zone, durée, nombre de cibles…).
  - **Pour débloquer une compétence, il faut au moins 2 points dans la précédente** (l'ultime suffit pour les compétences d'après-ultime).
  - **Invocations** (Dompteur, Fauconnier, Nécromancien) : certains nœuds de la sous-branche débloquent une créature : **1 au rang 1, une 2e au rang 3**, et chaque rang la rend plus forte (+20 % de PV et de dégâts). L'invocateur appelle une créature **toutes les 10 s** jusqu'à son quota, et **5 s** après la mort d'une invocation. Dompteur : rat (60 % des dégâts du héros + poison 2 s), loup (100 %, 1,5× plus rapide), ours (200 %, 0,9× la vitesse du héros). Fauconnier : pigeon (50 %, 1,5× plus rapide), aigle (marque un ennemi toutes les 5 s : +100 % de dégâts reçus pendant 3 s), faucon (150 %). Nécromancien : slime (300 % des PV du héros, 75 % des dégâts, ralentit 2 s), zombie (90 % des PV, 110 % des dégâts), squelette archer (1,1× la vitesse d'attaque du héros, 1,2× ses chances de critique). **6 invocations au plus**, jusqu'à **9** avec la compétence d'après-ultime (Horde, Volée, Armée des morts).
  - Dès qu'un point est placé dans une branche, **les autres sont grisées**. Cliquer sur une pastille affiche son effet et permet d'y placer un point.
  - On gagne 1 point de compétence tous les 2 niveaux.
  - La reconversion (après un message d'avertissement) remet l'arbre à zéro et ramène le joueur au centre ; il perd définitivement un quart des points attribués.
  - Les anciens Paysans (classe de récolte supprimée), Agriculteurs, Bûcherons et Mineurs sont revenus au centre sans aucune perte : points rendus, améliorations d'habitation et objets du set Moisson remboursés en Grêlons.
- **Habitations.** Chaque héros a la sienne, du type de sa classe, dans la limite de **5 par classe** (réglable). Au-delà, le joueur partage l'habitation la moins occupée de sa classe, et leurs **PV fusionnent** : 100 PV par occupant. Quand une place se libère, un occupant récupère sa propre habitation. Les habitations sont placées tout près de la tour, au hasard, classes mélangées, y compris au nord (la tour peut les cacher en partie). Les habitations de soutien (**Ferme** du paysan, **Mine** du mineur, **Scierie** du bûcheron, chaumière de l'habitant) occupent l'anneau le plus proche de la tour ; les autres se placent juste derrière. Les monstres frappent celles qui se trouvent sur leur trajet vers la tour. Pendant l'entracte, chaque héros rentre se soigner dans la sienne, ce qui devient impossible si elle est détruite. Sur le stream, les bâtiments, la tour et les remparts **se dégradent** avec leurs PV : fissures (moins de 85 %), puis suie, gravats et fumée (moins de 60 %), puis incendie, fumée noire et braises (moins de 35 %), brasier sous 15 % (pas de feu sur les remparts de pierre) ; chaque coup encaissé les fait trembler et soulève de la poussière, et les ruines continuent de rougeoyer.
- **Amélioration de bâtiment** (onglet dédié, achats en Grêlons, conservés d'une partie à l'autre) :
  - *Murs renforcés* : +12 % de PV par niveau. Quand une habitation est partagée, les PV des occupants s'additionnent.
  - *Lits douillets* : +10 % de puissance de soin par niveau. Une habitation partagée applique la **moyenne** des occupants, pas un double soin.
  - Une amélioration **spéciale par classe** :

    | Classe | Amélioration | Effet |
    |---|---|---|
    | Paysan (centre de l'arbre) | Foyer | plus d'XP |
    | Mage | Bibliothèque | charge de l'ultime plus rapide |
    | Éleveur | Enclos | invocations plus fortes |
    | Archer | Vigie | la tour de guet tire sur les ennemis proches |
    | Assassin | Pièges | les ennemis proches du repaire sont ralentis |
    | Soldat | Râtelier | plus de défense |

    Pour les effets de bâtiment (Vigie, Pièges), c'est le meilleur niveau des occupants qui compte.
  - Une **reconversion** remet ces améliorations à zéro et rembourse 75 % des Grêlons dépensés.
  - Coûts et effets se règlent dans `shared/constants.js` (`HOUSE_UPGRADES`, `HOUSE_SPECIALS`).
- **Zones de biome.** À chaque manche, de petites zones apparaissent au hasard, sur des tuiles du biome correspondant et sans se chevaucher : glace (ralentit les héros), poison (−1 % des PV max toutes les 3 s), lave (−1 % toutes les 2 s). Pendant les manches 91 à 100, les trois types coexistent. Tout se règle dans `shared/constants.js` (`BALANCE`).
- **Adaptation au nombre de joueurs.** La puissance des monstres (PV et dégâts), leur nombre et la durée des manches augmentent avec le nombre de héros, de façon légèrement plus que proportionnelle (`HERO_SCALE_EXP`) mais moins vite que la force de l'équipe : une grande équipe va plus loin, et une partie complète dure un peu plus longtemps (environ 44 min à 5 joueurs, 47 à 51 min à 10 joueurs).
- **Niveaux et statistiques.** Le niveau maximum est **100**. Monter de niveau n'augmente pas les statistiques. Chaque niveau rapporte **1 point de stat** (Vie, Force, Défense, Agilité, Vitesse, Critique), réinitialisable gratuitement, et **1 glaçon**. Seuls les points de stat et l'équipement renforcent un héros. Les comptes existants ont reçu rétroactivement 1 glaçon par niveau déjà gagné.
- **Passifs.** Chaque classe (sauf le Paysan) a un passif, affiché dans les infobulles de l'arbre : Soldat **Garde** (−10 % de dégâts reçus pour les héros proches), Paladin **Parade sacrée** (15 % de chances d'annuler une attaque et de se soigner de 5 %), Chevalier **Élan** (premier coup après une course : 200 % et renversement), Mage **Orbe instable** (une attaque sur 5 explose en zone), Archer **Tir perçant** (flèches qui traversent 2 monstres), Arbalétrier **Carreau lourd** (recul de 25 px), Arc long **Tir de loin** (jusqu'à +25 % de dégâts selon la distance), Assassin **Coup dans le dos** (+50 % sur un monstre qui attaque quelqu'un d'autre, ou qui est ralenti, gelé ou marqué), plus ceux des autres classes (rage, givre, brûlure, soins, pièges, invisibilité, poison, dash, aura…).
- **Classes évolutives.** Tout le monde commence *Paysan*, puis devient une classe et une spécialisation, qui donne un **ultime** :
  - Soldat → Paladin (tourbillon en cercle) / Barbare (plus fort quand il est blessé, vol de vie ; Frénésie : +50 % de vitesse d'attaque, ne tombe pas sous 1 PV pendant 8 s) / Chevalier (monte à cheval, +16 % de vitesse, une fois l'ultime débloqué ; charge à 200 %)
  - Mage → Glace (Vague de froid : cône à 150 % des dégâts + gel) / Feu (Boule de feu : 300 % des dégâts de base en zone) / Soin (Bénédiction : soigne tous les alliés de 75 % de leurs PV max)
  - Éleveur → Dompteur (nœuds Rats, Loups, Ours ; Cri de la meute : soigne ses bêtes et +50 % de dégâts pendant 10 s) / Fauconnier (nœuds Pigeons, Aigle, qui marque les ennemis, puis Faucons ; Nuée de rapaces : ses oiseaux sont soignés, foncent sur les ennemis proches, les aveuglent définitivement et font +50 % de dégâts pendant 5 s) / Nécromancien (nœuds Slimes, Zombies, Squelettes archers, qu'il invoque ; Relève-toi : ramène un allié mort à 60 % de ses PV)
  - Archer → Arbalétrier (cadence ×3) / Trappeur (pièges à mâchoires qui immobilisent ; Champ de ronces qui ralentit de 60 %, sans dégâts) / Arc long (3 flèches perforantes à 150 %)
  - Assassin → Ombre (invisible toutes les 10 s, écran de fumée) / Alchimiste (fioles empoisonnées cumulables, renforcées contre les boss ; Pluie d'acide) / Flèche (dash critique toutes les 6 s, dash en chaîne, 5 fois au plus)
  - Ménestrel (notes qui traversent les monstres, aura +8 % de vitesse d'attaque aux héros proches ; habitation : Taverne) → Troubadour (Hymne de bravoure : +30 % de dégâts et +20 % de vitesse d'attaque à tous pendant 8 s) / Tambour de guerre (ondes de choc qui étourdissent ; Roulement de tonnerre autour de lui : 300 % des dégâts et étourdissement) / Enchanteresse (charme les monstres ; Chant envoûtant : 6 monstres combattent pour l'équipe pendant 10 s, les boss sont seulement étourdis)
- **Personnalisation (onglet 🎨).** Chaque joueur règle son héros en pixel art : couleur de peau (10 teintes, dont orange, rouge, bleu, vert et violet), coiffure (5 styles) et couleur des cheveux, yeux, nez et bouche (5 choix chacun), couleur de cape. Chaque choix est illustré par une vignette du visage ; c'est enregistré aussitôt et visible sur le stream, même en pleine bataille.
- **IA personnalisable.** Le joueur règle la posture (dont **« Garde de son habitation »** : le héros reste près de sa maison et n'attaque que les monstres qui s'en approchent), la cible prioritaire et l'usage de l'ultime (les héros ne battent plus en retraite vers la tour). La posture **« Priorité à la récolte »** envoie le héros aux points de récolte sûrs (aucun monstre autour) : il ne se bat que pour se défendre (il ne fuit pas, même blessé) et, comme les autres, rentre se soigner à son habitation pendant l'entracte (pas de récolte pendant l'entracte). Les changements s'appliquent en direct.
- **Grêlons** : monnaie personnelle, gagnée en combattant (et dans les mini-jeux) et conservée entre les parties. Elle sert à acheter des glaçons, et le recyclage d'objets en rapporte. (Les écus n'existent plus.)
- **Ressources : 🪨 pierre, 🪵 bois, 🫐 baies.**
  - **En défense de tour (réserve d'équipe de la partie)** : au début de chaque partie, des **rochers** (pierre), **arbres au feuillage d'automne** marqués d'une entaille avec un tas de bûches (bois) et **buissons de baies** (baies) — chacun entouré d'un halo coloré, avec une pastille de sa ressource au-dessus et une jauge quand il est entamé — apparaissent au hasard autour du village (10 de chaque, 110 à 180 ressources chacun). Tout héros à moins de 70 px d'un point en récolte automatiquement pendant les manches (pas pendant l'entracte ; 1,5 ressource/s, plus avec les améliorations « Récolteur ») ; le point rétrécit puis disparaît (souche, cailloux, buisson nu). L'équipe commence avec 30 de chaque. La réserve s'affiche en haut à gauche du stream et sert aux votes.
  - **Coût des améliorations** : la ressource principale de la tour (**bois** pour l'attaque, **pierre** pour la défense, **baies** pour le soin) + **1/3** d'une autre ressource ; la **tour de mage** demande deux ressources à peu près égales. La Résurrection coûte des baies ; le Pacte de sang et la Vitalité de la nature sont gratuits.
  - **🌱 Vitalité de la nature** : proposée au hasard (40 %) à la place du Pacte de sang quand la carte a été entamée ; chaque point de récolte récupère 30 % de ses ressources.
  - **Dans les mini-jeux (réserve du compte)** : voir ci-dessous ; elles achètent les améliorations des mini-jeux et les trois « Récolteur » (une par ressource).
- **Glaçons 🧊 (coffres).**
  - **📜 Parchemin de mémoire** : environ 3 % des glaçons contiennent un parchemin au lieu d'une pièce d'équipement. Utilisé depuis l'inventaire, il rend 1 point de compétence perdu en reconversion. Il se vend, s'échange et se recycle comme un objet épique.
  - On gagne 1 glaçon par boss vaincu (3 aux manches 95 et 100, qui ont trois boss), ou on l'achète 75 Grêlons.
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
  - Un set par famille de classes (5 pièces, arme comprise) : Rempart (soldat), Arcaniste (mage), Maître-bête (éleveur), Œil-de-faucon (archer), Lame-nuit (assassin), Barde (ménestrel).
  - Trois sets universels (5 pièces, arme comprise), portables par toutes les classes : Voyageur, Givre éternel, Braise. Leur arme prend la forme de l’arme de la classe qui la porte (un peu moins forte qu’une arme de classe).
  - Le Paysan a ses propres armes, sans armure : Gourdin du Milicien (+PV) et Gourdin du Pèlerin (+vitesse).
  - Porter 2, 4 ou 5 pièces d'un même set donne des bonus. Tout le détail est dans l'onglet **📜 Règles** du site.
- **Durée d'une partie.** Une partie classique gagnée jusqu'à la manche 100 dure environ **45 minutes** (au plus une heure), une partie rapide gagnée environ 12 à 15 minutes : l'apparition des monstres est courte (8 s + 0,05 s par manche + environ 0,4 s par héros, 30 s au plus), l'entracte entre deux manches dure 4 s et la préparation avant la manche 1 dure 15 s (réglages dans l'admin et dans `BALANCE.WAVE_DURATION_*`).
- **Votes d'équipe et spécialisation de la tour.** Toutes les **2 manches** en classique (réglable dans l'admin), **à chaque manche** en partie rapide. Le vote a lieu **pendant la manche et l'entracte qui suit** (page joueur ou `!1`, `!2`… dans le chat) : l'option gagnante est appliquée **au début de la manche suivante**.
  - **Premier vote : la spécialisation de la tour** (gratuit) parmi **⚔️ Attaque**, **🛡️ Défense**, **💚 Soin** et **🔮 Mage** ; la tour change complètement d'apparence : **fort de bois** avec une grande baliste qui pivote vers les monstres (attaque), **citadelle de granit** avec une sentinelle qui patrouille (défense), **moulin-infirmerie** dont les ailes tournent plus vite pendant le soin d'entracte (soin), **tour du sorcier** biscornue avec des livres volants et un orbe par sort de la tour (mage). Sans aucun vote, elle est tirée au hasard.
  - **Votes suivants : 3 choix** — 2 des 8 améliorations de cette tour et un 3e choix : le **Pacte de sang** (manche plus dure, récompenses ×2), remplacé par la **Résurrection** s'il y a un héros mort (même en cours de vote), sinon parfois par **🌱 Vitalité de la nature**. Le choix « Économiser » a disparu : **si personne ne vote, un choix est tiré au hasard** (parmi ceux que l'équipe peut payer).
  - **Attaque** : grande arbalète (cible unique, boss et élites d'abord), cadence, précision contre les boss, marque ; gros bonus pour les héros (dégâts, vitesse d'attaque, critique, coup de grâce).
  - **Défense** : 4 **remparts** (nord, sud, est, ouest) autour des habitations — de vrais murs avec des PV que les monstres de corps à corps doivent casser (les héros les traversent, les tireurs visent par-dessus, les angles restent ouverts sauf tour d’angle ; réparés de 5 % de leurs PV à chaque entracte) —, pierre taillée (PV des remparts, et une **tour d’angle** solide entre deux remparts voisins, qui ferme le passage), pieux, armurerie (défense des héros), donjon renforcé (PV de la tour).
  - **Soin** : fontaine de vie (soin d'entracte jusqu'à 75 %), **murets** tout autour des habitations, murets bénis (petit soin à côté, après déblocage), vigueur, régénération, vol de vie, purification, sanctuaire des âmes (réanimation en fin de manche).
  - **Mage** : boule de feu, nova de givre, chaîne d'éclairs, pluie de météores, amplification et canalisation des sorts, hâte et concentration (charge d'ultime) des héros.
  - **Soin d'entracte** : à chaque fin de manche, la tour soigne les héros de **10 %** de leurs PV max (**75 %** avec une tour de soin au maximum). La tour ne soigne plus en continu les héros proches.

### Mini-jeux (onglet 🎲)

Trois expéditions solo **en temps réel, vues du dessus** : on dirige son héros de salle en salle, on récolte, on se bat, et on rapporte ce qu'on peut au **compte** du joueur.

| Mini-jeu | Ressource | Butins des monstres | Contenant | Sortie | Décors (un nouveau toutes les 10 salles, 6 sous-décors chacun) |
|---|---|---|---|---|---|
| ⛏️ Exploration de la caverne | 🪨 pierre | 🦴 os, 💠 éclat de cristal, 🔮 cœur d'obsidienne (rare) | 🪣 seau | une **cavité** qui s'ouvre n'importe où au sol | Galeries de terre · Cavernes de cristal · Profondeurs de magma |
| 🌲 Visite de la forêt | 🪵 bois | 🐾 peau de bête, 🦷 croc, 💀 crâne maudit (rare) | 🛒 charrette | une **ouverture** sur un côté | Sous-bois · Forêt profonde · Bois maudit |
| 🫐 Récolte de la clairière | 🫐 baies | 🪶 plume, 🐚 écaille, 🔥 braise de feu follet (rare) | 🛒 charrette | une **ouverture** sur un côté | Champs ensoleillés · Collines sauvages · Vallée crépusculaire |

- **Énergie** : une expédition coûte 1 ⚡ ; on regagne 1 énergie toutes les **6 h**, **3** au plus. L'admin peut en donner (onglet Joueurs, bouton « + Énergie ⚡ », jusqu'à 99 pour les tests).
- **Commandes** : **ZQSD** ou flèches pour bouger · **Maj** (maintenue) : **sprint** (vitesse ×1,5) tant qu'il reste de l'**endurance** (jauge de 100, vidée en 3 s environ, qui remonte après une courte pause) · **clic gauche** (maintenu) : attaquer **vers la souris** — et **récolter** si l'on vise un point de récolte (même touche) · **clic droit** (maintenu) : **bouclier** · **E** : compétence de classe · **A** : potion (35 % des PV ; 2 par expédition) · **Espace** : **roulade** — un bond rapide (dans la direction du déplacement, ou vers la souris), puis **1 s d'invulnérabilité** (anneau lumineux autour du héros) ; elle coûte **50 d'endurance**, qui ne remonte pas pendant l'invulnérabilité (repère sur la jauge, affichée juste sous le bouclier) · **F** : ouvrir le seau / la charrette quand on est à côté · **Échap** : pause (et rappel des commandes). Sur **téléphone** : joystick et boutons ⚔️ (cible la plus proche), 🔰, 🏃 (sprint), 🤸 (roulade), ✨, 🧪, 🛒 sous la scène ; toucher la scène attaque aussi vers ce point. Bouton ⛶ pour le plein écran. Un mini-tutoriel s'affiche à la première expédition.
- **Combat** : selon la classe, coups d'arme en arc devant le héros (corps à corps) ou tirs / sorts vers la souris (classes à distance : 60 % des dégâts d'un coup d'arme, en échange de la sécurité). Compétence (toutes les 6 s) : **tourbillon** autour du héros, **volée** de 3 projectiles, ou **explosion** là où l'on vise (mages, ménestrels). Les monstres attendent dans la salle, se réveillent quand on approche et **préparent** leurs coups (« ! » rouge au-dessus de leur tête).
- **Bouclier** : levé, il encaisse les coups avec ses **points** (20, plus avec l'amélioration ; le héros ralentit et n'attaque pas). Levé **juste avant** un coup (0,22 s), c'est une **parade parfaite** : aucun dégât, et le coup est **renvoyé** au monstre (les projectiles repartent vers les monstres). Vide, il se **brise** 2 s, puis se recharge doucement.
- **Salles** (sans limite) : points de récolte et monstres générés au hasard (propres à chaque mode). Chaque salle commence avec **3 monstres** (hors salles de repos, d'élite et de gardien), **un de plus toutes les 6 salles** (8 au plus, dès la salle 31), qui **foncent sur le héros** dès le début. La **sortie apparaît au bout de 10 s** ; **20 s après l'entrée dans la salle** (+2 s par monstre de départ en plus, 30 s au plus en profondeur), des **renforts** arrivent **toutes les 5 s** (ils ne lâchent jamais de butin ; **aucun renfort** dans les salles d'élite et de gardien), donc on ne traîne pas. Le **type de salle** s'affiche avec son numéro :
  - 🗡️ **Salle** normale ; 🌟 **Salle riche** (≈ 12 %) : beaucoup de points de récolte, sortie à 20 s ; ⛲ **Salle de repos** (≈ 6 %) : une fontaine qui soigne **10 PV/s pendant 3 s** au total (elle se vide), pas de monstre ;
  - ⚔️ **Élite** toutes les **5** salles et 👑 **Gardien de zone** toutes les **10** (araignée reine, loup alpha, crapaud roi… avec onde de choc, charge, salve ou invocation, annoncées au sol) : la sortie ne s'ouvre qu'une fois vaincus, puis **3 récompenses au choix** : +20 % de dégâts, +20 % de PV, +10 % de critique (pour l'expédition), soin complet, trésor (un tas de ressources à ramasser), Grêlons (gardés même en cas de mort), potion — ou, **10 %** du temps, un **🥚 œuf** de familier.
- **Récolte** : chaque coup sur un point de récolte (rocher, arbre, buisson) rapporte 2 ressources ; les points sont **rares et petits** au départ (3-4 par salle, 3 ressources + 0,3 par salle) et c'est avec « Flair » et « Gros butin » au maximum qu'on en trouve 4-6 par salle, deux fois plus gros. Plus on descend, plus ils grossissent. Points **dorés** avec « Coup de chance ».
- **Sac** : **5 cases** (+5 par niveau, 30 au maximum) ; **une case = 15 ressources ou 1 butin de monstre**. Au niveau maximum, une **poche sécurisée** garde ses 5 cases les plus précieuses même si le héros tombe. Sac plein : on ne récolte et ne ramasse plus rien.
- **Seau / charrette** : **10 cases** (+10 par niveau, 60 au maximum) ; il ou elle **attend à un endroit fixe, tiré au hasard, de chaque salle** (il faut aller jusqu'à lui ou elle) et passe de salle en salle avec son contenu. À côté, **F** ouvre son panneau (le jeu **ralentit** en arrière-plan) : déposer une case du sac (clic) ou **tout déposer**, **🚚 Renvoyer** (son contenu est **à l'abri** à la base, et il ou elle revient **2 salles plus tard** ; allers-retours illimités, vitesse non améliorable) ou **🏠 Rentrer** (fin de l'expédition, tout est mis à l'abri ; seulement une fois les **monstres de départ de la salle éliminés**). Une **petite torche** est plantée à côté pour le repérer (elle éclaire aussi dans l'obscurité de la caverne). Sinon, il ou elle continue de suivre avec son contenu.
- **Mort** : **tout ce qui n'a pas été renvoyé est perdu** — butins du sac et contenu du seau non renvoyé compris — **sauf 25 % des ressources du sac** (et la poche sécurisée). L'XP est gardée.
- **Monstres** : **3 par décor**, et chacun n'existe que dans **une seule zone**, donc chaque œuf donne des familiers différents selon l'endroit (les 10 marqués d'un * sont propres aux mini-jeux) :

  | Mini-jeu | Décor 1 | Décor 2 | Décor 3 |
  |---|---|---|---|
  | ⛏️ Caverne | gobelin, araignée, gelée des cavernes* | golem de glace, esprit du givre, araignée de cristal* (tire) | chien infernal, élémentaire de feu, sentinelle d'obsidienne* |
  | 🌲 Forêt | loup, sanglier, renard* | loup des neiges, arbre déraciné, ours noir* | mutant, champignon explosif, squelette archer maudit* (tire) |
  | 🫐 Clairière | corbeau*, gobelin archer (tire), mulot* | crapaud toxique (tire), rampant putride, lièvre* | diablotin, salamandre (tire), feu follet* (tire) |

  Les monstres de la salle peuvent lâcher un butin (jamais les renforts ni les invocations des gardiens) : un sur cinq lâche un butin commun ; une élite en lâche 2 (+ le rare 25 % du temps) ; un gardien, le butin rare et 3 communs. Les élites (10 %) et les gardiens (25 %) lâchent aussi parfois une **🧴 potion de familier**. Les monstres des mini-jeux frappent fort (+30 % de dégâts) et vite.
- **Statistiques d'expédition** : dans les mini-jeux, le héros n'utilise **pas** ses statistiques de bataille mais des statistiques propres (100 PV, 10 dégâts, 0 % d'armure, 5 % de critique, bouclier de 20), améliorées dans « Améliorations générales » avec les ressources du compte : ❤️ Vitalité (+15 PV, baies), ⚔️ Force (+2 dégâts, bois), 🛡️ Armure (+3 %, pierre), 🎯 Précision (+2 % de critique, bois), 🔰 Bouclier (+10 points, pierre) ; et avec les **butins des monstres** : 👟 Vitesse (+10 de vitesse de déplacement, 150 → 200), 🏃 Endurance (+25 d'endurance pour le sprint, 100 → 225) et ⚡ Vitesse d'attaque (+8 % par niveau, attaques et récolte, jusqu'à +40 %), 5 niveaux chacune.
- **Améliorations** : **🎒 Sac** et **🛒 Seau / charrette** (5 niveaux chacun) se paient avec les **butins des monstres** des trois zones (par ex. sac niveau 1 : 5 os + 5 peaux) ; par mini-jeu, avec sa ressource : **Flair** (+8 % de points de récolte), **Gros butin** (+15 % de ressources par point), **Coup de chance** (+4 % de points dorés, ×1,5) et **Fortune** (le point doré monte de ×1,5 à ×3) ; **Sacoche de potions** (+1 potion) ; trois **Récolteur** — pierre, bois, baies — (+10 % de récolte de cette ressource en défense de tour). Tout maximiser demande environ 36 000 de chaque ressource (une à trois semaines de jeu régulier).
- **Ambiances bien distinctes** : la **forêt** est sombre et fermée (deux rangées d'arbres serrés, ombre des feuillages, rayons de soleil, mousse, fougères, champignons, sortie par un chemin de terre) ; la **clairière** est claire et dorée (pré tondu en bandes, blé, fleurs partout, haie fleurie et **clôture en bois**, sortie par un portail ouvert, papillons).
- **Graphismes** : sol en pixel art tramé avec cailloux, fissures, herbe et fleurs ; murs en relief avec ombres ; **éclairage** (la caverne est sombre, la torche du héros éclaire autour de lui ; vignette colorée dehors, plus sombre dans le bois maudit et la vallée crépusculaire) ; particules d'ambiance (poussière, éclats de cristal, braises, feuilles qui tombent, lucioles, pollen, papillons).
- **Record** de profondeur par mini-jeu, affiché sur la carte du mini-jeu ; l'écran de fin résume ce qui a été mis à l'abri et ce qui a été perdu.
- **Sons** (synthétisés dans le navigateur, aucun fichier) : pioche « tink » sur la pierre, coups de hache, « pop » des baies, éclats qui volent ; coups, critiques, parade, bouclier brisé, ramassage, sac plein, ouverture de la sortie, renforts, onde de choc ; une **petite musique** différente par mini-jeu. **Réglages du son** en haut de l'onglet (🔊/🔇, volumes de la musique et des effets, retenus dans le navigateur).
- **🐾 Familiers** (2 actifs au plus par expédition) : ils **suivent le héros** et se battent seuls (morsure, poison, frappe de zone…) ; l'écureuil et le mulot **récoltent seuls** les points proches, l'ours porteur ajoute des **cases de sac**. Les monstres ont **20 %** de chances de viser un familier plutôt que le héros (plus avec la provocation ; un familier à distance n'est visé que par les monstres qui tirent).
  - **Chenil** : 6 animaux à adopter pour **750 Grêlons** chacun (le prix de 10 glaçons), une fois chacun : 🐺 Loup (morsure : 25 % des dégâts du héros), 🐢 Tortue (absorbe 70 % du 1er coup de chaque salle), 🐰 Lapin (soigne 3 % des PV max toutes les 4 s), 🦅 Faucon (marque : +15 % de dégâts subis), 🐿️ Écureuil (+10 % de ressources, récolte seul), 🐻 Ours porteur (+3 cases de sac).
  - **Œufs** : une élite ou un gardien vaincu propose **10 %** du temps un « 🥚 Œuf mystérieux » parmi ses 3 récompenses. Il est gardé même si le héros tombe et **éclot 30 minutes plus tard** (section « Œufs en incubation » de l'onglet, compte à rebours puis bouton « 🐣 Faire éclore ») : un **monstre de la zone** (mini-jeu et décor où l'œuf a été trouvé) avec une **rareté** (comme les glaçons : commune = puissance du chenil, puis ×1,25 … ×3,2) et des effets propres : poison, brûlure, gel, étourdissement, affaiblissement, frappe de zone, provocation, attaque à distance, garde, soin… En **double**, il fait passer ton familier à la meilleure rareté, sinon il est converti en ressources de la zone (5 / 8 / 12 / 17 / 23 / 30 selon la rareté).
  - **🧴 Potion de familier** (butin rare des élites et des gardiens, rapportée comme les autres butins) : au camp, le bouton « Soigner » d'un familier blessé la consomme et lui rend **tous ses PV**, même K.-O. (fin du repos). Pas pendant une expédition.
  - **PV** propres à chaque espèce (l'ours en a bien plus que l'écureuil). Ils **ne sont pas remis à neuf** entre deux expéditions : ils remontent avec le temps (10 % des PV max par heure). Un familier **K.-O.** se repose jusqu'à **50 %** de ses PV avant de pouvoir repartir.
  - **XP** à chaque expédition (niveau 20 au plus) ; **évolutions purement esthétiques** aux niveaux 10 (étincelles) et 20 (aura et couronne dorées).
  - **Familier principal** (niveau 10 minimum) : il suit le héros en miniature sur le stream pendant la défense de tour, purement pour le style.
  - Pas de vente ni d'échange de familiers. L'admin peut donner un œuf pour tester (onglet Joueurs, bouton « 🥚 Œuf » : prêt à éclore tout de suite, ou avec l'incubation en ajoutant « :incuber »).
- **Fonctionnement** : la salle est générée à l'identique côté serveur et côté page à partir d'une graine ; la page simule la salle en temps réel (`shared/expedition.js`) et envoie des rapports (monstres tués, récoltes, ramassages, PV) que le serveur **valide** (ce que la salle contient, la place dans le sac) ; le serveur garde l'inventaire, le seau et ce qui est à l'abri. On peut fermer la page et reprendre l'expédition plus tard (au début de la salle en cours). Les anciennes expéditions au tour par tour en cours sont abandonnées et leur énergie rendue. Équilibrage : `npm run sim:minijeux` (un bot joue des expéditions complètes).

### Modes et difficultés

L'admin choisit le mode et la difficulté au lancement de chaque partie.

| Mode | Manches | Particularités | Récompenses |
|---|---|---|---|
| Classique | 100 | le terrain change après chaque boss (toutes les 5 manches) | ×1 |
| ⚡ Partie rapide | 35 | 4 ères de 10-10-10-5 (givre, corruption, feu, chaos) ; le terrain se corrompt à **chaque manche** ; **vote d'équipe à chaque manche** ; **1 zone dangereuse max** ; mêmes événements et boss aux manches 5, 10 (déracinement + Tréant colossal), 15, 20 (Mère-Spore), 25, 30 (Géant de magma) et 35 (les trois), mais la **puissance de la manche n est celle de la manche n du classique** : les boss sont ramenés à la force du boss classique de leur manche, et le trio final est allégé | ×0,85 |

| Difficulté | PV monstres | Dégâts | Nombre | Récompenses (XP, Grêlons) |
|---|---|---|---|---|
| 🟢 Facile | ×0,7 | ×0,75 | ×0,85 | ×0,7 |
| 🟡 Normal | ×1 | ×1 | ×1 | ×1 |
| 🔴 Difficile | ×1,45 | ×1,3 | ×1,2 | ×1,4 |

Les difficultés s'appliquent aussi à la partie rapide, et leurs effets se multiplient (partie rapide en facile : récompenses ×0,6). Tous ces multiplicateurs se règlent dans `shared/constants.js` (`MODES`, `DIFFICULTIES`).

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
  twitch.js         lecture du chat Twitch (!join, !lier, votes)
  db.js             stockage JSON (écriture atomique)
  game/engine.js    boucle de jeu autoritaire (20 Hz), manches, votes, réseau
  game/heroes.js    IA des héros, passifs, ultimes, invocations
  game/mobs.js      vagues, IA des monstres, capacités des boss
shared/             partagé serveur ↔ navigateur
  constants.js      classes, armures, monstres, boss, palette graphique
  terrain.js        génération déterministe du terrain et des biomes
  expedition.js     mini-jeux : salles (graine), sac / seau, simulation temps réel (page + bot)
public/
  js/art.js         toute la direction artistique (un seul module de dessin)
  js/sprites.js     sprites pixel art des monstres (GÉNÉRÉ par tools/pixelart)
  js/stream.js      écran du stream    js/player.js  page joueur    js/admin.js  admin
  js/mini.js        onglet Mini-jeux (jeu vu du dessus, commandes, panneaux)   js/minidecor.js  décors des salles
test/               tests du moteur (npm test)
tools/pixelart/     sources des sprites pixel art des monstres (Python + Pillow)
tools/sim/          simulations sans serveur (durée des parties, économie, équilibrage des classes, invocations)
tools/captures.js   captures d'écran automatiques du stream et de la page joueur (Playwright)
```

### Graphismes

- **Rendu** (`/stream`) : **héros en pixel art** assemblés à la volée (visage personnalisé, équipement selon le style et la rareté, arme de classe, marche et attaque), tour en pierre avec bannières et torches, habitations en vue 3/4, **monstres en pixel art** dessinés pixel par pixel. Les monstres, la tour et les bâtiments sont pré-rendus en cache par étape d'animation, ce qui garde le stream fluide même avec des centaines de monstres.
- **Vérifier un changement** : `npm run sim:duree` (durée des parties), `npm run sim:economie` (ressources), `npm run sim:minijeux` (expéditions), `npm run sim:classes` (équilibrage), `npm run sim:invocations` ; `npm run captures -- stream` ou `npm run captures -- joueur --onglet=hero` produit des captures dans `captures/` (Playwright requis).
- **Modifier un monstre** : les sprites sont décrits dans `tools/pixelart/` (`gob.py`, `s_beasts.py`, `s_giants.py`, `s_corrupt.py`, `s_inferno.py`, `s_casters.py`). `python3 build.py wolf,golem apercu.png` produit une planche d'aperçu, `python3 export.py` régénère `public/js/sprites.js`. Les variantes de couleur (loup des neiges, golem d'obsidienne…) sont des palettes dans les mêmes fichiers.

**Cohérence graphique.** Toutes les couleurs viennent de `GameData.PALETTE`, et tous les dessins passent par `public/js/art.js`. Le style est le même partout : aplats, contour sombre unique, ombre portée et proportions « chibi ». Le stream, les aperçus de la page joueur et la boutique utilisent les mêmes fonctions de dessin.

L'équilibrage (PV, dégâts, mise à l'échelle par manche et par nombre de joueurs) se règle dans `shared/constants.js` et `server/game/mobs.js` (`scaling`). En cours de partie, l'admin dispose aussi d'un multiplicateur de difficulté.
