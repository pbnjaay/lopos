from __future__ import annotations

from typing import Any

import posthog
from django.conf import settings

_initialized = False


def _ensure_initialized() -> bool:
    global _initialized
    if not settings.POSTHOG_ENABLED or not settings.POSTHOG_API_KEY:
        return False
    if not _initialized:
        posthog.project_api_key = settings.POSTHOG_API_KEY
        posthog.host = settings.POSTHOG_HOST
        _initialized = True
    return True


def capture(distinct_id: str, event: str, properties: dict[str, Any] | None = None) -> None:
    """Envoie un event PostHog server-side. No-op si POSTHOG_ENABLED est faux.

    Réservé aux flux déclenchés depuis le Django Admin (produits, stock,
    dashboard gérant), qui ne chargent pas le SDK PostHog JS.
    """
    if not _ensure_initialized():
        return
    posthog.capture(event, distinct_id=distinct_id, properties=properties or {})
