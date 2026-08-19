from django import forms
from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import path, reverse
from django.utils.html import format_html, format_html_join
from unfold.admin import ModelAdmin
from unfold.widgets import UnfoldAdminIntegerFieldWidget, UnfoldAdminSelectWidget

from apps.inventory.exceptions import InvalidStockQuantity
from apps.inventory.models import Stock
from apps.inventory.services import receive_stock
from apps.stores.models import Store

from .models import Product


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


@admin.register(Product)
class ProductAdmin(ModelAdmin):
    form = ProductAdminForm
    list_display = ("name", "barcode", "selling_price", "is_active", "updated_at")
    list_filter = ("is_active",)
    search_fields = ("name", "barcode")
    readonly_fields = (
        "id",
        "created_at",
        "updated_at",
        "stocks_overview",
        "receive_stock_action",
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
                ("Stocks", {"fields": ("stocks_overview", "receive_stock_action")})
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

    @admin.display(description="Réapprovisionnement")
    def receive_stock_action(self, obj):
        if obj is None or not obj.pk:
            return "-"

        url = reverse("admin:catalog_product_receive_stock", args=[obj.pk])
        return format_html('<a href="{}" class="button">+ Ajouter du stock</a>', url)

    def get_urls(self):
        custom_urls = [
            path(
                "<uuid:object_id>/receive-stock/",
                self.admin_site.admin_view(self.receive_stock_view),
                name="catalog_product_receive_stock",
            ),
        ]
        return custom_urls + super().get_urls()

    def receive_stock_view(self, request, object_id):
        product = get_object_or_404(Product, pk=object_id)

        if not self.has_change_permission(request, product):
            raise PermissionDenied

        stocks = (
            Stock.objects.filter(product=product)
            .select_related("store")
            .order_by("store__name")
        )

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

        context = self.admin_site.each_context(request)
        context.update(
            {
                "title": f"Ajouter du stock — {product.name}",
                "product": product,
                "stocks": stocks,
                "form": form,
                "opts": Product._meta,
                "back_url": reverse(
                    "admin:catalog_product_change", args=[product.pk]
                ),
            }
        )
        return render(request, "admin/catalog/receive_stock.html", context)
