# LoPOS frontend — POS online

Socle React, TypeScript et Vite du POS, avec authentification par session Django,
restauration de l'utilisateur courant, guards de session et ouverture de caisse.
La page POS reste volontairement une coquille jusqu'à l'étape 6.

## Démarrage

Depuis la racine du projet, démarrer Django sur le port 8000, puis :

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

En développement, `VITE_API_BASE_URL=/api/v1` conserve les appels sur l'origine
Vite. Le proxy défini dans `vite.config.ts` les transmet à
`http://localhost:8000`, ce qui évite une configuration CORS et permet aux
cookies de session Django de fonctionner.

Commandes de vérification :

```bash
npm test
npm run build
```

## Contrats backend constatés

- toutes les routes API exigent une session Django authentifiée ; un accès
  anonyme produit un `403` DRF ;
- `GET /api/v1/auth/csrf/` émet `csrftoken` ;
- `POST /api/v1/auth/login/` accepte `{ username, password }`, crée la session
  Django et retourne l'utilisateur JSON ;
- `POST /api/v1/auth/logout/` détruit la session ;
- `GET /api/v1/auth/me/` retourne l'utilisateur courant ou `403` ;
- les listes `stores`, `cash-registers` et `products` sont des tableaux JSON non
  paginés ;
- `GET /products/` accepte `search`, `barcode` et `store_id`, mais le champ
  `stock` n'est sérialisé que lorsque `store_id` est présent ;
- `GET /cash-registers/{id}/current-session/` renvoie la session ouverte ou un
  `404` DRF ;
- les écritures utilisent la protection CSRF de Django ; le client central
  envoie les cookies et reprend `csrftoken` dans l'en-tête `X-CSRFToken` ;
- les erreurs métier ont la forme `{ code, message }`, tandis que les erreurs de
  validation DRF sont structurées par champ et les erreurs d'authentification
  utilisent généralement `{ detail }`.

## Séquence d'authentification React

1. Appeler `GET /api/v1/auth/csrf/` avec `credentials: "include"`.
2. Lire le cookie `csrftoken`.
3. Appeler `POST /api/v1/auth/login/` en envoyant `X-CSRFToken` et le JSON des
   identifiants.
4. Après succès, laisser le navigateur gérer `sessionid` et la nouvelle valeur
   de `csrftoken` émise par Django.
5. Envoyer `credentials: "include"` sur tous les appels et `X-CSRFToken` sur
   chaque méthode mutante.
6. Utiliser `GET /api/v1/auth/me/` pour restaurer l'utilisateur au chargement.
7. Appeler `POST /api/v1/auth/logout/` avec le token CSRF courant.

Le proxy Vite garde les échanges en même origine ; aucune autorisation CORS
globale n'est ajoutée au backend.

## Navigation de l'étape 2

- un utilisateur anonyme est redirigé vers `/login` ;
- après connexion, le frontend liste les caisses actives ;
- l'identifiant précédemment sélectionné est lu dans
  `lopos.selectedCashRegisterId` ;
- si une seule caisse active existe, elle est retrouvée automatiquement ;
- la session ouverte de cette caisse est demandée au backend ;
- une session appartenant au caissier dirige vers `/pos`, sinon vers
  `/cash/open` ;
- aucune caisse n'est choisie arbitrairement lorsque plusieurs sont actives.

## Ouverture de caisse — étape 3

La page `/cash/open` permet de sélectionner une caisse active, de saisir un fond
initial entier en FCFA et appelle `POST /api/v1/cash-sessions/open/`. Après un
succès, la réponse backend est placée dans le cache, la caisse est mémorisée et
le caissier est redirigé vers `/pos`. Le bouton reste désactivé pendant la
requête et les erreurs métier ou de validation sont conservées telles que le
backend les expose.

## Recherche produit — étape 4

La page `/pos` recherche les produits du magasin de la caisse courante. Une
saisie ordinaire déclenche après un court délai une recherche `search`, tandis
qu'Entrée déclenche une recherche exacte `barcode`. Les deux appels transmettent
toujours `store_id`, afin que le backend inclue le stock du magasin. Les huit
premiers résultats affichent nom, code-barres, prix et stock. L'ajout au panier
alimente désormais le panier local.

## Panier — étape 5

Le panier est conservé uniquement dans l'état React. Un second ajout du même
produit incrémente sa ligne. Les contrôles permettent d'incrémenter, décrémenter,
modifier directement la quantité, supprimer ou vider, sans jamais dépasser le
stock connu ni descendre sous une quantité de 1. Le total affiché est calculé en
entiers FCFA ; aucun prix ni total n'est encore envoyé au backend.

## Écran POS — étape 6

L'écran `/pos` assemble l'identité du magasin, la caisse, le caissier et l'état
de session avec la recherche produit et le panier. Le total et le bouton
`Encaisser` dominent le panneau droit ; ce bouton est désactivé lorsque le
panier est vide. Il ouvre désormais le formulaire CASH décrit ci-dessous.

## Paiement CASH — étape 7

Le bouton `Encaisser` ouvre une modal accessible avec le total, le montant reçu,
des montants rapides et la monnaie calculée localement. La validation reste
désactivée tant que le reçu est insuffisant et Échap ferme la modal. Cette étape
ne crée volontairement aucune vente : le panier est conservé et le branchement
de `POST /sales/` appartient à l'étape 8.

## Vente CASH — étape 8

La validation CASH appelle maintenant `POST /api/v1/sales/` avec uniquement la
session, les identifiants produit, les quantités et le paiement. Le bouton est
verrouillé pendant la requête. Une erreur backend reste affichée dans la modal
et conserve le panier. Après un succès, les montants affichés viennent de la
réponse Django, le panier est vidé, les recherches produit sont invalidées et
`Nouvelle vente` redonne le focus au champ scanner.

## Wave et Orange Money — étape 9

`Encaisser` propose maintenant Espèces, Wave et Orange Money. Pour les deux
modes mobiles, le POS demande au caissier de vérifier la réception sur le
téléphone puis d'appuyer explicitement sur `Paiement reçu`. La vente envoie
uniquement `{ method: "WAVE" }` ou `{ method: "ORANGE_MONEY" }`, sans montant
reçu et sans intégration opérateur simulée. Depuis chaque formulaire, le
caissier peut revenir directement au choix du moyen de paiement sans fermer
l'encaissement ni perdre le panier.

## UX scanner — étape 10

Entrée sur une recherche exacte par code-barres ajoute immédiatement le produit
disponible au panier. Le champ est ensuite vidé et refocalisé, y compris lorsque
le même produit est scanné plusieurs fois. Une recherche sans résultat reste
visible pour permettre une correction. Fermer l'encaissement avec Échap ou
terminer une vente redonne également le focus au scanner.

## Tests frontend — étape 11

La suite Vitest couvre les opérations du panier, les totaux, les paiements CASH
insuffisants ou valides, les modes mobiles et le scanner. Deux tests intégrés du
POS mockent maintenant le réseau complet : une réponse `201` vérifie la monnaie
serveur, le vidage du panier et le retour du focus ; une erreur
`INSUFFICIENT_STOCK` vérifie le message Django et la conservation du panier.

## Test end-to-end manuel — étape 12

Préparer les données de démonstration et démarrer l'application :

```bash
docker compose up -d --build
docker compose exec backend python backend/manage.py seed_demo --open-session
cd frontend
npm install
npm run dev
```

Ouvrir `http://localhost:5173`, puis se connecter avec le compte de démonstration
`caissier` et le mot de passe initial `password123`. Si ce compte existait déjà,
la commande `seed_demo` conserve son mot de passe actuel.

Dans le POS :

1. vérifier que `Caisse 01` et sa session ouverte sont retrouvées après connexion ;
2. scanner deux fois le code `3017620422003` ;
3. vérifier `Coca 50cl × 2` et un total de `1 000 FCFA` ;
4. choisir `Espèces`, saisir `2 000`, puis valider ;
5. vérifier le succès, le total serveur de `1 000 FCFA`, la monnaie de
   `1 000 FCFA`, le panier vide et le focus revenu sur le scanner ;
6. scanner à nouveau le Coca pour confirmer que le stock rafraîchi est utilisé ;
7. rafraîchir le navigateur et vérifier que la session ouverte est restaurée.

Dans Django Unfold, contrôler que la vente est `COMPLETED`, que le paiement est
`CASH`, que la ligne contient deux Coca à `500 FCFA` et qu'un mouvement de stock
`SALE -2` a été créé. Répéter séparément avec Wave et Orange Money en confirmant
manuellement `Paiement reçu` ; aucune confirmation opérateur n'est simulée.

## Clôture, rapport Z et ticket — Phase D

Depuis `/pos`, l'action secondaire `Clôturer la caisse` ouvre `/cash/close`. Le
résumé n'affiche jamais le cash attendu avant le comptage. Après saisie du
montant compté et confirmation explicite, le backend clôture la session et le
frontend affiche le cash attendu, le cash compté et l'écart interprété.

Le rapport Z reste accessible après clôture et après actualisation à l'adresse :

```text
/cash-sessions/{sessionId}/report
```

Un ticket historique peut être ouvert ou réimprimé indépendamment à l'adresse :

```text
/sales/{saleId}/receipt
```

Les deux documents utilisent `window.print()`. Le rapport masque la navigation
à l'impression et le ticket possède une mise en page thermique de 80 mm. Aucun
PDF, prix courant du catalogue ou périphérique ESC/POS n'intervient.

### Scénario manuel de clôture

1. ouvrir une session et enregistrer au moins une vente CASH, une Wave et une
   Orange Money ;
2. depuis le POS, ouvrir `Clôturer la caisse` et vérifier les totaux sans voir le
   cash attendu ;
3. compter le tiroir, saisir le montant et vérifier la confirmation finale ;
4. confirmer puis contrôler le résultat attendu/compté/écart ;
5. ouvrir et imprimer le rapport Z ;
6. vérifier que `/pos` redirige désormais vers `/cash/open` ;
7. recharger directement le rapport Z et un ancien ticket ;
8. dans Django Unfold, contrôler la session `CLOSED`, les totaux persistés et
   l'absence de vente créée après la clôture.

La vérification automatisée se lance avec `npm test` et couvre également le
double clic, les erreurs métier/réseau, les trois moyens de paiement et les
montants historiques du ticket.

## Phase E — Offline-first local

Le POS continue de fonctionner sans Internet une fois la caisse ouverte et le
catalogue chargé. Aucune synchronisation serveur n'est implémentée dans cette
phase : les ventes hors ligne restent en file locale jusqu'à la Phase F.

Base locale (`src/db/`, Dexie/IndexedDB, `db.version(1)`) :

- `products` — catalogue mis en cache, avec `serverKnownStock` (dernier stock
  connu du serveur) et `pendingSoldQuantity` (unités vendues localement depuis
  ce cache). Le stock affiché est toujours `serverKnownStock -
  pendingSoldQuantity`, jamais négatif.
- `cashSessions` — session courante mise en cache pour survivre à une coupure ;
  ouvrir une nouvelle session reste strictement en ligne (§19 du cahier des
  charges).
- `localSales` — ventes locales, chacune avec un `id` en `crypto.randomUUID()`
  généré avant tout appel réseau, un statut `PENDING_SYNC` | `SYNCED` |
  `SYNC_FAILED` (ce dernier réservé à la Phase F), un snapshot figé des
  articles (nom/prix au moment de la vente) et son paiement.
- `metadata` — horodatage et taille du dernier cache catalogue par magasin.

Comportements clés :

- `createLocalSale()` (`src/db/sales.ts`) insère la vente et décrémente le
  stock local dans une seule transaction Dexie : jamais l'un sans l'autre.
  Une demande qui dépasse le stock local connu est refusée avant toute
  écriture.
- Le checkout (`PosPage`) bascule entre l'API Django et `createLocalSale()`
  selon `useNetworkStatus()` (écoute `online`/`offline`). CASH, Wave et
  Orange Money fonctionnent tous les trois hors ligne, Wave/Orange Money
  restant une confirmation manuelle du caissier.
- Une panne d'écriture locale (IndexedDB indisponible, transaction refusée)
  n'affiche jamais de succès et ne vide jamais le panier — l'erreur est
  montrée telle quelle et la vente reste à refaire.
- Le ticket (`SaleSuccessModal`, `/sales/:id/receipt`) fonctionne pour une
  vente locale sans aucun appel réseau : la page cherche d'abord la vente
  dans IndexedDB avant d'interroger l'API. Une vente `PENDING_SYNC` affiche
  une référence locale (les 8 premiers caractères de l'UUID en majuscules),
  jamais un faux numéro serveur.
- `/sales/pending` liste les ventes en attente (heure, montant, moyen de
  paiement) et permet de rouvrir chacun de leurs tickets.
- Le panier est persisté dans `localStorage`, scindé par `cashSessionId`
  (`src/features/cart/cartStorage.ts`), pour survivre à un rafraîchissement
  accidentel sans jamais restaurer le panier d'une session différente.
- La bannière `OfflineBanner` (état réseau centralisé, `useNetworkStatus()`)
  affiche « En ligne »/« Hors ligne » et le nombre de ventes en attente,
  sans jamais bloquer la vente.
- Une écriture de **cache** de session (ouverture/clôture) qui échoue
  localement n'efface jamais un succès déjà confirmé par Django — c'est un
  cache non bloquant. Cette tolérance ne s'applique volontairement pas aux
  ventes : leur persistance locale reste strictement obligatoire (§26, §47).

### Hors scope de la Phase E (sujets Phase F)

Ces problèmes sont identifiés mais délibérément non résolus ici :

- **Concurrence multi-caisse** : deux caisses hors ligne peuvent vendre le
  même dernier article ; `availableLocalStock` ne protège que contre la
  survente sur une seule caisse, pas contre le stock serveur réel après
  reconnexion.
- **Dérive catalogue** : si le backend modifie un prix pendant la coupure, la
  vente locale garde le prix du cache au moment de la vente (comportement
  voulu, cohérent avec le ticket), mais rien ne réconcilie ce prix avec le
  serveur après coup.
- **Session fermée ailleurs** : une session ouverte hors ligne peut avoir été
  close côté serveur entre-temps ; aucune détection locale de ce cas.
- **Horloge terminal** : `createdAt` est l'heure locale de l'appareil
  (`occurred_at`), pas une heure serveur ; la Phase F pourra distinguer
  `occurred_at` de `received_at`.
- La synchronisation elle-même (push/pull, retry, idempotence réseau,
  résolution de conflits, Background Sync) est entièrement hors scope ici.

### Scénario manuel hors ligne

1. ouvrir une session en ligne et laisser le catalogue se mettre en cache
   (`GET /products/` réussi) ;
2. couper le réseau (mode avion, ou throttling « Offline » des DevTools) ;
3. scanner un produit connu deux fois, vérifier l'ajout au panier ;
4. encaisser en CASH avec un montant reçu suffisant, vérifier la monnaie, la
   référence locale et le vidage du panier ;
5. encaisser une deuxième vente en Wave, vérifier le compteur « 2 ventes en
   attente » dans la bannière ;
6. rafraîchir le navigateur toujours hors ligne : catalogue, session et les
   deux ventes `PENDING_SYNC` doivent être retrouvés à l'identique ;
7. ouvrir `/sales/pending`, rouvrir le ticket de la première vente et
   vérifier son contenu sans requête réseau ;
8. reconnecter Internet : la bannière repasse à « En ligne » sans déclencher
   de synchronisation (attendue en Phase F).
