from django.contrib import admin
from django.utils.translation import gettext_lazy as _
from unfold.admin import ModelAdmin

from apps.dashboard.admin_columns import money_column, render_badge, status_badge
from apps.dashboard.formatting import format_fcfa

from .admin_summary import build_session_z
from .models import CashSession


@admin.register(CashSession)
class CashSessionAdmin(ModelAdmin):
    list_display = (
        "opened_at",
        "cash_register",
        "cashier",
        "opening_balance_display",
        "status_display",
        "closing_balance_display",
        "difference_label",
        "closed_at",
    )
    list_filter = ("status", "cash_register__store", "cash_register", "cashier", "opened_at")
    search_fields = (
        "cash_register__name",
        "cash_register__store__name",
        "cashier__username",
    )
    date_hierarchy = "opened_at"
    readonly_fields = (
        "id",
        "cash_register",
        "cashier",
        "opening_balance_display",
        "status_display",
        "opened_at",
        "closing_balance_display",
        "expected_balance_display",
        "difference_label",
        "closed_at",
    )
    # Fiche lue comme le rapport Z (voir admin_summary) ; le reste est replié.
    change_form_outer_before_template = "admin/cash/cashsession_summary.html"
    fieldsets = (
        (
            _("Détails"),
            {
                "fields": ("cash_register", "cashier", "opened_at", "closed_at"),
                "classes": ("collapse",),
            },
        ),
    )

    def change_view(self, request, object_id, form_url="", extra_context=None):
        session = self.get_object(request, object_id)
        if session is not None:
            extra_context = {**(extra_context or {}), "z": build_session_z(session)}
        return super().change_view(request, object_id, form_url, extra_context)

    def get_queryset(self, request):
        return (
            super()
            .get_queryset(request)
            .select_related("cash_register", "cash_register__store", "cashier")
        )

    @admin.display(description=_("fond initial"), ordering="opening_balance")
    def opening_balance_display(self, obj: CashSession) -> str:
        return format_fcfa(obj.opening_balance)

    expected_balance_display = money_column("expected_balance", "attendu")

    @admin.display(description=_("compté"), ordering="closing_balance")
    def closing_balance_display(self, obj: CashSession) -> str:
        return format_fcfa(obj.closing_balance) if obj.closing_balance is not None else "—"

    status_display = status_badge("status", "statut", {"OPEN": "info"})

    @admin.display(description=_("écart"), ordering="difference")
    def difference_label(self, obj: CashSession) -> str:
        # Session ouverte : pas encore d'écart, un simple tiret plutôt
        # qu'une pastille vide.
        if obj.difference is None:
            return "—"
        if obj.difference == 0:
            return render_badge("OK — 0 FCFA", "success")
        if obj.difference > 0:
            return render_badge(f"{_('Surplus')} — {format_fcfa(obj.difference)}", "warning")
        # « Manque » dit déjà le signe : pas de « Manque — -1 500 FCFA ».
        return render_badge(f"{_('Manque')} — {format_fcfa(abs(obj.difference))}", "danger")

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False
