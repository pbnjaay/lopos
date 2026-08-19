from django import forms
from django.contrib import admin, messages
from django.db import transaction
from unfold.admin import ModelAdmin

from apps.inventory.services import receive_stock
from apps.stores.models import Store

from .models import Product


class ProductAdminForm(forms.ModelForm):
    initial_store = forms.ModelChoiceField(
        queryset=Store.objects.filter(is_active=True),
        required=False,
        label="Magasin",
        help_text="Requis si une quantité initiale est saisie.",
    )
    initial_quantity = forms.IntegerField(
        required=False,
        min_value=0,
        initial=0,
        label="Quantité initiale",
        help_text="Laisser à 0 si vous n'ajoutez pas de stock maintenant.",
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


@admin.register(Product)
class ProductAdmin(ModelAdmin):
    form = ProductAdminForm
    list_display = ("name", "barcode", "selling_price", "is_active", "updated_at")
    list_filter = ("is_active",)
    search_fields = ("name", "barcode")
    readonly_fields = ("id", "created_at", "updated_at")

    def get_fieldsets(self, request, obj=None):
        fieldsets = [
            ("Informations générales", {"fields": ("name", "barcode", "is_active")}),
            ("Prix", {"fields": ("purchase_price", "selling_price")}),
        ]
        if obj is None:
            fieldsets.append(
                ("Stock initial", {"fields": ("initial_store", "initial_quantity")})
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
