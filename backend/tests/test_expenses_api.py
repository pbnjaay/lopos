"""API des dépenses : catégories, saisie idempotente dans sa session,
historique de la boutique avec totaux, fiche et annulation."""

from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.cash.models import CashSession
from apps.cash.services import close_cash_session
from apps.expenses.models import Expense, ExpenseCategory
from apps.expenses.services import cancel_expense, create_expense, ensure_default_categories
from apps.stores.models import CashRegister, Store, StoreAssignment


pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Test")


@pytest.fixture
def cashier(store):
    user = User.objects.create_user(username="cashier")
    StoreAssignment.objects.create(user=user, store=store)
    return user


@pytest.fixture
def cash_session(store, cashier) -> CashSession:
    register = CashRegister.objects.create(store=store, name="Caisse 01")
    return CashSession.objects.create(
        cash_register=register, cashier=cashier, opening_balance=Decimal("30000.00")
    )


@pytest.fixture
def api(cashier) -> APIClient:
    client = APIClient()
    client.force_authenticate(cashier)
    return client


@pytest.fixture
def categories() -> dict[str, ExpenseCategory]:
    ensure_default_categories()
    return {category.name: category for category in ExpenseCategory.objects.all()}


def _payload(cash_session, category, **overrides) -> dict:
    payload = {
        "idempotency_key": str(uuid4()),
        "cash_session_id": str(cash_session.pk),
        "category_id": str(category.pk),
        "payment_method": "CASH",
        "amount": "25000",
        "description": "Facture août",
        "document_reference": "SENELEC-0825",
    }
    payload.update(overrides)
    return payload


def _expense(cash_session, user, category, amount="1000", method="WAVE") -> Expense:
    return create_expense(
        cash_session=cash_session,
        created_by=user,
        category=category,
        amount=Decimal(amount),
        payment_method=method,
        description="x",
        idempotency_key=uuid4(),
    )


# --- Catégories -------------------------------------------------------------


def test_categories_lists_only_active_ones_in_order(api, categories) -> None:
    categories["Eau"].is_active = False
    categories["Eau"].save()

    response = api.get(reverse("expense-category-list"))

    assert response.status_code == 200
    names = [category["name"] for category in response.json()]
    assert names[0] == "Électricité"
    assert "Eau" not in names
    other = next(category for category in response.json() if category["name"] == "Autre")
    assert other["requires_description"] is True


def test_expenses_api_requires_authentication(cash_session) -> None:
    response = APIClient().get(reverse("expense-list"))

    assert response.status_code in (401, 403)


# --- Création ---------------------------------------------------------------


def test_create_expense(api, cash_session, cashier, categories) -> None:
    response = api.post(
        reverse("expense-list"), _payload(cash_session, categories["Électricité"]), format="json"
    )

    assert response.status_code == 201, response.content
    body = response.json()
    assert body["reference"].startswith("DEP-")
    assert body["category"]["name"] == "Électricité"
    assert body["amount"] == "25000.00"
    assert body["payment_method"] == "CASH"
    assert body["status"] == "POSTED"
    assert body["store"]["name"] == "Supérette Test"
    assert body["cash_register"]["name"] == "Caisse 01"
    assert body["created_by"] == "cashier"
    assert body["document_reference"] == "SENELEC-0825"
    assert body["can_cancel"] is True
    expense = Expense.objects.get()
    assert expense.created_by == cashier
    assert expense.store_id == cash_session.cash_register.store_id


def test_retry_returns_the_same_expense(api, cash_session, categories) -> None:
    payload = _payload(cash_session, categories["Transport"], payment_method="WAVE")

    first = api.post(reverse("expense-list"), payload, format="json")
    second = api.post(reverse("expense-list"), payload, format="json")

    assert first.status_code == second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    assert Expense.objects.count() == 1


def test_same_key_with_another_amount_is_rejected(api, cash_session, categories) -> None:
    payload = _payload(cash_session, categories["Transport"])
    api.post(reverse("expense-list"), payload, format="json")

    response = api.post(reverse("expense-list"), {**payload, "amount": "1"}, format="json")

    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_EXPENSE"


@pytest.mark.parametrize("amount", ["0", "-5000", "abc"])
def test_invalid_amount_is_rejected(api, cash_session, categories, amount) -> None:
    response = api.post(
        reverse("expense-list"),
        _payload(cash_session, categories["Électricité"], amount=amount),
        format="json",
    )

    assert response.status_code == 400
    assert Expense.objects.count() == 0


def test_credit_is_not_a_payment_method(api, cash_session, categories) -> None:
    response = api.post(
        reverse("expense-list"),
        _payload(cash_session, categories["Électricité"], payment_method="CREDIT"),
        format="json",
    )

    assert response.status_code == 400


def test_missing_description_is_rejected_with_a_clear_message(api, cash_session, categories) -> None:
    response = api.post(
        reverse("expense-list"),
        _payload(cash_session, categories["Autre"], description=""),
        format="json",
    )

    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_EXPENSE"
    assert "description est obligatoire" in response.json()["message"]


def test_closed_session_is_rejected(api, cash_session, categories) -> None:
    close_cash_session(cash_session=cash_session, counted_cash=Decimal("30000"))

    response = api.post(
        reverse("expense-list"), _payload(cash_session, categories["Eau"]), format="json"
    )

    assert response.status_code == 409
    assert response.json()["code"] == "CASH_SESSION_CLOSED"


def test_session_of_another_cashier_is_rejected(store, cash_session, categories) -> None:
    colleague = User.objects.create_user(username="colleague")
    StoreAssignment.objects.create(user=colleague, store=store)
    client = APIClient()
    client.force_authenticate(colleague)

    response = client.post(
        reverse("expense-list"), _payload(cash_session, categories["Eau"]), format="json"
    )

    assert response.status_code == 403
    assert response.json()["code"] == "CASH_SESSION_NOT_OWNED"


def test_insufficient_cash_returns_what_is_available(api, cash_session, categories) -> None:
    response = api.post(
        reverse("expense-list"),
        _payload(cash_session, categories["Électricité"], amount="30001"),
        format="json",
    )

    assert response.status_code == 409
    body = response.json()
    assert body["code"] == "INSUFFICIENT_CASH"
    assert body["available"] == "30000.00"
    assert "30 000 FCFA" in body["message"]


# --- Historique -------------------------------------------------------------


def test_list_requires_an_open_session(api, cash_session) -> None:
    close_cash_session(cash_session=cash_session, counted_cash=Decimal("30000"))

    response = api.get(reverse("expense-list"))

    assert response.status_code == 403
    assert response.json()["code"] == "OPEN_CASH_SESSION_REQUIRED"


def test_list_shows_store_expenses_newest_first_with_totals(
    api, store, cash_session, cashier, categories
) -> None:
    first = _expense(cash_session, cashier, categories["Eau"], "2000", method="CASH")
    second = _expense(cash_session, cashier, categories["Transport"], "3000", method="WAVE")
    cancelled = _expense(cash_session, cashier, categories["Transport"], "9000", method="ORANGE_MONEY")
    cancel_expense(expense=cancelled, cancelled_by=cashier, reason="Doublon")
    # Une autre boutique n'apparaît jamais.
    other_store = Store.objects.create(name="Autre boutique")
    other_cashier = User.objects.create_user(username="other")
    other_session = CashSession.objects.create(
        cash_register=CashRegister.objects.create(store=other_store, name="Caisse"),
        cashier=other_cashier,
        opening_balance=Decimal("0"),
    )
    _expense(other_session, other_cashier, categories["Eau"], "500")

    response = api.get(reverse("expense-list"))

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 3
    assert [row["id"] for row in body["results"]] == [
        str(cancelled.pk),
        str(second.pk),
        str(first.pk),
    ]
    assert body["results"][0]["status"] == "CANCELLED"
    assert body["results"][0]["cancellation_reason"] == "Doublon"
    # Les annulées restent visibles mais ne comptent pas dans les totaux.
    assert body["totals"] == {
        "count": 2,
        "total": "5000.00",
        "cash": "2000.00",
        "wave": "3000.00",
        "orange_money": "0.00",
    }


def test_list_filters(api, cash_session, cashier, categories) -> None:
    water = _expense(cash_session, cashier, categories["Eau"], "2000", method="CASH")
    _expense(cash_session, cashier, categories["Transport"], "3000", method="WAVE")
    # Créée directement avec sa date : une dépense ne se modifie pas après coup.
    old = Expense.objects.create(
        store=cash_session.cash_register.store,
        cash_session=cash_session,
        category=categories["Eau"],
        amount=Decimal("1000"),
        payment_method="WAVE",
        occurred_at=timezone.now() - timedelta(days=10),
        created_by=cashier,
        idempotency_key=uuid4(),
    )

    def ids(**params) -> list[str]:
        return [row["id"] for row in api.get(reverse("expense-list"), params).json()["results"]]

    assert ids(category_id=str(categories["Eau"].pk)) == [str(water.pk), str(old.pk)]
    assert ids(payment_method="CASH") == [str(water.pk)]
    today = timezone.localdate().isoformat()
    assert str(old.pk) not in ids(date_from=today, date_to=today)
    assert ids(status="CANCELLED") == []


# --- Fiche et annulation ----------------------------------------------------


def test_detail(api, cash_session, cashier, categories) -> None:
    expense = _expense(cash_session, cashier, categories["Eau"])

    response = api.get(reverse("expense-detail", kwargs={"pk": expense.pk}))

    assert response.status_code == 200
    assert response.json()["reference"] == expense.reference


def test_detail_of_another_store_is_not_found(api, categories) -> None:
    other_store = Store.objects.create(name="Autre boutique")
    other_cashier = User.objects.create_user(username="other")
    other_session = CashSession.objects.create(
        cash_register=CashRegister.objects.create(store=other_store, name="Caisse"),
        cashier=other_cashier,
        opening_balance=Decimal("0"),
    )
    expense = _expense(other_session, other_cashier, categories["Eau"])

    assert api.get(reverse("expense-detail", kwargs={"pk": expense.pk})).status_code == 404
    response = api.post(
        reverse("expense-cancel", kwargs={"pk": expense.pk}), {"reason": "x"}, format="json"
    )
    assert response.status_code == 404


def test_cancel(api, cash_session, cashier, categories) -> None:
    expense = _expense(cash_session, cashier, categories["Eau"], method="CASH")

    response = api.post(
        reverse("expense-cancel", kwargs={"pk": expense.pk}),
        {"reason": "Saisie en double"},
        format="json",
    )

    assert response.status_code == 200, response.content
    body = response.json()
    assert body["status"] == "CANCELLED"
    assert body["cancelled_by"] == "cashier"
    assert body["cancellation_reason"] == "Saisie en double"
    assert body["can_cancel"] is False


def test_cancel_requires_a_reason(api, cash_session, cashier, categories) -> None:
    expense = _expense(cash_session, cashier, categories["Eau"])

    response = api.post(
        reverse("expense-cancel", kwargs={"pk": expense.pk}), {"reason": "  "}, format="json"
    )

    assert response.status_code == 400


def test_double_cancel_is_a_conflict(api, cash_session, cashier, categories) -> None:
    expense = _expense(cash_session, cashier, categories["Eau"])
    url = reverse("expense-cancel", kwargs={"pk": expense.pk})
    api.post(url, {"reason": "Erreur"}, format="json")

    response = api.post(url, {"reason": "Encore"}, format="json")

    assert response.status_code == 409
    assert response.json()["code"] == "EXPENSE_ALREADY_CANCELLED"


def test_cancel_after_closing_is_a_conflict(api, cash_session, cashier, categories) -> None:
    expense = _expense(cash_session, cashier, categories["Eau"])
    close_cash_session(cash_session=cash_session, counted_cash=Decimal("30000"))

    response = api.post(
        reverse("expense-cancel", kwargs={"pk": expense.pk}), {"reason": "Erreur"}, format="json"
    )

    assert response.status_code == 409
    assert response.json()["code"] == "EXPENSE_NOT_CANCELLABLE"


def test_colleague_cannot_cancel_but_sees_it(store, cash_session, cashier, categories) -> None:
    expense = _expense(cash_session, cashier, categories["Eau"])
    colleague = User.objects.create_user(username="colleague")
    StoreAssignment.objects.create(user=colleague, store=store)
    client = APIClient()
    client.force_authenticate(colleague)

    detail = client.get(reverse("expense-detail", kwargs={"pk": expense.pk}))
    response = client.post(
        reverse("expense-cancel", kwargs={"pk": expense.pk}), {"reason": "Erreur"}, format="json"
    )

    assert detail.json()["can_cancel"] is False
    assert response.status_code == 403
    assert response.json()["code"] == "EXPENSE_CANCELLATION_NOT_ALLOWED"


def test_staff_can_cancel_any_expense(cash_session, cashier, categories) -> None:
    expense = _expense(cash_session, cashier, categories["Eau"])
    manager = User.objects.create_user(username="gerant", is_staff=True)
    client = APIClient()
    client.force_authenticate(manager)

    assert client.get(reverse("expense-detail", kwargs={"pk": expense.pk})).json()["can_cancel"] is True
    response = client.post(
        reverse("expense-cancel", kwargs={"pk": expense.pk}), {"reason": "Doublon"}, format="json"
    )

    assert response.status_code == 200
    assert response.json()["cancelled_by"] == "gerant"
