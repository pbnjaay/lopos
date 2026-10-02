"""Freine les tentatives de connexion répétées (API du POS et admin).

Seuls les échecs comptent ; un compteur expire 15 minutes après son
dernier échec. Trois compteurs :

- (identifiant, adresse IP) : le cas courant, un mot de passe deviné depuis
  un poste. Bloquer cette paire ne gêne pas le vrai titulaire du compte,
  qui se connecte d'ailleurs ;
- adresse IP seule : une adresse qui essaie beaucoup d'identifiants
  (credential stuffing) ;
- identifiant seul, avec un seuil haut : un même compte attaqué depuis de
  nombreuses adresses. C'est le seul compteur qu'un tiers peut faire
  déborder pour gêner le titulaire ; son seuil est donc élevé et le blocage
  temporaire.

Jamais de verrouillage définitif : tout blocage expire avec la fenêtre.
Une connexion réussie efface les compteurs de sa paire et de son
identifiant.
"""

from dataclasses import dataclass

from django.conf import settings
from django.core.cache import cache

WINDOW_SECONDS = 15 * 60
MAX_FAILURES_PER_USERNAME_AND_IP = 5
MAX_FAILURES_PER_IP = 30
MAX_FAILURES_PER_USERNAME = 50

_PREFIX = "login-guard"


@dataclass(frozen=True)
class LoginBlocked:
    retry_after: int


def client_ip(request) -> str:
    """Adresse du client. Derrière le proxy de l'hébergeur (Railway), c'est
    l'entrée de `X-Forwarded-For` ajoutée par ce proxy, comptée depuis la
    droite : celles écrites par le client lui-même, à gauche, sont ignorées."""
    trusted_proxies = getattr(settings, "LOGIN_GUARD_TRUSTED_PROXY_COUNT", 0)
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if trusted_proxies > 0 and forwarded:
        hops = [hop.strip() for hop in forwarded.split(",") if hop.strip()]
        if len(hops) >= trusted_proxies:
            return hops[-trusted_proxies]
    return request.META.get("REMOTE_ADDR", "") or "unknown"


def _normalize(username: str) -> str:
    return (username or "").strip().lower()


def _keys(username: str, ip: str) -> list[tuple[str, int]]:
    name = _normalize(username)
    return [
        (f"{_PREFIX}:pair:{name}:{ip}", MAX_FAILURES_PER_USERNAME_AND_IP),
        (f"{_PREFIX}:ip:{ip}", MAX_FAILURES_PER_IP),
        (f"{_PREFIX}:user:{name}", MAX_FAILURES_PER_USERNAME),
    ]


def check(request, username: str) -> LoginBlocked | None:
    """Refus à opposer avant même de vérifier le mot de passe, ou None."""
    for key, limit in _keys(username, client_ip(request)):
        if (cache.get(key) or 0) >= limit:
            return LoginBlocked(retry_after=WINDOW_SECONDS)
    return None


def record_failure(request, username: str) -> None:
    # `get` + `set` plutôt que `incr` : `incr` remet le délai d'expiration
    # par défaut sur certains caches (base de données). Chaque échec
    # reporte la fin de la fenêtre ; deux échecs simultanés peuvent n'en
    # compter qu'un, sans conséquence à ces seuils.
    for key, _ in _keys(username, client_ip(request)):
        cache.set(key, (cache.get(key) or 0) + 1, WINDOW_SECONDS)


def record_success(request, username: str) -> None:
    pair_key, _ip_key, user_key = (key for key, _ in _keys(username, client_ip(request)))
    cache.delete_many([pair_key, user_key])


BLOCKED_MESSAGE = (
    "Trop de tentatives de connexion. Réessayez dans quelques minutes."
)
