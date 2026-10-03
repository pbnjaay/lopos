import io
from urllib.parse import urlencode

from django import forms
from django.conf import settings
from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied
from django.db.models import F
from django.db.models.functions import Coalesce
from django.http import HttpRequest, HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import path, reverse
from django.utils import timezone
from django.utils.html import format_html
from django.utils.translation import gettext_lazy as _
from unfold.admin import ModelAdmin
from unfold.decorators import action, display
from unfold.widgets import UnfoldAdminDecimalFieldWidget, UnfoldAdminTextareaWidget

from apps.catalog.models import Product
from apps.dashboard.admin_columns import quantity_column, status_badge
from apps.dashboard.formatting import format_fcfa, format_quantity
from apps.stores.admin_mixins import SingleStoreColumnsMixin
from apps.stores.models import Store
from apps.tenancy.admin_mixins import TenantAdminMixin, visible_queryset

from .exceptions import InvalidStockCost
from .models import InventoryMovement, Stock, StockCostChange, StockValuation
from .permissions import SET_STOCK_COST_PERMISSION, can_view_stock_costs
from .services import set_stock_unit_cost
from .valuation import (
    annotate_stock_values,
    summarize_stock_valuation,
    write_stock_valuation_csv,
)


def default_low_stock_threshold() -> int:
    return getattr(settings, "LOW_STOCK_THRESHOLD_DEFAULT", 5)


def effective_low_stock_threshold(product: Product) -> int:
    """Seuil d'un produit donné : le sien s'il en a un, sinon le défaut."""
    if product.low_stock_threshold is not None:
        return product.low_stock_threshold
    return default_low_stock_threshold()


class StockStatusFilter(admin.SimpleListFilter):
    title = _("état du stock")
    parameter_name = "stock_status"

    def lookups(self, request, model_admin):
        return (
            ("low", _("Stock faible")),
            ("out", _("Rupture")),
        )

    def queryset(self, request, queryset):
        if self.value() == "low":
            return queryset.annotate(
                effective_threshold=Coalesce(
                    "product__low_stock_threshold", default_low_stock_threshold()
                )
            ).filter(quantity__gt=0, quantity__lte=F("effective_threshold"))
        if self.value() == "out":
            return queryset.filter(quantity__lte=0)
        return queryset


@admin.register(Stock)
class StockAdmin(SingleStoreColumnsMixin, TenantAdminMixin, ModelAdmin):
    list_display = ("product", "store", "quantity_display", "status_label", "updated_at")
    list_filter = ("store", StockStatusFilter)
    list_select_related = ("product", "store")
    search_fields = ("product__name", "product__barcode", "store__name")
    fields = ("id", "store", "product", "quantity_display", "updated_at")
    readonly_fields = fields

    quantity_display = quantity_column("quantity", "quantité", unit_field="product__sale_unit")
    autocomplete_fields = ("store", "product")

    @display(
        description=_("état"),
        label={"out": "danger", "low": "warning", "ok": "success"},
    )
    def status_label(self, obj: Stock):
        if obj.quantity <= 0:
            return "out", _("Rupture")
        if obj.quantity <= effective_low_stock_threshold(obj.product):
            return "low", _("Faible")
        return "ok", "OK"

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False


@admin.register(InventoryMovement)
class InventoryMovementAdmin(SingleStoreColumnsMixin, TenantAdminMixin, ModelAdmin):
    list_display = (
        "created_at",
        "movement_type",
        "store",
        "product",
        "quantity_display",
        "unit_cost_display",
        "created_by",
        "reference_display",
    )
    list_select_related = ("store", "product", "created_by")
    list_filter = ("movement_type", "store")
    search_fields = ("product__name", "product__barcode", "reference")
    # Fiche en lecture seule, champs figés : sinon Django y ajoute les champs
    # bruts du modèle (quantité « 6,000 », coût non formaté).
    fields = (
        "id",
        "store",
        "product",
        "movement_type",
        "quantity_display",
        "unit_cost_display",
        "reference_display",
        "created_by",
        "created_at",
    )
    readonly_fields = fields

    @admin.display(description=_("origine"))
    def reference_display(self, obj: InventoryMovement) -> str:
        """La vente ou le retour à l'origine du mouvement, sous la référence
        imprimée sur le ticket — sans requête : elle se lit dans l'identifiant."""
        if obj.reference is None:
            return "—"
        short = str(obj.reference)[:8].upper()
        if obj.movement_type in (InventoryMovement.Type.SALE, InventoryMovement.Type.CANCELLATION):
            url = reverse("admin:sales_sale_change", args=[obj.reference])
            label = f"Ticket {short}"
        elif obj.movement_type == InventoryMovement.Type.RETURN_IN:
            url = reverse("admin:sales_salereturn_change", args=[obj.reference])
            label = f"RET-{short}"
        else:
            return "—"
        return format_html('<a href="{}" class="text-primary-600">{}</a>', url, label)

    @admin.display(description=_("quantité"), ordering="quantity")
    def quantity_display(self, obj: InventoryMovement) -> str:
        # Entrée « +20 », sortie « -2 kg » : le signe dit le sens du mouvement.
        text = format_quantity(obj.quantity, obj.product.sale_unit)
        return f"+{text}" if obj.quantity > 0 else text

    @admin.display(description=_("coût unitaire"), ordering="unit_cost")
    def unit_cost_display(self, obj: InventoryMovement) -> str:
        return _format_cost(obj.unit_cost)

    # Le coût d'un mouvement suit la permission de la valorisation.
    def get_list_display(self, request):
        list_display = super().get_list_display(request)
        if can_view_stock_costs(request.user):
            return list_display
        return tuple(name for name in list_display if name != "unit_cost_display")

    def get_fields(self, request, obj=None):
        fields = super().get_fields(request, obj)
        if can_view_stock_costs(request.user):
            return fields
        return [name for name in fields if name != "unit_cost_display"]

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False


# --- Valorisation du stock ----------------------------------------------------


def _format_cost(value) -> str:
    return "—" if value is None else format_fcfa(value)


class ValuationStatusFilter(admin.SimpleListFilter):
    title = _("état")
    parameter_name = "valuation"

    def lookups(self, request, model_admin):
        return (
            ("in_stock", _("En stock")),
            ("out", _("Rupture")),
            ("uncosted", _("Coût inconnu")),
            ("negative", _("Stock négatif")),
        )

    def queryset(self, request, queryset):
        if self.value() == "in_stock":
            return queryset.filter(quantity__gt=0)
        if self.value() == "out":
            return queryset.filter(quantity__lte=0)
        if self.value() == "uncosted":
            return queryset.filter(quantity__gt=0, average_unit_cost__isnull=True)
        if self.value() == "negative":
            return queryset.filter(quantity__lt=0)
        return queryset


class SetStockCostForm(forms.Form):
    unit_cost = forms.DecimalField(
        min_value=0,
        max_digits=14,
        decimal_places=4,
        label="Coût d'achat unitaire (FCFA)",
        help_text="Prix d'achat d'une unité (ou d'un kg) de ce produit dans ce magasin.",
        widget=UnfoldAdminDecimalFieldWidget(attrs={"step": "any", "inputmode": "decimal"}),
    )
    reason = forms.CharField(
        required=False,
        label="Motif",
        widget=UnfoldAdminTextareaWidget(attrs={"rows": 2}),
        help_text=(
            "Obligatoire pour corriger un coût déjà connu. "
            "Ex. « Facture fournisseur retrouvée »."
        ),
    )


@admin.register(StockValuation)
class StockValuationAdmin(SingleStoreColumnsMixin, TenantAdminMixin, ModelAdmin):
    """Ce que vaut la marchandise en rayon, produit par produit.

    Lecture seule : le coût moyen ne change que par une réception ou par
    l'action « Définir le coût », toujours tracée."""

    list_display = (
        "product",
        "store",
        "quantity_display",
        "average_cost_display",
        "cost_value_display",
        "selling_price_display",
        "sale_value_display",
        "potential_margin_display",
    )
    list_filter = ("store", ValuationStatusFilter)
    list_select_related = ("product", "store")
    search_fields = ("product__name", "product__barcode")
    list_per_page = 50
    list_before_template = "admin/inventory/stock_valuation_summary.html"
    actions_row = ["set_cost_action"]

    quantity_display = quantity_column("quantity", "stock", unit_field="product__sale_unit")

    def get_queryset(self, request):
        return annotate_stock_values(super().get_queryset(request))

    def get_ordering(self, request):
        # Les plus grosses valeurs d'abord ; les coûts inconnus en fin de liste.
        return [F("cost_value").desc(nulls_last=True), "product__name"]

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False

    def has_set_cost_permission(self, request: HttpRequest, object_id=None) -> bool:
        return request.user.has_perm(SET_STOCK_COST_PERMISSION)

    @admin.display(description=_("coût moyen"), ordering="average_unit_cost")
    def average_cost_display(self, obj: Stock) -> str:
        if obj.average_unit_cost is None:
            return format_html('<span class="text-base-400 dark:text-base-500">{}</span>', _("Inconnu"))
        return format_fcfa(obj.average_unit_cost)

    @admin.display(description=_("valeur d'achat"), ordering="cost_value")
    def cost_value_display(self, obj: Stock) -> str:
        return _format_cost(obj.cost_value)

    @admin.display(description=_("prix de vente"), ordering="product__selling_price")
    def selling_price_display(self, obj: Stock) -> str:
        return format_fcfa(obj.product.selling_price)

    @admin.display(description=_("valeur de vente"), ordering="sale_value")
    def sale_value_display(self, obj: Stock) -> str:
        return format_fcfa(obj.sale_value)

    @admin.display(description=_("marge potentielle"), ordering="potential_margin")
    def potential_margin_display(self, obj: Stock) -> str:
        return _format_cost(obj.potential_margin)

    def changelist_view(self, request: HttpRequest, extra_context=None) -> HttpResponse:
        response = super().changelist_view(request, extra_context)
        context = getattr(response, "context_data", None)
        if not context or "cl" not in context:
            return response

        # Les indicateurs suivent exactement la liste filtrée (magasin,
        # recherche, état) — une seule agrégation.
        store_id = request.GET.get("store__id__exact")
        store = (
            visible_queryset(Store, request).filter(pk=store_id).first() if store_id else None
        )
        base_url = reverse("admin:inventory_stockvaluation_changelist")
        store_query = {"store__id__exact": store.pk} if store else {}
        context.update(
            {
                "valuation": summarize_stock_valuation(context["cl"].queryset),
                # Jamais d'agrégation implicite : le périmètre est toujours écrit.
                "valuation_scope": store.name if store else _("Tous les magasins"),
                "valuation_uncosted_url": (
                    f"{base_url}?{urlencode({**store_query, 'valuation': 'uncosted'})}"
                ),
                "valuation_negative_url": (
                    f"{base_url}?{urlencode({**store_query, 'valuation': 'negative'})}"
                ),
                # Même filtres, même tri que la liste affichée.
                "valuation_export_url": (
                    f"{reverse('admin:inventory_stockvaluation_export')}"
                    f"?{request.GET.urlencode()}"
                ),
            }
        )
        return response

    def get_urls(self):
        return [
            path(
                "export-csv/",
                self.admin_site.admin_view(self.export_csv_view),
                name="inventory_stockvaluation_export",
            ),
            *super().get_urls(),
        ]

    def export_csv_view(self, request: HttpRequest) -> HttpResponse:
        """La liste filtrée, toutes pages confondues, en CSV."""
        if not self.has_view_permission(request):
            raise PermissionDenied
        changelist = self.get_changelist_instance(request)
        stocks = changelist.queryset.select_related("product", "store")

        output = io.StringIO()
        write_stock_valuation_csv(stocks.iterator(chunk_size=500), output)
        filename = f"valorisation-stock-{timezone.localdate():%Y-%m-%d}.csv"
        response = HttpResponse(output.getvalue(), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    @action(
        description=_("Définir le coût"),
        icon="price_change",
        url_path="definir-cout",
        permissions=["set_cost"],
    )
    def set_cost_action(self, request: HttpRequest, object_id: str) -> HttpResponse:
        if not request.user.has_perm(SET_STOCK_COST_PERMISSION):
            raise PermissionDenied
        stock = get_object_or_404(
            visible_queryset(Stock, request).select_related("product", "store"), pk=object_id
        )
        back_url = reverse("admin:inventory_stockvaluation_changelist")

        initial_cost = stock.average_unit_cost or stock.product.purchase_price or None
        form = SetStockCostForm(request.POST or None, initial={"unit_cost": initial_cost})
        if request.method == "POST" and form.is_valid():
            unit_cost = form.cleaned_data["unit_cost"]
            reason = form.cleaned_data["reason"].strip()
            is_correction = stock.average_unit_cost not in (None, unit_cost)
            if is_correction and not reason:
                form.add_error("reason", "Indiquez le motif de la correction du coût.")
            else:
                try:
                    change = set_stock_unit_cost(
                        stock_id=stock.pk,
                        unit_cost=unit_cost,
                        reason=reason,
                        created_by=request.user,
                    )
                except InvalidStockCost as exc:
                    form.add_error("unit_cost", str(exc))
                else:
                    return self._cost_set_redirect(request, stock, change, back_url)

        context = self.admin_site.each_context(request)
        context.update(
            {
                "title": f"Définir le coût — {stock.product.name}",
                "stock": stock,
                "current_cost": _format_cost(stock.average_unit_cost),
                "is_correction": stock.average_unit_cost is not None,
                "form": form,
                "opts": StockValuation._meta,
                "back_url": back_url,
            }
        )
        return render(request, "admin/inventory/set_stock_cost.html", context)

    def _cost_set_redirect(self, request, stock, change, back_url) -> HttpResponse:
        if change is None:
            message = f"Coût de {stock.product.name} ({stock.store.name}) inchangé."
        else:
            message = (
                f"Coût de {stock.product.name} ({stock.store.name}) : "
                f"{_format_cost(change.previous_cost)} → {format_fcfa(change.new_cost)}."
            )
        self.message_user(request, message, level=messages.SUCCESS)
        return redirect(back_url)


@admin.register(StockCostChange)
class StockCostChangeAdmin(SingleStoreColumnsMixin, TenantAdminMixin, ModelAdmin):
    """Journal des coûts définis à la main : consultable, jamais modifiable."""

    list_display = (
        "created_at",
        "store",
        "product",
        "source_display",
        "previous_cost_display",
        "new_cost_display",
        "quantity_at_change_display",
        "reason",
        "created_by",
    )
    list_filter = ("source", "store")
    list_select_related = ("store", "product", "created_by")
    search_fields = ("product__name", "product__barcode", "reason")
    fields = (
        "id",
        "store",
        "product",
        "source",
        "previous_cost_display",
        "new_cost_display",
        "quantity_at_change_display",
        "reason",
        "created_by",
        "created_at",
    )
    readonly_fields = fields

    source_display = status_badge(
        "source", "origine", {"INITIAL": "info", "CORRECTION": "warning"}
    )
    quantity_at_change_display = quantity_column(
        "quantity_at_change", "stock au moment du changement", unit_field="product__sale_unit"
    )

    @admin.display(description=_("ancien coût"), ordering="previous_cost")
    def previous_cost_display(self, obj: StockCostChange) -> str:
        return _format_cost(obj.previous_cost)

    @admin.display(description=_("nouveau coût"), ordering="new_cost")
    def new_cost_display(self, obj: StockCostChange) -> str:
        return format_fcfa(obj.new_cost)

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False
