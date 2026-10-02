from django.http import HttpRequest

from apps.observability import posthog_client
from apps.stores.models import Store
from apps.tenancy.admin_mixins import visible_store_ids

from .period import PERIOD_CHOICES, resolve_period
from .services import get_manager_dashboard

PROFITABILITY_PERMISSION = "sales.view_profitability"


def manager_dashboard_callback(request: HttpRequest, context: dict) -> dict:
    period = resolve_period(request.GET.get("period"))
    store_id = request.GET.get("store") or None
    # Les magasins du compte (tous pour la plateforme) : jamais plus, même
    # avec un `?store=` d'un autre commerce, simplement ignoré.
    allowed_store_ids = visible_store_ids(request)

    context["dashboard"] = get_manager_dashboard(
        period=period,
        store_id=store_id,
        date_from=request.GET.get("from"),
        date_to=request.GET.get("to"),
        include_profitability=request.user.has_perm(PROFITABILITY_PERMISSION),
        allowed_store_ids=allowed_store_ids,
    )
    context["dashboard_period_choices"] = PERIOD_CHOICES
    stores = Store.objects.filter(is_active=True)
    if allowed_store_ids is not None:
        stores = stores.filter(pk__in=allowed_store_ids)
    context["dashboard_stores"] = list(stores.order_by("name"))

    if request.user.is_authenticated:
        posthog_client.capture(
            str(request.user.pk),
            "dashboard_viewed",
            {"period": context["dashboard"].period, "store_id": context["dashboard"].store_id},
        )

    return context
