from django.http import HttpRequest

from apps.observability import posthog_client
from apps.stores.models import Store

from .period import PERIOD_CHOICES, resolve_period
from .services import get_manager_dashboard

PROFITABILITY_PERMISSION = "sales.view_profitability"


def manager_dashboard_callback(request: HttpRequest, context: dict) -> dict:
    period = resolve_period(request.GET.get("period"))
    store_id = request.GET.get("store") or None

    context["dashboard"] = get_manager_dashboard(
        period=period,
        store_id=store_id,
        date_from=request.GET.get("from"),
        date_to=request.GET.get("to"),
        include_profitability=request.user.has_perm(PROFITABILITY_PERMISSION),
    )
    context["dashboard_period_choices"] = PERIOD_CHOICES
    context["dashboard_stores"] = list(Store.objects.filter(is_active=True).order_by("name"))

    if request.user.is_authenticated:
        posthog_client.capture(
            str(request.user.pk),
            "dashboard_viewed",
            {"period": context["dashboard"].period, "store_id": store_id},
        )

    return context
