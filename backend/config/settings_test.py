"""Réglages de la suite de tests.

Les réglages réels sont sûrs par défaut (debug désactivé, HTTPS imposé) : la
suite les garde, en ne fournissant que ce qu'un environnement de test n'a
pas — une clé secrète — et en laissant le client de test parler HTTP.
"""

import os

os.environ.setdefault("DJANGO_SECRET_KEY", "tests-only-secret-key-never-used-in-production")
os.environ.setdefault("DJANGO_SECURE_SSL_REDIRECT", "false")

from .settings import *  # noqa: E402,F401,F403

# Un cache local, vidé entre les tests (voir conftest) : les compteurs
# d'échecs de connexion ne passent jamais d'un test à l'autre.
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

# Pas de `collectstatic` en test : le manifest de production n'existe pas.
STORAGES = {
    **STORAGES,  # noqa: F405
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}

# Hachage rapide des mots de passe (et des codes PIN) : la sécurité du
# hachage n'est pas ce que la suite teste, sa lenteur la ralentirait.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
