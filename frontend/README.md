# LoPOS frontend — étape 1

Socle React, TypeScript et Vite du POS. Cette étape fournit uniquement le
routing, TanStack Query et le client HTTP partagé. Les pages sont volontairement
des coquilles : l'authentification et la session POS appartiennent à l'étape 2.

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
