from decimal import Decimal


def format_fcfa(amount: Decimal | int | float | None) -> str:
    """Format a monetary amount the way a manager expects to read it: "125 000 FCFA"."""
    value = int(round(amount or 0))
    return f"{value:,}".replace(",", " ") + " FCFA"
