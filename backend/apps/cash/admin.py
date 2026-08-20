from django.conf import settings
from django.contrib import admin
from django.utils.html import format_html, format_html_join
from django.utils.translation import gettext_lazy as _
from unfold.admin import ModelAdmin

from apps.dashboard.formatting import format_fcfa

from .models import CashSession
from .services import get_cash_session_summary


@admin.register(CashSession)
class CashSessionAdmin(ModelAdmin):
    list_display = (
        "opened_at",
        "cash_register",
        "cashier",
        "opening_balance_display",
        "status",
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
        "opening_balance",
        "status",
        "opened_at",
        "closing_balance",
        "expected_balance",
        "difference",
        "closed_at",
        "sales_summary",
        "report_link",
    )
    fieldsets = (
        (
            None,
            {
                "fields": (
                    "id",
                    "cash_register",
                    "cashier",
                    "status",
                    "opened_at",
                    "closed_at",
                )
            },
        ),
        (
            _("Ventes de la session"),
            {"fields": ("sales_summary",)},
        ),
        (
            _("Caisse"),
            {
                "fields": (
                    "opening_balance",
                    "expected_balance",
                    "closing_balance",
                    "difference",
                )
            },
        ),
        (
            _("Rapport Z"),
            {"fields": ("report_link",)},
        ),
    )

    def get_queryset(self, request):
        return (
            super()
            .get_queryset(request)
            .select_related("cash_register", "cash_register__store", "cashier")
        )

    @admin.display(description=_("fond initial"), ordering="opening_balance")
    def opening_balance_display(self, obj: CashSession) -> str:
        return format_fcfa(obj.opening_balance)

    @admin.display(description=_("compté"), ordering="closing_balance")
    def closing_balance_display(self, obj: CashSession) -> str:
        return format_fcfa(obj.closing_balance) if obj.closing_balance is not None else "—"

    @admin.display(description=_("écart"), ordering="difference")
    def difference_label(self, obj: CashSession) -> str:
        if obj.difference is None:
            return "—"
        if obj.difference == 0:
            return "OK — 0 FCFA"
        label = _("Surplus") if obj.difference > 0 else _("Manque")
        return f"{label} — {format_fcfa(obj.difference)}"

    @admin.display(description=_("détail des ventes"))
    def sales_summary(self, obj: CashSession) -> str:
        if not obj.pk:
            return "—"
        summary = get_cash_session_summary(cash_session=obj)
        rows = (
            (_("Nombre de ventes"), summary.sales_count),
            (_("CA total"), format_fcfa(summary.gross_sales)),
            (_("Espèces"), format_fcfa(summary.cash_sales)),
            (_("Wave"), format_fcfa(summary.wave_sales)),
            (_("Orange Money"), format_fcfa(summary.orange_money_sales)),
        )
        return format_html(
            "<table class='min-w-full text-sm'>{}</table>",
            format_html_join(
                "",
                "<tr><td class='pr-6 text-base-500'>{}</td><td class='font-medium'>{}</td></tr>",
                rows,
            ),
        )

    @admin.display(description=_("rapport Z"))
    def report_link(self, obj: CashSession) -> str:
        if not obj.pk or obj.status != CashSession.Status.CLOSED:
            return _("Disponible une fois la session clôturée.")
        url = f"{settings.FRONTEND_URL}/cash-sessions/{obj.pk}/report"
        return format_html(
            '<a href="{}" target="_blank" rel="noopener" '
            'class="rounded-default bg-primary-600 text-white px-3 py-2 text-sm inline-block">'
            "{}</a>",
            url,
            _("Voir / imprimer le rapport Z"),
        )

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False
