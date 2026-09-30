from django import forms
from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied
from django.http import HttpRequest, HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils.translation import gettext_lazy as _
from unfold.admin import ModelAdmin
from unfold.decorators import action

from apps.cash.models import CashSession
from apps.dashboard.formatting import format_fcfa

from .exceptions import (
    ExpenseAlreadyCancelled,
    ExpenseCancellationNotAllowed,
    ExpenseNotCancellable,
    InvalidExpense,
)
from .models import Expense, ExpenseCategory
from .services import cancel_expense


@admin.register(ExpenseCategory)
class ExpenseCategoryAdmin(ModelAdmin):
    list_display = ("name", "requires_description", "is_active", "sort_order")
    list_editable = ("sort_order",)
    list_filter = ("is_active",)
    search_fields = ("name",)
    fields = ("name", "requires_description", "is_active", "sort_order")

    def has_delete_permission(self, request, obj=None) -> bool:
        # Une catégorie se désactive : des dépenses y restent rattachées.
        return False


class CancelExpenseForm(forms.Form):
    reason = forms.CharField(
        label="Motif de l’annulation",
        widget=forms.Textarea(attrs={"rows": 3}),
        help_text="Ex. « Montant saisi deux fois ». La dépense reste visible, barrée.",
    )


@admin.register(Expense)
class ExpenseAdmin(ModelAdmin):
    """Dépenses saisies en caisse : consultables, jamais modifiables. Seule
    l'annulation (avec motif) est possible, tant que la session est ouverte."""

    list_display = (
        "occurred_at",
        "reference",
        "category",
        "amount_display",
        "payment_method",
        "status",
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
        "amount",
        "payment_method",
        "description",
        "document_reference",
        "status",
        "occurred_at",
        "created_by",
        "created_at",
        "cancelled_at",
        "cancelled_by",
        "cancellation_reason",
    )
    fieldsets = (
        (
            None,
            {
                "fields": (
                    "reference",
                    "category",
                    "amount",
                    "payment_method",
                    "description",
                    "document_reference",
                    "status",
                )
            },
        ),
        (_("Caisse"), {"fields": ("store", "cash_session", "occurred_at", "created_by", "created_at")}),
        (_("Annulation"), {"fields": ("cancelled_at", "cancelled_by", "cancellation_reason")}),
    )
    actions_detail = ["cancel_expense_action"]

    @admin.display(description=_("montant"), ordering="amount")
    def amount_display(self, obj: Expense) -> str:
        return format_fcfa(obj.amount)

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
        return Expense.objects.filter(
            pk=object_id, status=Expense.Status.POSTED
        ).exclude(cash_session__status=CashSession.Status.CLOSED).exists()

    @action(
        description=_("Annuler la dépense"),
        icon="block",
        url_path="annuler",
        permissions=["cancel"],
    )
    def cancel_expense_action(self, request: HttpRequest, object_id: str) -> HttpResponse:
        expense = get_object_or_404(Expense.objects.select_related("category"), pk=object_id)
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
