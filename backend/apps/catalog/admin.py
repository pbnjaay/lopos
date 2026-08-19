from django import forms
from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import path, reverse
from django.utils.html import format_html, format_html_join
from unfold.admin import ModelAdmin
from unfold.decorators import action
from unfold.widgets import (
    UnfoldAdminFileFieldWidget,
    UnfoldAdminIntegerFieldWidget,
    UnfoldAdminSelectWidget,
)

from apps.inventory.exceptions import InvalidStockQuantity
from apps.inventory.models import Stock
from apps.inventory.services import adjust_stock, receive_stock
from apps.stores.models import Store

from .models import Product
from .services import import_products_from_csv


class ProductAdminForm(forms.ModelForm):
    initial_store = forms.ModelChoiceField(
        queryset=Store.objects.filter(is_active=True),
        required=False,
        label="Magasin",
        help_text="Requis si une quantité initiale est saisie.",
        widget=UnfoldAdminSelectWidget(),
    )
    initial_quantity = forms.IntegerField(
        required=False,
        min_value=0,
        initial=0,
        label="Quantité initiale",
        help_text="Laisser à 0 si vous n'ajoutez pas de stock maintenant.",
        widget=UnfoldAdminIntegerFieldWidget(),
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

        return cleaned_data


class ReceiveStockForm(forms.Form):
    store = forms.ModelChoiceField(
        queryset=Store.objects.filter(is_active=True),
        label="Magasin",
        widget=UnfoldAdminSelectWidget(),
    )
    quantity = forms.IntegerField(
        min_value=1,
        label="Quantité reçue",
        widget=UnfoldAdminIntegerFieldWidget(),
    )


class AdjustStockForm(forms.Form):
    store = forms.ModelChoiceField(
        queryset=Store.objects.filter(is_active=True),
        label="Magasin",
        widget=UnfoldAdminSelectWidget(),
    )
    counted_quantity = forms.IntegerField(
        min_value=0,
        label="Stock physique réel",
        help_text="Quantité réellement comptée en magasin.",
        widget=UnfoldAdminIntegerFieldWidget(),
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
    list_display = ("name", "barcode", "selling_price", "is_active", "updated_at")
    list_filter = ("is_active",)
    search_fields = ("name", "barcode")
    readonly_fields = (
        "id",
        "created_at",
        "updated_at",
        "stocks_overview",
        "stock_actions",
    )

    def get_fieldsets(self, request, obj=None):
        fieldsets = [
            ("Informations générales", {"fields": ("name", "barcode", "is_active")}),
            ("Prix", {"fields": ("purchase_price", "selling_price")}),
        ]
        if obj is None:
            fieldsets.append(
                ("Stock initial", {"fields": ("initial_store", "initial_quantity")})
            )
        else:
            fieldsets.append(
                ("Stocks", {"fields": ("stocks_overview", "stock_actions")})
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
                receive_stock(store=store, product=obj, quantity=quantity)

        if quantity > 0:
            self.message_user(
                request,
                f"{quantity} unités de {obj.name} enregistrées en stock initial "
                f"({store.name}). ",
                level=messages.SUCCESS,
            )

    @admin.display(description="Stocks par magasin")
    def stocks_overview(self, obj):
        if obj is None or not obj.pk:
            return "Enregistrez le produit pour voir ses stocks."

        stocks = (
            Stock.objects.filter(product=obj)
            .select_related("store")
            .order_by("store__name")
        )
        if not stocks:
            return "Aucun stock enregistré pour ce produit."

        rows = format_html_join(
            "",
            "<tr><td style='padding:4px 16px 4px 0'>{}</td>"
            "<td style='padding:4px'>{}</td></tr>",
            ((stock.store.name, stock.quantity) for stock in stocks),
        )
        return format_html("<table>{}</table>", rows)

    @admin.display(description="Actions de stock")
    def stock_actions(self, obj):
        if obj is None or not obj.pk:
            return "-"

        receive_url = reverse("admin:catalog_product_receive_stock", args=[obj.pk])
        adjust_url = reverse("admin:catalog_product_adjust_stock", args=[obj.pk])

        button_base = (
            "font-medium inline-flex items-center gap-2 rounded-default "
            "justify-center whitespace-nowrap cursor-pointer px-3 py-2 text-sm"
        )
        button_primary = (
            f"{button_base} border border-transparent bg-primary-600 text-white "
            "hover:bg-primary-600/80"
        )
        button_default = (
            f"{button_base} border border-base-200 bg-white shadow-xs text-important "
            "hover:bg-base-100/80 dark:border-base-700 dark:bg-transparent "
            "dark:hover:bg-base-800/80"
        )

        return format_html(
            '<div class="flex gap-2">'
            '<a href="{}" class="{}">'
            '<span class="material-symbols-outlined text-base">add</span>'
            "Ajouter du stock</a>"
            '<a href="{}" class="{}">'
            '<span class="material-symbols-outlined text-base">tune</span>'
            "Ajuster le stock</a>"
            "</div>",
            receive_url,
            button_primary,
            adjust_url,
            button_default,
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
                        store=store, product=product, quantity=quantity
                    )
                except InvalidStockQuantity as exc:
                    form.add_error("quantity", str(exc))
                else:
                    self.message_user(
                        request,
                        f"{quantity} unités de {product.name} ajoutées au stock de "
                        f"{store.name}. Nouveau stock : {result.stock.quantity}.",
                        level=messages.SUCCESS,
                    )
                    return redirect(
                        reverse("admin:catalog_product_change", args=[product.pk])
                    )
        else:
            form = ReceiveStockForm()

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
                            f"({result.delta:+d})."
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
