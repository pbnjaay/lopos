from django import forms
from decimal import Decimal
from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import path, reverse
from unfold.admin import ModelAdmin
from unfold.decorators import action
from unfold.widgets import (
    UnfoldAdminDecimalFieldWidget,
    UnfoldAdminFileFieldWidget,
    UnfoldAdminIntegerFieldWidget,
    UnfoldAdminSelectWidget,
)

from apps.dashboard.admin_columns import money_column
from apps.dashboard.formatting import format_fcfa, format_quantity
from apps.inventory.exceptions import InvalidStockCost, InvalidStockQuantity
from apps.inventory.permissions import can_view_stock_costs
from apps.inventory.models import Stock
from apps.inventory.services import adjust_stock, receive_stock
from apps.observability import posthog_client
from apps.stores.models import Store

from .admin_summary import build_product_card
from .models import Product
from .services import import_products_from_csv


def _format_cost(cost: Decimal | None) -> str:
    return "inconnu" if cost is None else format_fcfa(cost)


class ProductAdminForm(forms.ModelForm):
    sale_unit = forms.ChoiceField(
        choices=Product.SaleUnit.choices,
        required=False,
        initial=Product.SaleUnit.UNIT,
        label="Unité de vente",
        widget=UnfoldAdminSelectWidget(),
    )
    initial_store = forms.ModelChoiceField(
        queryset=Store.objects.filter(is_active=True),
        required=False,
        label="Magasin",
        help_text="Requis si une quantité initiale est saisie.",
        widget=UnfoldAdminSelectWidget(),
    )
    initial_quantity = forms.DecimalField(
        required=False,
        min_value=0,
        decimal_places=3,
        initial=0,
        label="Quantité initiale",
        help_text="Laisser à 0 si vous n'ajoutez pas de stock maintenant.",
        widget=UnfoldAdminDecimalFieldWidget(attrs={"step": "0.001", "inputmode": "decimal"}),
    )

    class Meta:
        model = Product
        fields = "__all__"

    def clean(self):
        cleaned_data = super().clean()
        quantity = cleaned_data.get("initial_quantity") or 0
        store = cleaned_data.get("initial_store")

        if quantity > 0 and not store:
            self.add_error(
                "initial_store",
                "Sélectionnez un magasin pour enregistrer le stock initial.",
            )
        # Un stock initial entre au coût d'achat : sans lui, sa valeur et la
        # marge de ses ventes resteraient inconnues. 0 compte comme inconnu.
        if quantity > 0 and not cleaned_data.get("purchase_price"):
            self.add_error(
                "purchase_price",
                "Renseignez le prix d'achat pour valoriser le stock initial.",
            )

        return cleaned_data

    def clean_sale_unit(self):
        return self.cleaned_data.get("sale_unit") or Product.SaleUnit.UNIT


class ReceiveStockForm(forms.Form):
    store = forms.ModelChoiceField(
        queryset=Store.objects.filter(is_active=True),
        label="Magasin",
        widget=UnfoldAdminSelectWidget(),
    )
    quantity = forms.DecimalField(
        min_value=Decimal("0.001"), decimal_places=3,
        label="Quantité reçue",
        widget=UnfoldAdminDecimalFieldWidget(attrs={"step": "0.001", "inputmode": "decimal"}),
    )
    unit_cost = forms.DecimalField(
        min_value=0,
        max_digits=14,
        decimal_places=4,
        label="Coût d'achat unitaire (FCFA)",
        help_text=(
            "Prix payé au fournisseur pour une unité (ou un kg), pré-rempli avec "
            "le dernier prix d'achat. Il met à jour le coût moyen du stock."
        ),
        widget=UnfoldAdminDecimalFieldWidget(attrs={"step": "any", "inputmode": "decimal"}),
    )


class AdjustStockForm(forms.Form):
    store = forms.ModelChoiceField(
        queryset=Store.objects.filter(is_active=True),
        label="Magasin",
        widget=UnfoldAdminSelectWidget(),
    )
    counted_quantity = forms.DecimalField(
        min_value=0,
        decimal_places=3,
        label="Stock physique réel",
        help_text="Quantité réellement comptée en magasin.",
        widget=UnfoldAdminDecimalFieldWidget(attrs={"step": "0.001", "inputmode": "decimal"}),
    )


class ImportProductsForm(forms.Form):
    csv_file = forms.FileField(
        label="Fichier CSV",
        help_text=(
            "Colonnes attendues : barcode, name, purchase_price, selling_price, "
            "store, initial_stock. barcode, purchase_price, store et "
            "initial_stock sont optionnels."
        ),
        widget=UnfoldAdminFileFieldWidget(),
    )


@admin.register(Product)
class ProductAdmin(ModelAdmin):
    form = ProductAdminForm
    actions_list = ["import_products_view"]
    list_display = ("name", "barcode", "sale_unit", "selling_price_display", "is_active", "updated_at")

    selling_price_display = money_column("selling_price", "prix de vente")
    list_filter = ("sale_unit", "is_active")
    search_fields = ("name", "barcode")
    readonly_fields = ("id", "created_at", "updated_at")
    # Fiche d'un produit existant : stock, valeur et ventes en tête (voir
    # admin_summary), le formulaire en dessous pour modifier.
    change_form_outer_before_template = "admin/catalog/product_summary.html"

    def change_view(self, request, object_id, form_url="", extra_context=None):
        product = self.get_object(request, object_id)
        if product is not None:
            extra_context = {
                **(extra_context or {}),
                "product_card": build_product_card(
                    product, can_view_costs=can_view_stock_costs(request.user)
                ),
            }
        return super().change_view(request, object_id, form_url, extra_context)

    def get_fieldsets(self, request, obj=None):
        fieldsets = [
            (
                "Informations générales",
                {"fields": ("name", "sale_unit", "low_stock_threshold", "is_active")},
            ),
            ("Prix", {"fields": ("purchase_price", "selling_price")}),
        ]
        if obj is None:
            fieldsets.append(
                ("Stock initial", {"fields": ("initial_store", "initial_quantity")})
            )
        fieldsets.append(
            (
                "Code-barres",
                {
                    "fields": ("barcode",),
                    "description": (
                        "Scannez le code-barres en dernier : le scanner valide "
                        "automatiquement le formulaire."
                    ),
                },
            )
        )
        fieldsets.append(
            (
                "Métadonnées",
                {"fields": ("id", "created_at", "updated_at"), "classes": ("collapse",)},
            )
        )
        return fieldsets

    def get_form(self, request, obj=None, **kwargs):
        form = super().get_form(request, obj, **kwargs)
        if obj is not None:
            form.base_fields.pop("initial_store", None)
            form.base_fields.pop("initial_quantity", None)
        return form

    def save_model(self, request, obj, form, change):
        if change:
            super().save_model(request, obj, form, change)
            return

        quantity = form.cleaned_data.get("initial_quantity") or 0
        store = form.cleaned_data.get("initial_store")

        with transaction.atomic():
            super().save_model(request, obj, form, change)
            if quantity > 0:
                receive_stock(
                    store=store,
                    product=obj,
                    quantity=quantity,
                    unit_cost=obj.purchase_price,
                    created_by=request.user,
                )

        posthog_client.capture(
            str(request.user.pk),
            "product_created",
            {"product_id": str(obj.pk), "store_id": str(store.pk) if store else None},
        )
        if quantity > 0:
            posthog_client.capture(
                str(request.user.pk),
                "stock_received",
                {
                    "store_id": str(store.pk),
                    "product_id": str(obj.pk),
                    "quantity": quantity,
                },
            )
            self.message_user(
                request,
                f"{quantity} unités de {obj.name} enregistrées en stock initial "
                f"({store.name}). ",
                level=messages.SUCCESS,
            )

    def get_urls(self):
        custom_urls = [
            path(
                "<uuid:object_id>/receive-stock/",
                self.admin_site.admin_view(self.receive_stock_view),
                name="catalog_product_receive_stock",
            ),
            path(
                "<uuid:object_id>/adjust-stock/",
                self.admin_site.admin_view(self.adjust_stock_view),
                name="catalog_product_adjust_stock",
            ),
        ]
        return custom_urls + super().get_urls()

    def _get_product_for_stock_action(self, request, object_id):
        product = get_object_or_404(Product, pk=object_id)
        if not self.has_change_permission(request, product):
            raise PermissionDenied
        return product

    def _current_stocks(self, product):
        return (
            Stock.objects.filter(product=product)
            .select_related("store")
            .order_by("store__name")
        )

    def _render_stock_action_page(
        self,
        request,
        *,
        product,
        form,
        title,
        breadcrumb_label,
        fieldset_title,
        submit_label,
        template_name,
    ):
        context = self.admin_site.each_context(request)
        context.update(
            {
                "title": title,
                "breadcrumb_label": breadcrumb_label,
                "fieldset_title": fieldset_title,
                "submit_label": submit_label,
                "product": product,
                "stocks": self._current_stocks(product),
                "can_view_stock_costs": can_view_stock_costs(request.user),
                "form": form,
                "opts": Product._meta,
                "back_url": reverse(
                    "admin:catalog_product_change", args=[product.pk]
                ),
            }
        )
        return render(request, template_name, context)

    def receive_stock_view(self, request, object_id):
        product = self._get_product_for_stock_action(request, object_id)

        if request.method == "POST":
            form = ReceiveStockForm(request.POST)
            if form.is_valid():
                store = form.cleaned_data["store"]
                quantity = form.cleaned_data["quantity"]
                try:
                    result = receive_stock(
                        store=store,
                        product=product,
                        quantity=quantity,
                        unit_cost=form.cleaned_data["unit_cost"],
                        created_by=request.user,
                    )
                except InvalidStockQuantity as exc:
                    form.add_error("quantity", str(exc))
                except InvalidStockCost as exc:
                    form.add_error("unit_cost", str(exc))
                else:
                    posthog_client.capture(
                        str(request.user.pk),
                        "stock_received",
                        {
                            "store_id": str(store.pk),
                            "product_id": str(product.pk),
                            "quantity": quantity,
                        },
                    )
                    message = (
                        f"{quantity} unités de {product.name} ajoutées au stock de "
                        f"{store.name}. Nouveau stock : "
                        f"{format_quantity(result.stock.quantity, product.sale_unit)}"
                    )
                    if can_view_stock_costs(request.user):
                        message += (
                            f", coût moyen : {_format_cost(result.stock.average_unit_cost)}"
                        )
                    self.message_user(request, f"{message}.", level=messages.SUCCESS)
                    return redirect(
                        reverse("admin:catalog_product_change", args=[product.pk])
                    )
        else:
            form = ReceiveStockForm(initial={"unit_cost": product.purchase_price})

        return self._render_stock_action_page(
            request,
            product=product,
            form=form,
            title=f"Ajouter du stock — {product.name}",
            breadcrumb_label="Ajouter du stock",
            fieldset_title="Quantité reçue",
            submit_label="Ajouter",
            template_name="admin/catalog/receive_stock.html",
        )

    def adjust_stock_view(self, request, object_id):
        product = self._get_product_for_stock_action(request, object_id)

        if request.method == "POST":
            form = AdjustStockForm(request.POST)
            if form.is_valid():
                store = form.cleaned_data["store"]
                counted_quantity = form.cleaned_data["counted_quantity"]
                try:
                    result = adjust_stock(
                        store=store,
                        product=product,
                        counted_quantity=counted_quantity,
                        created_by=request.user,
                    )
                except InvalidStockQuantity as exc:
                    form.add_error("counted_quantity", str(exc))
                else:
                    if result.delta == 0:
                        message = (
                            f"Stock de {product.name} ({store.name}) déjà à jour : "
                            f"{counted_quantity}."
                        )
                    else:
                        message = (
                            f"Stock de {product.name} ({store.name}) ajusté : "
                            f"{result.previous_quantity} → {counted_quantity} "
                            f"({result.delta:+})."
                        )
                        posthog_client.capture(
                            str(request.user.pk),
                            "stock_adjusted",
                            {
                                "store_id": str(store.pk),
                                "product_id": str(product.pk),
                                "delta": result.delta,
                            },
                        )
                    self.message_user(request, message, level=messages.SUCCESS)
                    return redirect(
                        reverse("admin:catalog_product_change", args=[product.pk])
                    )
        else:
            form = AdjustStockForm()

        return self._render_stock_action_page(
            request,
            product=product,
            form=form,
            title=f"Ajuster le stock — {product.name}",
            breadcrumb_label="Ajuster le stock",
            fieldset_title="Stock physique réel",
            submit_label="Ajuster",
            template_name="admin/catalog/adjust_stock.html",
        )

    @action(
        description="Importer des produits",
        icon="upload",
        url_path="import-products",
        permissions=["add"],
    )
    def import_products_view(self, request):
        if request.method == "POST":
            form = ImportProductsForm(request.POST, request.FILES)
            if form.is_valid():
                result = import_products_from_csv(form.cleaned_data["csv_file"])
                if result.errors:
                    for error in result.errors:
                        form.add_error(None, f"Ligne {error.line} : {error.message}")
                else:
                    self.message_user(
                        request,
                        f"{result.created_count} produits importés avec succès.",
                        level=messages.SUCCESS,
                    )
                    return redirect(reverse("admin:catalog_product_changelist"))
        else:
            form = ImportProductsForm()

        context = self.admin_site.each_context(request)
        context.update(
            {
                "title": "Importer des produits",
                "form": form,
                "opts": Product._meta,
                "back_url": reverse("admin:catalog_product_changelist"),
            }
        )
        return render(request, "admin/catalog/import_products.html", context)
