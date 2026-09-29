from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.test import RequestFactory
from django.urls import reverse

from apps.cash.models import CashSession
from apps.cash.services import close_cash_session
from apps.expenses.admin import ExpenseAdmin, ExpenseCategoryAdmin
from apps.expenses.models import Expense, ExpenseCategory
from apps.expenses.services import create_expense
from apps.stores.models import CashRegister, Store


pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def cashier():
    return User.objects.create_user(username="cashier")


@pytest.fixture
def cash_session(cashier) -> CashSession:
    store = Store.objects.create(name="Supérette Test")
    register = CashRegister.objects.create(store=store, name="Caisse 01")
    return CashSession.objects.create(
        cash_register=register, cashier=cashier, opening_balance=Decimal("0")
    )


@pytest.fixture
def expense(cash_session, cashier) -> Expense:
    return create_expense(
        cash_session=cash_session,
        created_by=cashier,
        category=ExpenseCategory.objects.create(name="Test électricité"),
        amount=Decimal("25000"),
        payment_method="WAVE",
        description="Facture août",
        idempotency_key=uuid4(),
    )


@pytest.fixture
def manager_client(client):
    call_command("create_default_groups")
    user = User.objects.create_user(username="gerant", password="pw", is_staff=True)
    user.groups.add(Group.objects.get(name="Gérant"))
    client.force_login(user)
    client.user = user
    return client


def _request(user):
    request = RequestFactory().get("/admin/")
    request.user = user
    return request


def test_expenses_are_read_only_in_admin() -> None:
    model_admin = ExpenseAdmin(Expense, admin.site)
    request = _request(User.objects.create_superuser(username="root"))

    assert model_admin.has_add_permission(request) is False
    assert model_admin.has_change_permission(request) is False
    assert model_admin.has_delete_permission(request) is False


def test_categories_are_never_deletable() -> None:
    model_admin = ExpenseCategoryAdmin(ExpenseCategory, admin.site)
    request = _request(User.objects.create_superuser(username="root"))

    assert model_admin.has_delete_permission(request) is False


def test_manager_group_can_view_and_cancel_expenses_but_never_edit_them(manager_client) -> None:
    codenames = set(
        Group.objects.get(name="Gérant").permissions.values_list("codename", flat=True)
    )

    assert {"view_expense", "cancel_expense"} <= codenames
    assert not {"add_expense", "change_expense", "delete_expense"} & codenames
    assert {"add_expensecategory", "change_expensecategory", "view_expensecategory"} <= codenames
    assert "delete_expensecategory" not in codenames


def test_manager_sees_the_expense_list(manager_client, expense) -> None:
    response = manager_client.get(reverse("admin:expenses_expense_changelist"))

    assert response.status_code == 200
    assert expense.reference in response.content.decode()


def test_manager_cancels_an_expense_with_a_reason(manager_client, expense) -> None:
    url = reverse("admin:expenses_expense_cancel_expense_action", args=[expense.pk])

    assert manager_client.get(url).status_code == 200
    response = manager_client.post(url, {"reason": "Saisie en double"})

    assert response.status_code == 302
    expense.refresh_from_db()
    assert expense.status == Expense.Status.CANCELLED
    assert expense.cancelled_by == manager_client.user
    assert expense.cancellation_reason == "Saisie en double"


def test_cancel_form_requires_a_reason(manager_client, expense) -> None:
    url = reverse("admin:expenses_expense_cancel_expense_action", args=[expense.pk])

    response = manager_client.post(url, {"reason": ""})

    assert response.status_code == 200
    expense.refresh_from_db()
    assert expense.status == Expense.Status.POSTED


def test_cancel_action_is_offered_only_while_cancellation_can_succeed(
    manager_client, expense, cash_session
) -> None:
    model_admin = ExpenseAdmin(Expense, admin.site)
    request = _request(manager_client.user)
    assert model_admin.has_cancel_permission(request, expense.pk) is True

    close_cash_session(cash_session=cash_session, counted_cash=Decimal("0"))

    assert model_admin.has_cancel_permission(request, expense.pk) is False


def test_user_without_cancel_permission_cannot_cancel(client, expense) -> None:
    viewer = User.objects.create_user(username="viewer", password="pw", is_staff=True)
    client.force_login(viewer)

    response = client.post(
        reverse("admin:expenses_expense_cancel_expense_action", args=[expense.pk]),
        {"reason": "Erreur"},
    )

    assert response.status_code in (302, 403)
    expense.refresh_from_db()
    assert expense.status == Expense.Status.POSTED
