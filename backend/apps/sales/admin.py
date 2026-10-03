import re

from django.contrib import admin
from django.db.models import QuerySet
from django.http import HttpRequest
from django.utils.translation import gettext_lazy as _
from unfold.admin import ModelAdmin, TabularInline

from apps.dashboard.admin_columns import money_column, quantity_column, status_badge
from apps.dashboard.period import PERIOD_CHOICES, resolve_period_range

from .admin_summary import build_sale_ticket
from .models import Payment, Sale, SaleItem, SaleReturn, SaleReturnItem


class SalePeriodFilter(admin.SimpleListFilter):
    title = _("période")
    parameter_name = "period"

    def lookups(self, request, model_admin):
        return PERIOD_CHOICES

    def queryset(self, request, queryset):
        if self.value() not in dict(PERIOD_CHOICES):
            return queryset
        start, end = resolve_period_range(self.value())
        return queryset.filter(occurred_at__gte=start, occurred_at__lt=end)


class ReadOnlySalesAdmin(ModelAdmin):
    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False


class ReadOnlyTabularInline(TabularInline):
    extra = 0
    can_delete = False
    # Les colonnes disent déjà tout : pas de titre « Pain × 1 » au-dessus
    # de chaque ligne.
    hide_title = True

    def has_add_permission(self, request, obj=None) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False


class SaleReturnItemInline(ReadOnlyTabularInline):
    model = SaleReturnItem
    fields = (
        "original_sale_item",
        "quantity_display",
        "unit_price_display",
        "refund_amount_display",
        "restock",
    )
    readonly_fields = fields

    quantity_display = quantity_column(
        "quantity", "quantité", unit_field="original_sale_item__sale_unit"
    )
    unit_price_display = money_column("unit_price", "prix remboursé")
    refund_amount_display = money_column("refund_amount", "montant remboursé")


@admin.register(Sale)
class SaleAdmin(ReadOnlySalesAdmin):
    list_display = (
        "occurred_at",
        "reference_display",
        "cash_session",
        "cashier",
        "total_display",
        "payment_method",
        "status_display",
    )
    list_filter = (
        SalePeriodFilter,
        "status",
        "cash_session__cash_register__store",
        "cash_session__cash_register",
        "cashier",
        "payments__method",
    )
    date_hierarchy = "occurred_at"
    search_fields = ("id", "cashier__username")
    search_help_text = _("Numéro de ticket (ex. E15F6488) ou caissier")
    # Fiche lue comme le ticket du POS (voir admin_summary) ; le reste, rarement
    # utile, est replié.
    change_form_outer_before_template = "admin/sales/sale_summary.html"
    readonly_fields = ("cash_session", "customer", "occurred_at", "created_at")
    fieldsets = (
        (
            _("Détails"),
            {"fields": readonly_fields, "classes": ("collapse",)},
        ),
    )

    def change_view(self, request, object_id, form_url="", extra_context=None):
        sale = self.get_object(request, object_id)
        if sale is not None:
            extra_context = {**(extra_context or {}), "ticket": build_sale_ticket(sale)}
        return super().change_view(request, object_id, form_url, extra_context)

    def get_queryset(self, request: HttpRequest) -> QuerySet[Sale]:
        return (
            super()
            .get_queryset(request)
            .select_related("cash_session__cash_register", "cashier", "customer")
            .prefetch_related("returns", "payments")
            # `payments__method` dans list_filter joint la table des
            # paiements : sans distinct(), une vente à paiement mixte
            # (plusieurs méthodes) apparaîtrait plusieurs fois dans la liste.
            .distinct()
        )

    @admin.display(description=_("ticket"))
    def reference_display(self, obj: Sale) -> str:
        return obj.reference

    def get_search_results(self, request, queryset, search_term):
        # « Ticket E15F6488 » tel qu'imprimé : seul le numéro compte.
        search_term = re.sub(r"^\s*ticket\s*", "", search_term, flags=re.IGNORECASE)
        return super().get_search_results(request, queryset, search_term)

    status_display = status_badge(
        "status", "statut", {"COMPLETED": "success", "CANCELLED": "danger"}
    )
    total_display = money_column("total", "total")

    @admin.display(description=_("paiement"))
    def payment_method(self, obj: Sale) -> str:
        methods = [payment.get_method_display() for payment in obj.payments.all()]
        if obj.credit_amount:
            methods.append("Cahier")
        return " + ".join(methods) if methods else "—"


@admin.register(SaleItem)
class SaleItemAdmin(ReadOnlySalesAdmin):
    list_display = ("sale", "product_name", "unit_price_display", "quantity_display", "line_total_display")
    search_fields = ("sale__id", "product_name", "product__barcode")

    unit_price_display = money_column("unit_price", "prix unitaire")
    quantity_display = quantity_column("quantity", "quantité")
    line_total_display = money_column("line_total", "total de la ligne")


@admin.register(Payment)
class PaymentAdmin(ReadOnlySalesAdmin):
    list_display = ("created_at", "sale", "method", "amount_display", "change_amount_display")
    list_filter = ("method",)
    search_fields = ("sale__id",)

    amount_display = money_column("amount", "montant")
    change_amount_display = money_column("change_amount", "monnaie rendue")


@admin.register(SaleReturn)
class SaleReturnAdmin(ReadOnlySalesAdmin):
    list_display = (
        "reference",
        "created_at",
        "original_sale",
        "cash_session",
        "created_by",
        "total_refund_display",
        "credit_reduction_display",
        "payment_method",
    )
    list_filter = ("payment_method", "cash_session__cash_register__store")
    search_fields = ("reference", "original_sale__id", "created_by__username")
    fields = (
        "reference",
        "original_sale",
        "cash_session",
        "created_by",
        "created_at",
        "total_refund_display",
        "credit_reduction_display",
        "money_refund_display",
        "payment_method",
        "status",
    )
    readonly_fields = fields
    inlines = (SaleReturnItemInline,)

    total_refund_display = money_column("total_refund", "valeur retournée")
    credit_reduction_display = money_column("credit_reduction", "déduit du cahier")
    money_refund_display = money_column("money_refund", "argent rendu")


@admin.register(SaleReturnItem)
class SaleReturnItemAdmin(ReadOnlySalesAdmin):
    list_display = (
        "sale_return",
        "original_sale_item",
        "quantity_display",
        "unit_price_display",
        "refund_amount_display",
        "restock",
    )

    quantity_display = quantity_column(
        "quantity", "quantité", unit_field="original_sale_item__sale_unit"
    )
    unit_price_display = money_column("unit_price", "prix remboursé")
    refund_amount_display = money_column("refund_amount", "montant remboursé")
