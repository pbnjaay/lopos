# LoPOS backend

Backend transactionnel du MVP de caisse LoPOS, construit comme un monolithe
Django modulaire avec Django REST Framework et PostgreSQL.

La Phase A couvre le parcours suivant uniquement via API : création du magasin,
du produit et de la caisse, réception du stock, ouverture d'une session, vente,
paiement et décrément atomique du stock.

## Stack

- Python 3.12+
- Django 5.2 LTS
- Django REST Framework
- PostgreSQL 17
- psycopg 3
- pytest et pytest-django
- Docker Compose

Les identifiants métier POS sont des UUID. Les montants utilisent exclusivement
`Decimal` et des colonnes `NUMERIC(14, 2)` ; aucun calcul financier n'utilise de
`float`.

## Architecture

```text
backend/
├── config/             # paramètres, composition des URLs, ASGI/WSGI
├── apps/
│   ├── stores/         # magasins et caisses physiques
│   ├── catalog/        # catalogue produit et prix courants
│   ├── inventory/      # stock courant, mouvements et réception
│   ├── cash/           # sessions de caisse et ouverture
│   └── sales/          # ventes, articles, paiements et finalisation
├── tests/              # modèles, services, API et concurrence PostgreSQL
└── manage.py
```

Les écritures métier suivent le flux :

```text
APIView / ViewSet → Serializer → Service métier → ORM PostgreSQL
```

Les serializers valident le contrat HTTP. Les services `receive_stock()`,
`open_cash_session()` et `complete_sale()` portent les transactions et les
invariants métier. Aucun signal Django n'intervient dans le workflow de vente.

## Démarrage avec Docker

Prérequis : Docker et Docker Compose.

```bash
cp .env.example .env
docker compose up --build
```

Le backend est disponible sur `http://localhost:8000/` et PostgreSQL est exposé
sur `localhost:5433`. Ce port évite un conflit avec une installation locale
éventuellement présente sur 5432.

Créer un administrateur :

```bash
docker compose exec backend python backend/manage.py createsuperuser
```

L'administration se trouve sur `http://localhost:8000/admin/`. L'authentification
du frontend utilise les endpoints JSON décrits ci-dessous.

## Développement local

Prérequis : Python 3.12+, [uv](https://docs.astral.sh/uv/), Docker.

```bash
docker compose up -d db
uv sync
uv run python backend/manage.py migrate
uv run python backend/manage.py runserver
```

Les valeurs locales par défaut ciblent PostgreSQL sur `localhost:5433`. Le
fichier `.env` est lu automatiquement par Docker Compose ; pour modifier la
configuration d'un processus Python local, exportez les variables concernées.

## Authentification

La Phase A utilise `SessionAuthentication` et exige un utilisateur Django
authentifié sur les routes métier. Le caissier d'une ouverture provient de
`request.user` et n'est jamais choisi dans le corps de la requête. Une vente ne
peut être enregistrée que par le caissier propriétaire de la session.

Le frontend doit d'abord appeler `GET /api/v1/auth/csrf/`, puis reprendre la
valeur du cookie `csrftoken` dans l'en-tête `X-CSRFToken` du login et de toute
requête mutante. Toutes les requêtes utilisent `credentials: "include"`. Django
émet le cookie de session `sessionid` après un login réussi et renouvelle alors
le token CSRF.

Le proxy Vite `/api` conserve les appels dans l'origine du frontend : aucune
configuration CORS n'est nécessaire. `http://localhost:5173` est la seule
origine CSRF de développement autorisée par défaut. Elle est configurable avec
`DJANGO_CSRF_TRUSTED_ORIGINS`. Le JWT et les rôles avancés restent hors
périmètre.

## API v1

| Méthode | Route | Usage |
|---|---|---|
| `GET` | `/api/v1/auth/csrf/` | Émettre le cookie CSRF |
| `POST` | `/api/v1/auth/login/` | Créer une session Django |
| `POST` | `/api/v1/auth/logout/` | Détruire la session Django |
| `GET` | `/api/v1/auth/me/` | Lire l'utilisateur courant |
| `POST` | `/api/v1/stores/` | Créer un magasin |
| `GET` | `/api/v1/stores/` | Lister les magasins |
| `POST` | `/api/v1/products/` | Créer un produit |
| `GET` | `/api/v1/products/` | Rechercher des produits |
| `POST` | `/api/v1/cash-registers/` | Créer une caisse |
| `GET` | `/api/v1/cash-registers/{id}/current-session/` | Lire la session ouverte |
| `POST` | `/api/v1/inventory/stock-in/` | Réceptionner du stock |
| `POST` | `/api/v1/cash-sessions/open/` | Ouvrir une session |
| `GET` | `/api/v1/cash-sessions/{id}/summary/` | Résumé de caisse (totaux recalculés) |
| `POST` | `/api/v1/cash-sessions/{id}/close/` | Clôturer une session |
| `POST` | `/api/v1/sales/` | Finaliser et payer une vente |
| `GET` | `/api/v1/sales/{id}/` | Détail d'une vente (données de ticket) |

Recherche produit :

```text
GET /api/v1/products/?search=coca
GET /api/v1/products/?barcode=123456789&store_id=<uuid>
```

Le champ `stock` est inclus lorsque `store_id` est fourni.

### Entrée de stock

```http
POST /api/v1/inventory/stock-in/
Content-Type: application/json

{
  "store_id": "<uuid>",
  "product_id": "<uuid>",
  "quantity": 20
}
```

### Ouverture de caisse

```http
POST /api/v1/cash-sessions/open/
Content-Type: application/json

{
  "cash_register_id": "<uuid>",
  "opening_balance": "15000.00"
}
```

### Vente

```http
POST /api/v1/sales/
Content-Type: application/json

{
  "cash_session_id": "<uuid>",
  "items": [
    {"product_id": "<uuid>", "quantity": 2}
  ],
  "payment": {
    "method": "CASH",
    "received_amount": "2000.00"
  }
}
```

Le client ne transmet aucun prix, total, rendu monnaie ou identifiant de
caissier. Le serveur relit les prix du catalogue et calcule tous les montants.

Les méthodes de paiement disponibles sont `CASH`, `WAVE` et `ORANGE_MONEY`.
Pour les paiements mobiles, `received_amount` doit être omis.

### Détail d'une vente (ticket)

```http
GET /api/v1/sales/{id}/
```

Auth : session Django requise. Autorisé uniquement au caissier propriétaire de
la vente (`sale.cashier`) ou à un utilisateur `is_staff`, sinon
`403 SALE_NOT_OWNED`.

Réponse `200` — toutes les données nécessaires au rendu d'un ticket, y compris
les snapshots historiques (`unit_price`, `product_name`) qui ne bougent jamais
même si le produit change de prix ensuite :

```json
{
  "id": "uuid",
  "created_at": "...",
  "store": {"id": "uuid", "name": "Supérette Test"},
  "cash_register": {"id": "uuid", "name": "Caisse 01"},
  "cashier": {"id": 1, "username": "bassirou"},
  "status": "COMPLETED",
  "subtotal": "1000.00",
  "discount": "0.00",
  "total": "1000.00",
  "payment": {
    "method": "CASH",
    "amount": "1000.00",
    "received_amount": "2000.00",
    "change_amount": "1000.00"
  },
  "items": [
    {
      "product_id": "uuid",
      "product_name": "Coca 50cl",
      "unit_price": "500.00",
      "quantity": 2,
      "line_total": "1000.00"
    }
  ]
}
```

`404` si la vente n'existe pas.

### Résumé de caisse

```http
GET /api/v1/cash-sessions/{id}/summary/
```

Auth : session Django requise. Autorisé uniquement au caissier propriétaire de
la session (`cash_session.cashier`) ou à un utilisateur `is_staff`, sinon
`403 CASH_SESSION_NOT_OWNED`. `404` si la session n'existe pas.

Tous les totaux sont recalculés côté serveur à chaque appel (jamais mis en
cache, jamais fournis par le client) :

```json
{
  "id": "uuid",
  "status": "OPEN",
  "cash_register": {"id": "uuid", "name": "Caisse 01"},
  "cashier": {"id": 1, "username": "bassirou"},
  "opened_at": "...",
  "sales_count": 3,
  "gross_sales": "43000.00",
  "payments": {
    "cash": "15000.00",
    "wave": "20000.00",
    "orange_money": "8000.00"
  },
  "opening_balance": "15000.00",
  "expected_cash": "30000.00",
  "counted_cash": null,
  "cash_difference": null,
  "closed_at": null
}
```

Une fois la session clôturée, `counted_cash`, `cash_difference` et
`closed_at` sont renseignés et `status` vaut `CLOSED`. Seules les ventes
`COMPLETED` de la session sont comptées ; `expected_cash =
opening_balance + payments.cash`.

### Clôture de caisse

```http
POST /api/v1/cash-sessions/{id}/close/
Content-Type: application/json

{
  "counted_cash": "29500.00"
}
```

Auth : session Django requise, même règle de propriété que `/summary/`. Le
client ne transmet que `counted_cash` — tout le reste (`expected_cash`,
`gross_sales`, `sales_count`, `payments`, `cash_difference`) est recalculé par
le serveur et tout champ superflu envoyé par le client est ignoré.

Réponse `200` — même forme que `/summary/` avec les champs de clôture
renseignés :

```json
{
  "id": "uuid",
  "status": "CLOSED",
  "opened_at": "...",
  "closed_at": "...",
  "sales_count": 3,
  "gross_sales": "43000.00",
  "payments": {"cash": "15000.00", "wave": "20000.00", "orange_money": "8000.00"},
  "opening_balance": "15000.00",
  "expected_cash": "30000.00",
  "counted_cash": "29500.00",
  "cash_difference": "-500.00"
}
```

Erreurs métier :

- `400 INVALID_COUNTED_CASH` — `counted_cash` négatif ou invalide pour le
  service métier.
- `409 CASH_SESSION_ALREADY_CLOSED` — la session est déjà `CLOSED`.

Une fois `CLOSED`, toute tentative de `POST /api/v1/sales/` sur cette session
échoue avec `409 CASH_SESSION_CLOSED` et ne crée ni `Sale`, ni `SaleItem`, ni
`Payment`, ni `InventoryMovement`.

`complete_sale()` et `close_cash_session()` verrouillent tous deux la même
ligne `CashSession` via `select_for_update()` avant de lire son statut.
PostgreSQL sérialise donc les deux opérations sur une même session : la
transaction arrivée en second attend que la première commit. Il ne peut donc
jamais exister une vente `COMPLETED` absente du rapport de clôture, ni une
vente acceptée après `CLOSED`.

## Invariants transactionnels

- une caisse possède au maximum une session `OPEN`, protégée par une contrainte
  d'unicité PostgreSQL conditionnelle ;
- une seule ligne de stock existe par couple magasin/produit ;
- un stock ne peut pas devenir négatif ;
- les lignes de stock sont verrouillées avec `select_for_update()` dans l'ordre
  des identifiants produit ;
- vente, articles, paiement, stocks et mouvements sont écrits dans le même
  `transaction.atomic()` ;
- un échec tardif annule toutes les écritures ;
- les noms et prix des produits sont copiés dans `SaleItem` ;
- les mouvements de stock et les données de vente sont en lecture seule dans
  Django Admin ;
- une session de caisse `CLOSED` ne peut plus accepter de vente ;
- `close_cash_session()` recalcule `expected_cash`, `gross_sales`,
  `sales_count` et la répartition par méthode de paiement depuis PostgreSQL au
  moment de la clôture, jamais depuis des valeurs envoyées par le client.

Les erreurs métier exposées par l'API suivent la forme :

```json
{
  "code": "INSUFFICIENT_STOCK",
  "message": "Stock insuffisant pour Coca 50cl."
}
```

## Tests

PostgreSQL doit être démarré avant la suite locale :

```bash
docker compose up -d db
uv run python backend/manage.py check
uv run python backend/manage.py makemigrations --check --dry-run
uv run pytest
```

La suite couvre :

- les contraintes des modèles ;
- les services métier et leurs rollbacks ;
- le parcours API complet jusqu'au stock final de 18 ;
- les paiements invalides et stocks insuffisants sans écriture partielle ;
- deux ventes concurrentes sur un stock de 1 avec deux connexions PostgreSQL
  réelles : une seule réussit et le stock final vaut 0 ;
- le résumé et la clôture de caisse (écart, manque, surplus, double clôture,
  vente refusée après clôture, immutabilité des prix historiques) ;
- une vente et une clôture concurrentes sur la même session, avec deux
  connexions PostgreSQL réelles : aucune vente `COMPLETED` n'est jamais
  absente du rapport de clôture, et aucune vente n'est jamais acceptée après
  `CLOSED`.

## Périmètre volontairement exclu

Cette phase ne contient ni frontend, offline-first, synchronisation,
multi-tenancy avancé, RLS, promotions, achats fournisseurs, remboursements,
split payment, intégration API Wave/Orange Money, impression ESC/POS, Celery,
Redis ou microservices. La génération du rapport Z (mise en page, impression)
et la page de clôture du frontend appartiennent à la Phase D.

## Administration Django Unfold

Le back-office disponible sur `http://localhost:8000/admin/` utilise Django
Unfold. Les écrans produits, magasins, caisses et stocks conservent les actions
de l'admin Django. Les sessions de caisse, mouvements de stock et ventes
restent en lecture seule afin de préserver leur auditabilité.
