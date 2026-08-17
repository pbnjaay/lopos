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

L'administration se trouve sur `http://localhost:8000/admin/`. La connexion à
l'API navigable est disponible sur `http://localhost:8000/api/v1/auth/login/`.

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
authentifié sur toutes les routes API. Le caissier d'une ouverture provient de
`request.user` et n'est jamais choisi dans le corps de la requête. Une vente ne
peut être enregistrée que par le caissier propriétaire de la session.

Cette configuration est adaptée au développement et à l'API navigable. Le JWT
et les rôles avancés restent hors périmètre de cette phase.

## API v1

| Méthode | Route | Usage |
|---|---|---|
| `POST` | `/api/v1/stores/` | Créer un magasin |
| `GET` | `/api/v1/stores/` | Lister les magasins |
| `POST` | `/api/v1/products/` | Créer un produit |
| `GET` | `/api/v1/products/` | Rechercher des produits |
| `POST` | `/api/v1/cash-registers/` | Créer une caisse |
| `GET` | `/api/v1/cash-registers/{id}/current-session/` | Lire la session ouverte |
| `POST` | `/api/v1/inventory/stock-in/` | Réceptionner du stock |
| `POST` | `/api/v1/cash-sessions/open/` | Ouvrir une session |
| `POST` | `/api/v1/sales/` | Finaliser et payer une vente |

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
  Django Admin.

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
  réelles : une seule réussit et le stock final vaut 0.

## Périmètre volontairement exclu

Cette phase ne contient ni frontend, offline-first, synchronisation,
multi-tenancy avancé, RLS, promotions, achats fournisseurs, clôture complète de
caisse, split payment, Celery, Redis, microservices ou reporting avancé.
