from django import forms
from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied
from django.http import HttpRequest, HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from unfold.admin import ModelAdmin
from unfold.decorators import action
from unfold.widgets import UnfoldAdminTextareaWidget

from apps.cash.models import CashSession
from apps.dashboard.admin_columns import status_badge
from apps.dashboard.formatting import format_fcfa
from apps.stores.admin_mixins import SingleStoreColumnsMixin
from apps.tenancy.admin_mixins import TenantAdminMixin, is_platform_admin, visible_queryset
from apps.tenancy.context import get_tenant

from .exceptions import (
    ExpenseAlreadyCancelled,
    ExpenseCancellationNotAllowed,
    ExpenseNotCancellable,
    InvalidExpense,
)
from .models import Expense, ExpenseCategory
from .services import cancel_expense


def _local(value) -> str:
    return timezone.localtime(value).strftime("%d/%m/%Y à %H:%M")


def _person(user) -> str:
    return (user.get_full_name() or user.username) if user else "—"


def _expense_card(expense: Expense) -> dict:
    """En-tête de la fiche dépense, déjà formaté pour le template."""
    session = expense.cash_session
    is_cancelled = expense.status == Expense.Status.CANCELLED
    return {
        "reference": expense.reference,
        "category": expense.category.name,
        "amount": format_fcfa(expense.amount),
        "method": expense.get_payment_method_display(),
        "is_cancelled": is_cancelled,
        "status_label": expense.get_status_display(),
        "occurred_at": _local(expense.occurred_at),
        "created_by": _person(expense.created_by),
        "description": expense.description,
        "document_reference": expense.document_reference,
        "cancelled_at": _local(expense.cancelled_at) if expense.cancelled_at else None,
        "cancelled_by": _person(expense.cancelled_by),
        "cancellation_reason": expense.cancellation_reason,
        # Le bouton « Annuler » n'existe que tant que la session est ouverte :
        # on dit pourquoi il manque, plutôt que de le laisser chercher.
        "cancellation_locked": (
            not is_cancelled
            and session is not None
            and session.status == CashSession.Status.CLOSED
        ),
        "session_label": str(session) if session else None,
        "session_url": (
            reverse("admin:cash_cashsession_change", args=[session.pk]) if session else None
        ),
    }


class ExpenseCategoryAdminForm(forms.ModelForm):
    # Commerce de la catégorie, posé par l'admin quand le champ n'est pas
    # dans le formulaire : le nom n'est unique que dans ce commerce.
    organization_scope = None

    class Meta:
        model = ExpenseCategory
        fields = "__all__"

    def clean_name(self):
        name = self.cleaned_data.get("name")
        organization = self.cleaned_data.get("organization") or self.organization_scope
        if (
            name
            and organization is not None
            and ExpenseCategory.objects.filter(organization=organization, name=name)
            .exclude(pk=self.instance.pk)
            .exists()
        ):
            raise forms.ValidationError("Une catégorie porte déjà ce nom.")
        return name


@admin.register(ExpenseCategory)
class ExpenseCategoryAdmin(TenantAdminMixin, ModelAdmin):
    form = ExpenseCategoryAdminForm
    list_display = ("name", "requires_description", "is_active", "sort_order")
    list_editable = ("sort_order",)
    list_filter = ("is_active",)
    search_fields = ("name",)
    fields = ("name", "requires_description", "is_active", "sort_order")

    def get_fields(self, request, obj=None):
        # La plateforme choisit le commerce ; un commerce crée chez lui.
        if is_platform_admin(request) and obj is None:
            return ("organization", *self.fields)
        return self.fields

    def get_form(self, request, obj=None, **kwargs):
        form = super().get_form(request, obj, **kwargs)
        tenant = get_tenant(request)

        class ScopedCategoryForm(form):
            organization_scope = obj.organization if obj is not None else (
                tenant.organization if tenant else None
            )

            def __init__(self, *args, **kwargs):
                super().__init__(*args, **kwargs)
                # Plateforme : une catégorie appartient toujours à un commerce.
                if "organization" in self.fields:
                    self.fields["organization"].required = True

        return ScopedCategoryForm

    def save_model(self, request, obj: ExpenseCategory, form, change: bool) -> None:
        if not change and not is_platform_admin(request):
            obj.organization = get_tenant(request).organization
        super().save_model(request, obj, form, change)

    def has_delete_permission(self, request, obj=None) -> bool:
        # Une catégorie se désactive : des dépenses y restent rattachées.
        return False


class CancelExpenseForm(forms.Form):
    reason = forms.CharField(
        label="Motif de l’annulation",
        widget=UnfoldAdminTextareaWidget(attrs={"rows": 3}),
        help_text="Ex. « Montant saisi deux fois ». La dépense reste visible, barrée.",
    )


@admin.register(Expense)
class ExpenseAdmin(SingleStoreColumnsMixin, TenantAdminMixin, ModelAdmin):
    """Dépenses saisies en caisse : consultables, jamais modifiables. Seule
    l'annulation (avec motif) est possible, tant que la session est ouverte."""

    list_display = (
        "occurred_at",
        "reference",
        "category",
        "amount_display",
        "payment_method",
        "status_display",
        "store",
        "created_by",
    )
    list_filter = ("status", "payment_method", "category", "store")
    list_select_related = ("category", "store", "created_by")
    search_fields = ("reference", "description", "document_reference")
    date_hierarchy = "occurred_at"
    readonly_fields = (
        "reference",
        "store",
        "cash_session",
        "category",
        "amount_display",
        "payment_method",
        "description",
        "document_reference",
        "status_display",
        "occurred_at",
        "created_by",
        "created_at",
        "cancelled_at",
        "cancelled_by",
        "cancellation_reason",
    )
    # En-tête : montant, statut et, s'il y a lieu, l'annulation ou la raison
    # pour laquelle elle n'est plus possible. Le reste est replié.
    change_form_outer_before_template = "admin/expenses/expense_summary.html"
    fieldsets = (
        (
            _("Détails"),
            {
                "fields": ("store", "cash_session", "occurred_at", "created_by", "created_at"),
                "classes": ("collapse",),
            },
        ),
    )
    actions_detail = ["cancel_expense_action"]

    status_display = status_badge(
        "status", "statut", {"POSTED": "success", "CANCELLED": "danger"}
    )

    @admin.display(description=_("montant"), ordering="amount")
    def amount_display(self, obj: Expense) -> str:
        return format_fcfa(obj.amount)

    def change_view(self, request, object_id, form_url="", extra_context=None):
        expense = self.get_object(request, object_id)
        if expense is not None:
            extra_context = {**(extra_context or {}), "expense_card": _expense_card(expense)}
        return super().change_view(request, object_id, form_url, extra_context)

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False

    def has_cancel_permission(self, request: HttpRequest, object_id=None) -> bool:
        if not request.user.has_perm("expenses.cancel_expense"):
            return False
        if object_id is None:
            return True
        # Le bouton n'apparaît que si l'annulation peut réussir.
        return visible_queryset(Expense, request).filter(
            pk=object_id, status=Expense.Status.POSTED
        ).exclude(cash_session__status=CashSession.Status.CLOSED).exists()

    @action(
        description=_("Annuler la dépense"),
        icon="block",
        url_path="annuler",
        permissions=["cancel"],
    )
    def cancel_expense_action(self, request: HttpRequest, object_id: str) -> HttpResponse:
        expense = get_object_or_404(
            self.get_queryset(request).select_related("category"), pk=object_id
        )
        if not request.user.has_perm("expenses.cancel_expense"):
            raise PermissionDenied
        back_url = reverse("admin:expenses_expense_change", args=[expense.pk])

        form = CancelExpenseForm(request.POST or None)
        if request.method == "POST" and form.is_valid():
            try:
                cancel_expense(
                    expense=expense,
                    cancelled_by=request.user,
                    reason=form.cleaned_data["reason"],
                )
            except (
                InvalidExpense,
                ExpenseAlreadyCancelled,
                ExpenseCancellationNotAllowed,
                ExpenseNotCancellable,
            ) as exc:
                form.add_error(None, str(exc))
            else:
                self.message_user(
                    request,
                    f"Dépense {expense.reference} annulée : "
                    f"{format_fcfa(expense.amount)} · {expense.category}.",
                    level=messages.SUCCESS,
                )
                return redirect(back_url)

        context = self.admin_site.each_context(request)
        context.update(
            {
                "title": f"Annuler la dépense {expense.reference}",
                "expense": expense,
                "amount": format_fcfa(expense.amount),
                "form": form,
                "opts": Expense._meta,
                "back_url": back_url,
            }
        )
        return render(request, "admin/expenses/cancel_expense.html", context)
