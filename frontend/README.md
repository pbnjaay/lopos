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
  anonyme produit actuellement un `403` DRF ;
- `/api/v1/auth/login/` est le formulaire HTML fourni par DRF, pas un endpoint
  JSON de connexion ;
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

Avant l'étape 2, il faudra décider du contrat de connexion navigateur. Le
formulaire HTML DRF existant peut dépanner, mais une petite vue JSON
login/logout/état utilisateur avec émission du cookie CSRF sera plus adaptée à
une interface React.
