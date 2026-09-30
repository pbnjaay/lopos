from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from django.utils import timezone

TODAY = "today"
YESTERDAY = "yesterday"
LAST_7_DAYS = "7d"
CUSTOM = "custom"
DEFAULT_PERIOD = TODAY

PERIOD_CHOICES = (
    (TODAY, "Aujourd'hui"),
    (YESTERDAY, "Hier"),
    (LAST_7_DAYS, "7 derniers jours"),
)

_VALID_PERIODS = frozenset(value for value, _label in PERIOD_CHOICES)
# Une période libre reste un rapport de gestion, pas un export d'archives.
MAX_CUSTOM_DAYS = 366


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


def parse_custom_range(raw_from: str | None, raw_to: str | None) -> tuple[date, date] | None:
    """Deux dates « AAAA-MM-JJ », dans l'ordre, sur au plus un an ; sinon None."""
    try:
        date_from = date.fromisoformat(raw_from or "")
        date_to = date.fromisoformat(raw_to or "")
    except ValueError:
        return None
    if date_from > date_to or (date_to - date_from).days >= MAX_CUSTOM_DAYS:
        return None
    return date_from, date_to


def local_days_range(date_from: date, date_to: date) -> tuple[datetime, datetime]:
    """[début du premier jour, début du lendemain du dernier), heure locale."""
    start = timezone.make_aware(datetime.combine(date_from, time.min))
    end = timezone.make_aware(datetime.combine(date_to + timedelta(days=1), time.min))
    return start, end


@dataclass(frozen=True, slots=True)
class DashboardPeriod:
    """Période du tableau de bord : un préréglage, ou deux dates choisies."""

    key: str
    start: datetime
    end: datetime
    date_from: date | None = None
    date_to: date | None = None

    @property
    def is_custom(self) -> bool:
        return self.key == CUSTOM

    @property
    def label(self) -> str:
        if not self.is_custom:
            return dict(PERIOD_CHOICES)[self.key]
        if self.date_from == self.date_to:
            return f"le {self.date_from:%d/%m/%Y}"
        return f"du {self.date_from:%d/%m/%Y} au {self.date_to:%d/%m/%Y}"


def resolve_dashboard_period(
    period: str | None = None, raw_from: str | None = None, raw_to: str | None = None
) -> DashboardPeriod:
    """Deux dates valides l'emportent sur le préréglage ; sinon le préréglage
    demandé, ou aujourd'hui."""
    custom_range = parse_custom_range(raw_from, raw_to)
    if custom_range is not None:
        start, end = local_days_range(*custom_range)
        return DashboardPeriod(CUSTOM, start, end, *custom_range)
    key = resolve_period(period)
    return DashboardPeriod(key, *resolve_period_range(key))
