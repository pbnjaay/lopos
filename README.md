# LoPOS backend

Socle backend du MVP de caisse, construit avec Django, Django REST Framework,
PostgreSQL et pytest.

## Prérequis

- Python 3.12+
- [uv](https://docs.astral.sh/uv/) pour le développement local
- Docker et Docker Compose pour PostgreSQL

## Démarrage complet avec Docker

```bash
cp .env.example .env
docker compose up --build
```

L'API Django est alors disponible sur `http://localhost:8000/` et
l'administration sur `http://localhost:8000/admin/`.

## Développement local

Démarrer PostgreSQL, installer les dépendances, puis lancer Django :

```bash
cp .env.example .env
docker compose up -d db
uv sync
uv run python backend/manage.py migrate
uv run python backend/manage.py runserver
```

Exécuter les vérifications :

```bash
uv run python backend/manage.py check
uv run pytest
```

Les paramètres de connexion sont configurables avec les variables décrites
dans `.env.example`. Le fichier `.env` est lu par Docker Compose ; pour un
processus lancé directement sur la machine, exportez ces variables ou gardez
les valeurs locales par défaut (`localhost:5433`). Le port hôte 5433 évite les
conflits avec une éventuelle installation PostgreSQL déjà exposée sur 5432.
