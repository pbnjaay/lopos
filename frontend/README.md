# LoPOS frontend — étapes 1 à 7

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
