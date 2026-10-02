"""Réglages de production : sûrs même quand une variable manque.

Chaque cas recharge `config.settings` dans un interpréteur séparé, avec un
environnement maîtrisé : la suite elle-même tourne sur `settings_test`.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

from django.urls import reverse

BACKEND_DIR = Path(__file__).resolve().parent.parent

_PROBE = """
import json
from config import settings as s
print(json.dumps({
    "DEBUG": s.DEBUG,
    "SESSION_COOKIE_SECURE": s.SESSION_COOKIE_SECURE,
    "CSRF_COOKIE_SECURE": s.CSRF_COOKIE_SECURE,
    "SECURE_SSL_REDIRECT": s.SECURE_SSL_REDIRECT,
    "SECURE_HSTS_SECONDS": s.SECURE_HSTS_SECONDS,
}))
"""


def _load_settings(**env: str) -> subprocess.CompletedProcess:
    clean_env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(("DJANGO_", "DATABASE_URL"))
    }
    return subprocess.run(
        [sys.executable, "-c", _PROBE],
        cwd=BACKEND_DIR,
        env={**clean_env, **env},
        capture_output=True,
        text=True,
    )


def test_debug_is_off_and_https_enforced_when_nothing_is_configured() -> None:
    result = _load_settings(DJANGO_SECRET_KEY="a-real-production-secret")

    assert result.returncode == 0, result.stderr
    values = json.loads(result.stdout)
    assert values == {
        "DEBUG": False,
        "SESSION_COOKIE_SECURE": True,
        "CSRF_COOKIE_SECURE": True,
        "SECURE_SSL_REDIRECT": True,
        "SECURE_HSTS_SECONDS": 31536000,
    }


def test_startup_refuses_a_missing_secret_key_outside_debug() -> None:
    result = _load_settings()

    assert result.returncode != 0
    assert "DJANGO_SECRET_KEY" in result.stderr


def test_startup_refuses_the_development_secret_key_outside_debug() -> None:
    result = _load_settings(DJANGO_SECRET_KEY="unsafe-development-key-change-me")

    assert result.returncode != 0
    assert "DJANGO_SECRET_KEY" in result.stderr


def test_local_development_keeps_working_with_debug_enabled() -> None:
    result = _load_settings(DJANGO_DEBUG="true")

    assert result.returncode == 0, result.stderr
    values = json.loads(result.stdout)
    assert values["DEBUG"] is True
    assert values["SESSION_COOKIE_SECURE"] is False
    assert values["SECURE_SSL_REDIRECT"] is False


def test_healthcheck_answers_without_database_or_session(client) -> None:
    response = client.get(reverse("healthz"))

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert "sessionid" not in response.cookies
