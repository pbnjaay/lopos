from datetime import datetime, timedelta

from django.utils import timezone

TODAY = "today"
YESTERDAY = "yesterday"
LAST_7_DAYS = "7d"
DEFAULT_PERIOD = TODAY

PERIOD_CHOICES = (
    (TODAY, "Aujourd'hui"),
    (YESTERDAY, "Hier"),
    (LAST_7_DAYS, "7 derniers jours"),
)

_VALID_PERIODS = frozenset(value for value, _label in PERIOD_CHOICES)


def resolve_period(raw_value: str | None) -> str:
    return raw_value if raw_value in _VALID_PERIODS else DEFAULT_PERIOD


def resolve_period_range(period: str) -> tuple[datetime, datetime]:
    """Returns [start, end) for `period`, in the project's local timezone."""
    today_start = timezone.localtime().replace(
        hour=0, minute=0, second=0, microsecond=0
    )

    if period == YESTERDAY:
        return today_start - timedelta(days=1), today_start
    if period == LAST_7_DAYS:
        return today_start - timedelta(days=6), today_start + timedelta(days=1)
    return today_start, today_start + timedelta(days=1)
