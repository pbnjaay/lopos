from decimal import Decimal

from django import forms
from django.contrib import admin
from django.db.models import QuerySet
from django.http import HttpRequest
from django.utils.translation import gettext_lazy as _
from unfold.admin import ModelAdmin, TabularInline

from apps.dashboard.admin_columns import money_column
from apps.stores.admin_mixins import SingleStoreColumnsMixin
from apps.dashboard.formatting import format_fcfa


def _signed_fcfa(amount: Decimal) -> str:
    """Écriture du cahier : « + » quand le client doit plus, « − » quand il
    doit moins."""
    sign = "+" if amount > 0 else "−"
    return f"{sign} {format_fcfa(abs(amount))}"

from .exceptions import InvalidPhone
from .models import Customer, CustomerLedgerEntry, CustomerPayment
from .phone import normalize_phone
from .services import (
    customer_balance,
    record_adjustment,
    record_opening_balance,
    with_balance,
)


class CustomerBalanceFilter(admin.SimpleListFilter):
    title = _("solde")
    parameter_name = "balance"

    def lookups(self, request, model_admin):
        return (
            ("due", _("Avec solde")),
            ("settled", _("Soldés")),
        )

    def queryset(self, request, queryset):
        if self.value() == "due":
            return queryset.filter(balance__gt=0)
        if self.value() == "settled":
            return queryset.filter(balance=0)
        return queryset


class CustomerAdminForm(forms.ModelForm):
    class Meta:
        model = Customer
        fields = ("store", "name", "phone", "notes", "is_active")

    def clean_name(self) -> str:
        name = " ".join((self.cleaned_data.get("name") or "").split())
        if not name:
            raise forms.ValidationError("Le nom du client est obligatoire.")
        return name

    def clean_phone(self) -> str | None:
        phone = self.cleaned_data.get("phone")
        if not phone or not phone.strip():
            return None
        try:
            return normalize_phone(phone)
        except InvalidPhone as exc:
            raise forms.ValidationError(str(exc)) from exc


class LedgerEntryInline(TabularInline):
    model = CustomerLedgerEntry
    fk_name = "customer"
    extra = 0
    can_delete = False
    hide_title = True
    fields = ("occurred_at", "entry_type", "amount_display", "sale", "reason", "created_by")
    readonly_fields = fields
    ordering = ("-occurred_at", "-created_at")
    verbose_name = "écriture"
    verbose_name_plural = "historique du cahier"

    @admin.display(description=_("montant"))
    def amount_display(self, obj: CustomerLedgerEntry) -> str:
        return _signed_fcfa(obj.amount)

    def has_add_permission(self, request, obj=None) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False


@admin.register(Customer)
class CustomerAdmin(SingleStoreColumnsMixin, ModelAdmin):
    form = CustomerAdminForm
    list_display = ("name", "phone", "store", "balance_display", "is_active")
    list_filter = ("store", CustomerBalanceFilter, "is_active")
    list_select_related = ("store",)
    search_fields = ("name", "phone")
    readonly_fields = ("balance_display", "created_by", "created_at", "updated_at")
    inlines = (LedgerEntryInline,)

    def get_queryset(self, request: HttpRequest) -> QuerySet[Customer]:
        return with_balance(super().get_queryset(request))

    def get_readonly_fields(self, request, obj=None):
        # Changer le magasin d'un client déplacerait sa dette d'une boutique
        # à l'autre : figé une fois le client créé.
        if obj is not None:
            return ("store", *self.readonly_fields)
        return self.readonly_fields

    @admin.display(description=_("solde dû"), ordering="balance")
    def balance_display(self, obj: Customer) -> str:
        balance = getattr(obj, "balance", None)
        if balance is None:
            balance = customer_balance(obj) if obj.pk else Decimal("0")
        return format_fcfa(balance)

    def save_model(self, request, obj: Customer, form, change: bool) -> None:
        if not change:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)

    def has_delete_permission(self, request, obj=None) -> bool:
        # Un client se désactive, il ne se supprime jamais (historique).
        return False


class ManualLedgerEntryForm(forms.ModelForm):
    """Seules écritures saisissables à la main : ajustement et reprise.

    Les autres types naissent des ventes, paiements et retours, jamais d'un
    formulaire. Les contrôles ici sont un premier filtre lisible ; le service
    appelé à l'enregistrement refait les mêmes contrôles sous verrou.
    """

    entry_type = forms.ChoiceField(
        label="type",
        choices=(
            (CustomerLedgerEntry.EntryType.ADJUSTMENT, "Ajustement"),
            (CustomerLedgerEntry.EntryType.OPENING_BALANCE, "Solde d’ouverture"),
        ),
    )

    class Meta:
        model = CustomerLedgerEntry
        fields = ("customer", "entry_type", "amount", "reason", "reference")
        help_texts = {
            "amount": (
                "Positif : le client doit plus. Négatif : le client doit moins. "
                "Un solde d’ouverture est toujours positif."
            ),
        }

    def clean(self):
        cleaned = super().clean()
        customer = cleaned.get("customer")
        amount = cleaned.get("amount")
        entry_type = cleaned.get("entry_type")
        reason = (cleaned.get("reason") or "").strip()
        # Montant nul et doublon de solde d'ouverture sont signalés par les
        # contraintes du modèle elles-mêmes (validate_constraints du ModelForm).
        if customer is None or amount is None or amount == 0:
            return cleaned

        if entry_type == CustomerLedgerEntry.EntryType.OPENING_BALANCE:
            if amount < 0:
                self.add_error("amount", "Un solde d’ouverture doit être positif.")
        elif entry_type == CustomerLedgerEntry.EntryType.ADJUSTMENT:
            if not reason:
                self.add_error("reason", "Le motif de l’ajustement est obligatoire.")
            balance = customer_balance(customer)
            if balance + amount < 0:
                self.add_error(
                    "amount",
                    f"Cet ajustement rendrait le solde négatif (solde actuel : "
                    f"{format_fcfa(balance)}).",
                )
        return cleaned


@admin.register(CustomerLedgerEntry)
class CustomerLedgerEntryAdmin(SingleStoreColumnsMixin, ModelAdmin):
    list_display = (
        "occurred_at",
        "customer",
        "entry_type",
        "amount_display",
        "store",
        "sale",
        "created_by",
    )
    list_filter = ("entry_type", "store")
    list_select_related = ("customer", "store", "created_by")
    search_fields = ("customer__name", "customer__phone", "reference", "sale__id")
    autocomplete_fields = ("customer",)
    date_hierarchy = "occurred_at"
    readonly_fields = (
        "id",
        "customer",
        "store",
        "entry_type",
        "amount_display",
        "sale",
        "sale_return",
        "reversal_of",
        "reference",
        "reason",
        "occurred_at",
        "created_at",
        "created_by",
    )

    @admin.display(description=_("montant"), ordering="amount")
    def amount_display(self, obj: CustomerLedgerEntry) -> str:
        return _signed_fcfa(obj.amount)

    def get_form(self, request, obj=None, change=False, **kwargs):
        if obj is None:
            kwargs["form"] = ManualLedgerEntryForm
        return super().get_form(request, obj, change=change, **kwargs)

    def get_readonly_fields(self, request, obj=None):
        if obj is None:
            return ()
        return self.readonly_fields

    def get_fieldsets(self, request, obj=None):
        if obj is None:
            return ((None, {"fields": ManualLedgerEntryForm.Meta.fields}),)
        # Écriture existante : uniquement les champs en lecture, montant formaté.
        return ((None, {"fields": self.readonly_fields}),)

    def save_model(self, request, obj: CustomerLedgerEntry, form, change: bool) -> None:
        data = form.cleaned_data
        if data["entry_type"] == CustomerLedgerEntry.EntryType.OPENING_BALANCE:
            entry = record_opening_balance(
                customer=data["customer"],
                amount=data["amount"],
                reference=data.get("reference") or "",
                reason=data.get("reason") or "",
                created_by=request.user,
            )
        else:
            entry = record_adjustment(
                customer=data["customer"],
                amount=data["amount"],
                reason=data["reason"],
                created_by=request.user,
            )
        # L'écriture est créée par le service (verrou + contrôles) ; l'admin
        # n'a besoin que de son identité pour le message et la redirection.
        obj.__dict__.update(entry.__dict__)

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False


@admin.register(CustomerPayment)
class CustomerPaymentAdmin(ModelAdmin):
    """Remboursements encaissés en caisse : consultables, jamais modifiables
    (l'argent est déjà dans la caisse et l'écriture du cahier est immuable)."""

    list_display = (
        "created_at",
        "reference",
        "customer",
        "method",
        "amount_display",
        "balance_after_display",
        "cash_session",
        "created_by",
    )
    list_filter = ("method", "store")
    list_select_related = ("customer", "cash_session__cash_register", "created_by")
    search_fields = ("reference", "customer__name", "customer__phone")
    date_hierarchy = "created_at"

    fields = (
        "reference",
        "customer",
        "store",
        "method",
        "amount_display",
        "received_amount_display",
        "change_amount_display",
        "balance_before_display",
        "balance_after_display",
        "cash_session",
        "created_by",
        "created_at",
    )
    readonly_fields = fields

    amount_display = money_column("amount", "montant")
    received_amount_display = money_column("received_amount", "montant reçu")
    change_amount_display = money_column("change_amount", "monnaie rendue")
    balance_before_display = money_column("balance_before", "ancien solde")
    balance_after_display = money_column("balance_after", "nouveau solde")

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False
