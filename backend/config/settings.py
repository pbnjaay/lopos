import logging
import os
from decimal import Decimal
from pathlib import Path

import dj_database_url
import sentry_sdk
from django.core.exceptions import ImproperlyConfigured
from django.urls import reverse_lazy
from django.utils.translation import gettext_lazy as _
from sentry_sdk.integrations.django import DjangoIntegration
from sentry_sdk.integrations.logging import LoggingIntegration


BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "unsafe-development-key-change-me")
DEBUG = os.getenv("DJANGO_DEBUG", "true").lower() in {"1", "true", "yes"}

if not DEBUG and SECRET_KEY == "unsafe-development-key-change-me":
    raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY doit être défini explicitement lorsque DJANGO_DEBUG=false."
    )

SENTRY_DSN = os.getenv("SENTRY_DSN", "")
SENTRY_ENVIRONMENT = os.getenv("SENTRY_ENVIRONMENT", "development")
SENTRY_RELEASE = os.getenv("SENTRY_RELEASE") or None
SENTRY_TRACES_SAMPLE_RATE = float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1"))

POSTHOG_API_KEY = os.getenv("POSTHOG_API_KEY", "")
POSTHOG_HOST = os.getenv("POSTHOG_HOST", "https://us.i.posthog.com")
POSTHOG_ENABLED = os.getenv("POSTHOG_ENABLED", "false").lower() in {"1", "true", "yes"}


def _sentry_before_send(event, hint):
    request = event.get("request")
    if request:
        headers = request.get("headers")
        if headers:
            headers.pop("Authorization", None)
            headers.pop("Cookie", None)
        request.pop("cookies", None)
    return event


if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=SENTRY_ENVIRONMENT,
        release=SENTRY_RELEASE,
        traces_sample_rate=SENTRY_TRACES_SAMPLE_RATE,
        send_default_pii=False,
        before_send=_sentry_before_send,
        integrations=[
            DjangoIntegration(),
            LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
        ],
    )
ALLOWED_HOSTS = [
    host.strip()
    for host in os.getenv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if host.strip()
]
# Railway envoie systématiquement ce Host sur ses requêtes de healthcheck,
# quel que soit le domaine réel du service — sans ça, Django répond 400
# DisallowedHost et Railway marque le déploiement comme en échec.
ALLOWED_HOSTS.append("healthcheck.railway.app")

INSTALLED_APPS = [
    "unfold",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "apps.stores",
    "apps.catalog",
    "apps.inventory",
    "apps.cash",
    "apps.sales",
    "apps.accounts",
    "apps.sync",
    "apps.dashboard",
    "apps.observability",
]

LOW_STOCK_THRESHOLD_DEFAULT = 5

# Seuils temporaires pour classer les écarts de caisse dans le dashboard gérant.
# En dessous de NOTABLE : différence considérée normale (arrondis, erreurs de rendu de monnaie).
# Au-dessus de CRITICAL : alerte prioritaire. À ajuster une fois qu'un pilote réel
# donne une idée de ce qui est un écart "normal" pour ce type de commerce.
CASH_DISCREPANCY_NOTABLE_THRESHOLD = Decimal("1000")
CASH_DISCREPANCY_CRITICAL_THRESHOLD = Decimal("5000")

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")

UNFOLD = {
    "SITE_TITLE": "LoPOS Admin",
    "SITE_HEADER": "LoPOS",
    "SITE_SUBHEADER": "Administration du point de vente",
    "SITE_SYMBOL": "point_of_sale",
    "DASHBOARD_CALLBACK": "apps.dashboard.views.manager_dashboard_callback",
    "SIDEBAR": {
        "show_search": True,
        "show_all_applications": False,
        "navigation": [
            {
                "title": None,
                "separator": False,
                "items": [
                    {
                        "title": _("Tableau de bord"),
                        "icon": "dashboard",
                        "link": reverse_lazy("admin:index"),
                    },
                ],
            },
            {
                "title": _("Catalogue"),
                "separator": True,
                "items": [
                    {
                        "title": _("Produits"),
                        "icon": "inventory_2",
                        "link": reverse_lazy("admin:catalog_product_changelist"),
                    },
                ],
            },
            {
                "title": _("Stock"),
                "separator": True,
                "items": [
                    {
                        "title": _("État du stock"),
                        "icon": "warehouse",
                        "link": reverse_lazy("admin:inventory_stock_changelist"),
                    },
                    {
                        "title": _("Mouvements de stock"),
                        "icon": "sync_alt",
                        "link": reverse_lazy(
                            "admin:inventory_inventorymovement_changelist"
                        ),
                    },
                ],
            },
            {
                "title": _("Caisses"),
                "separator": True,
                "items": [
                    {
                        "title": _("Caisses"),
                        "icon": "point_of_sale",
                        "link": reverse_lazy("admin:stores_cashregister_changelist"),
                    },
                    {
                        "title": _("Sessions de caisse"),
                        "icon": "receipt_long",
                        "link": reverse_lazy("admin:cash_cashsession_changelist"),
                    },
                ],
            },
            {
                "title": _("Ventes"),
                "separator": True,
                "items": [
                    {
                        "title": _("Ventes"),
                        "icon": "shopping_cart",
                        "link": reverse_lazy("admin:sales_sale_changelist"),
                    },
                ],
            },
            {
                "title": _("Configuration"),
                "separator": True,
                "items": [
                    {
                        "title": _("Magasins"),
                        "icon": "store",
                        "link": reverse_lazy("admin:stores_store_changelist"),
                    },
                    {
                        "title": _("Utilisateurs"),
                        "icon": "group",
                        "link": reverse_lazy("admin:auth_user_changelist"),
                    },
                ],
            },
        ],
    },
}

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "apps.accounts.middleware.ExposeCsrfTokenMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

if os.getenv("DATABASE_URL"):
    # Fourni tel quel par Railway (et la plupart des hébergeurs Postgres managés).
    DATABASES = {
        "default": dj_database_url.config(
            conn_max_age=600,
            ssl_require=os.getenv("DATABASE_SSL_REQUIRE", "true").lower()
            in {"1", "true", "yes"},
        )
    }
else:
    # Développement local (docker-compose) : variables individuelles.
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.getenv("POSTGRES_DB", "lopos"),
            "USER": os.getenv("POSTGRES_USER", "lopos"),
            "PASSWORD": os.getenv("POSTGRES_PASSWORD", "lopos"),
            "HOST": os.getenv("POSTGRES_HOST", "localhost"),
            "PORT": os.getenv("POSTGRES_PORT", "5433"),
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "fr-fr"
TIME_ZONE = "Africa/Dakar"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        "BACKEND": (
            "django.contrib.staticfiles.storage.StaticFilesStorage"
            if DEBUG
            # Nécessite `collectstatic` (voir Dockerfile) — pas de collectstatic
            # en dev, donc pas de manifest strict hors production.
            else "whitenoise.storage.CompressedManifestStaticFilesStorage"
        )
    },
}

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
}

CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "DJANGO_CSRF_TRUSTED_ORIGINS",
        "http://localhost:5173",
    ).split(",")
    if origin.strip()
]
CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SECURE = os.getenv("DJANGO_COOKIE_SECURE", "false").lower() in {
    "1",
    "true",
    "yes",
}
SESSION_COOKIE_SECURE = CSRF_COOKIE_SECURE
CSRF_FAILURE_VIEW = "config.csrf.csrf_failure"

# "Lax" en local (front et back sur le même site via le proxy Vite).
# "None" en production (Vercel + Railway = domaines différents) : requiert
# alors CSRF_COOKIE_SECURE/SESSION_COOKIE_SECURE=true (HTTPS obligatoire pour
# qu'un navigateur accepte SameSite=None).
_COOKIE_SAMESITE = os.getenv("DJANGO_COOKIE_SAMESITE", "Lax")
CSRF_COOKIE_SAMESITE = _COOKIE_SAMESITE
SESSION_COOKIE_SAMESITE = _COOKIE_SAMESITE

# CORS : le frontend (Vercel) et le backend (Railway) sont deux domaines
# différents en production. IsAuthenticated + SessionAuthentication exigent
# les cookies de session, donc CORS_ALLOW_CREDENTIALS=True et une allowlist
# explicite (pas de wildcard, incompatible avec les credentials).
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("DJANGO_CORS_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]
CORS_ALLOW_CREDENTIALS = True
# Sans ceci, le fetch() du frontend ne peut pas lire le header X-CSRFToken
# ajouté par ExposeCsrfTokenMiddleware — les headers de réponse cross-origin
# sont masqués par défaut au JS, même quand la requête réussit.
CORS_EXPOSE_HEADERS = ["X-CSRFToken"]

# Railway (comme la plupart des PaaS) termine le TLS à son edge proxy et
# transmet en HTTP en interne : sans ceci, request.is_secure() est toujours
# faux et les cookies "Secure" ne partent jamais.
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = True

# Durcissement HTTPS optionnel — désactivé par défaut pour ne pas risquer de
# casser un healthcheck ou un accès direct par IP avant que le domaine et le
# certificat soient confirmés fonctionnels. À activer une fois le déploiement
# validé (voir README, section Déploiement).
SECURE_SSL_REDIRECT = os.getenv("DJANGO_SECURE_SSL_REDIRECT", "false").lower() in {
    "1",
    "true",
    "yes",
}
SECURE_HSTS_SECONDS = int(os.getenv("DJANGO_SECURE_HSTS_SECONDS", "0"))

# Sans ceci, les erreurs "Bad Request (400)" (ex. DisallowedHost quand
# ALLOWED_HOSTS ne correspond pas au Host reçu) ne vont qu'à mail_admins par
# défaut — donc invisibles dans les logs Railway tant qu'aucun SMTP n'est
# configuré. On les fait remonter sur la console à la place.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {
        "console": {"class": "logging.StreamHandler"},
    },
    "loggers": {
        "django.request": {"handlers": ["console"], "level": "WARNING"},
        "django.security": {"handlers": ["console"], "level": "WARNING"},
    },
}
