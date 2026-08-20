from django.conf import settings
from django.contrib import admin
from django.db.models import QuerySet
from django.http import HttpRequest
from django.utils.html import format_html
from django.utils.translation import gettext_lazy as _
from unfold.admin import ModelAdmin, TabularInline

from apps.dashboard.formatting import format_fcfa
from apps.dashboard.period import PERIOD_CHOICES, resolve_period_range

from .models import Payment, Sale, SaleItem


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

    def has_add_permission(self, request, obj=None) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False


class SaleItemInline(ReadOnlyTabularInline):
    model = SaleItem
    fields = ("product_name", "unit_price", "quantity", "line_total")
    verbose_name = "article vendu"
    verbose_name_plural = "articles vendus"


class PaymentInline(ReadOnlyTabularInline):
    model = Payment
    fields = ("method", "amount", "received_amount", "change_amount")
    max_num = 1
    verbose_name = "paiement"
    verbose_name_plural = "paiement"


@admin.register(Sale)
class SaleAdmin(ReadOnlySalesAdmin):
    list_display = (
        "occurred_at",
        "id",
        "cash_session",
        "cashier",
        "total_display",
        "payment_method",
        "status",
    )
    list_filter = (
        SalePeriodFilter,
        "status",
        "cash_session__cash_register__store",
        "cash_session__cash_register",
        "cashier",
        "payment__method",
    )
    date_hierarchy = "occurred_at"
    search_fields = ("id", "cashier__username")
    readonly_fields = (
        "id",
        "cash_session",
        "cashier",
        "subtotal",
        "discount",
        "total",
        "status",
        "occurred_at",
        "created_at",
        "ticket_link",
    )
    fieldsets = (
        (
            None,
            {
                "fields": (
                    "id",
                    "cash_session",
                    "cashier",
                    "subtotal",
                    "discount",
                    "total",
                    "status",
                    "occurred_at",
                    "created_at",
                    "ticket_link",
                )
            },
        ),
    )
    inlines = (SaleItemInline, PaymentInline)

    def get_queryset(self, request: HttpRequest) -> QuerySet[Sale]:
        return (
            super()
            .get_queryset(request)
            .select_related("cash_session__cash_register", "cashier", "payment")
        )

    @admin.display(description=_("total"), ordering="total")
    def total_display(self, obj: Sale) -> str:
        return format_fcfa(obj.total)

    @admin.display(description=_("paiement"))
    def payment_method(self, obj: Sale) -> str:
        payment = getattr(obj, "payment", None)
        return payment.get_method_display() if payment else "—"

    @admin.display(description=_("ticket"))
    def ticket_link(self, obj: Sale) -> str:
        if not obj.pk:
            return "—"
        url = f"{settings.FRONTEND_URL}/sales/{obj.pk}/receipt"
        return format_html(
            '<a href="{}" target="_blank" rel="noopener" '
            'class="rounded-default bg-primary-600 text-white px-3 py-2 text-sm inline-block">'
            "{}</a>",
            url,
            _("Voir / imprimer le ticket"),
        )


@admin.register(SaleItem)
class SaleItemAdmin(ReadOnlySalesAdmin):
    list_display = ("sale", "product_name", "unit_price", "quantity", "line_total")
    search_fields = ("sale__id", "product_name", "product__barcode")


@admin.register(Payment)
class PaymentAdmin(ReadOnlySalesAdmin):
    list_display = ("created_at", "sale", "method", "amount", "change_amount")
    list_filter = ("method",)
    search_fields = ("sale__id",)
