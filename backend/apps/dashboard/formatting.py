from decimal import Decimal

from django.conf import settings


def format_fcfa(amount: Decimal | int | float | None) -> str:
    """Format a monetary amount the way a manager expects to read it: "125 000 FCFA"."""
    value = int(round(amount or 0))
    return f"{value:,}".replace(",", " ") + " FCFA"


def format_count(count: int, singular: str, plural: str) -> str:
    """"1 produit" vs "2 produits" — centralizes singular/plural wording."""
    return f"{count} {singular if count == 1 else plural}"


def format_percentage(part: Decimal | int | None, total: Decimal | int | None) -> int:
    if not total:
        return 0
    return round((part or 0) / total * 100)


def format_cash_difference(difference: Decimal | None) -> str:
    """Never "manque -500 FCFA" — the word already carries the sign."""
    if not difference:
        return "Aucun écart"
    if difference > 0:
        return f"Surplus : {format_fcfa(difference)}"
    return f"Manque : {format_fcfa(abs(difference))}"


def classify_cash_difference(difference: Decimal | None) -> str:
    """Returns "info" | "warning" | "critical" for a cash session's difference.

    Thresholds are intentionally simple, temporary values (see
    settings.CASH_DISCREPANCY_*_THRESHOLD) meant to be tuned once a real
    pilot store gives a sense of what's a "normal" daily variance.
    """
    if not difference:
        return "info"
    magnitude = abs(difference)
    if magnitude <= settings.CASH_DISCREPANCY_NOTABLE_THRESHOLD:
        return "info"
    if magnitude <= settings.CASH_DISCREPANCY_CRITICAL_THRESHOLD:
        return "warning"
    return "critical"
