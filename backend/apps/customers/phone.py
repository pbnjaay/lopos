import re

from .exceptions import InvalidPhone

SENEGAL_PREFIX = "221"

# Chiffres et séparateurs usuels uniquement : une lettre trahit une erreur de
# saisie (nom tapé dans le mauvais champ), pas un numéro à « nettoyer ».
_ALLOWED = re.compile(r"^\+?[\d\s.\-()/]+$")


def normalize_phone(raw: str) -> str:
    """Ramène un numéro à sa forme E.164, clé de déduplication des clients.

    Volontairement centré sur le Sénégal, sans bibliothèque internationale :
    `77 123 45 67`, `771234567`, `+221771234567` et `00221 77 123 45 67`
    donnent tous `+221771234567`. Un numéro national doit compter 9 chiffres
    et commencer par 7 (mobile) ou 3 (fixe). Un numéro étranger explicite
    (`+33…`, `0033…`) est conservé tel quel, sans autre validation que sa
    longueur.
    """
    value = (raw or "").strip()
    if not value or not _ALLOWED.match(value):
        raise InvalidPhone("Numéro de téléphone invalide.")

    digits = re.sub(r"\D", "", value)
    international = value.startswith("+")
    if not international and digits.startswith("00"):
        international = True
        digits = digits[2:]

    if international and not digits.startswith(SENEGAL_PREFIX):
        if 8 <= len(digits) <= 15:
            return f"+{digits}"
        raise InvalidPhone("Numéro de téléphone invalide.")

    if digits.startswith(SENEGAL_PREFIX) and (international or len(digits) == 12):
        digits = digits[len(SENEGAL_PREFIX):]

    if len(digits) == 9 and digits[0] in "73":
        return f"+{SENEGAL_PREFIX}{digits}"
    raise InvalidPhone("Numéro de téléphone invalide.")
