"""Phase 3 : deux commerces sur la même base, et toutes les tentatives de
l'un pour lire, modifier ou référencer les données de l'autre par l'API.

Attendu partout : la ressource de l'autre commerce se comporte exactement
comme un identifiant qui n'existe pas (même statut, même code, même message),
et rien n'est créé ni modifié.
"""

from datetime import timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.customers.models import Customer, CustomerPayment
from apps.expenses.models import Expense
from apps.inventory.models import InventoryMovement, Stock
from apps.inventory.services import receive_stock
from apps.sales.models import Sale, SaleReturn
from apps.sync.models import ProcessedSyncEvent
from apps.tenancy.exceptions import CrossTenantReference
from apps.tenancy.integrity import find_violations

from .tenancy_factories import Commerce, build_commerce

pytestmark = [pytest.mark.django_db, pytest.mark.explicit_tenancy]


@pytest.fixture(autouse=True)
def no_cross_commerce_data_left_behind():
    """Après chaque attaque, refusée ou non, rien ne relie deux commerces."""
    yield
    assert [rule.label for rule, _ in find_violations()] == []


@pytest.fixture
def a() -> Commerce:
    return build_commerce("a")


@pytest.fixture
def b() -> Commerce:
    return build_commerce("b")


def _client(user) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


def _assert_like_unknown(response, unknown) -> None:
    """Même statut et même corps qu'un identifiant inexistant (à l'identifiant
    près, que certains messages reprennent)."""
    assert response.status_code == unknown.status_code
    assert _without_ids(response.json()) == _without_ids(unknown.json())


def _without_ids(value):
    if isinstance(value, dict):
        return {k: _without_ids(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_without_ids(v) for v in value]
    if isinstance(value, str):
        import re

        return re.sub(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", "<id>", value)
    return value


# --- Lecture directe d'une ressource de l'autre commerce --------------------


@pytest.mark.parametrize(
    ("route", "attribute"),
    [
        ("store-detail", "store"),
        ("cash-register-detail", "register"),
        ("cash-register-current-session", "register"),
        ("product-detail", "product"),
        ("cash-session-summary", "session"),
        ("customer-detail", "customer"),
        ("expense-detail", "expense"),
    ],
)
def test_owner_cannot_read_another_commerce_resource(a, b, route, attribute) -> None:
    client = _client(a.owner)

    response = client.get(reverse(route, kwargs={"pk": getattr(b, attribute).pk}))
    unknown = client.get(reverse(route, kwargs={"pk": uuid4()}))

    assert response.status_code == status.HTTP_404_NOT_FOUND
    _assert_like_unknown(response, unknown)


@pytest.mark.parametrize(
    ("route", "attribute"),
    [
        ("sale-detail", "sale"),
        ("sale-return-detail", "sale_return"),
        ("customer-payment-detail", "payment"),
    ],
)
def test_cashier_cannot_read_another_commerce_ticket(a, b, route, attribute) -> None:
    client = _client(a.cashier)
    params = {"cash_session_id": a.session.pk}

    response = client.get(reverse(route, kwargs={"pk": getattr(b, attribute).pk}), params)
    unknown = client.get(reverse(route, kwargs={"pk": uuid4()}), params)

    assert response.status_code == status.HTTP_404_NOT_FOUND
    _assert_like_unknown(response, unknown)


def test_lists_never_show_the_other_commerce(a, b) -> None:
    client = _client(a.owner)

    stores = {s["id"] for s in client.get(reverse("store-list")).json()}
    registers = {r["id"] for r in client.get(reverse("cash-register-list")).json()}
    products = {p["id"] for p in client.get(reverse("product-list")).json()}
    categories = {c["id"] for c in client.get(reverse("expense-category-list")).json()}
    searched = client.get(reverse("product-list"), {"search": "Riz"}).json()

    assert stores == {str(a.store.pk)}
    assert registers == {str(a.register.pk)}
    assert products == {str(a.product.pk)}
    assert str(b.category.pk) not in categories
    assert [p["id"] for p in searched] == [str(a.product.pk)]


@pytest.mark.parametrize("route", ["product-list", "product-top", "customer-list"])
def test_store_parameter_of_another_commerce_behaves_like_an_unknown_store(a, b, route) -> None:
    client = _client(a.owner)

    response = client.get(reverse(route), {"store_id": str(b.store.pk)})
    unknown = client.get(reverse(route), {"store_id": str(uuid4())})

    assert response.status_code in (status.HTTP_400_BAD_REQUEST, status.HTTP_404_NOT_FOUND)
    _assert_like_unknown(response, unknown)


def test_me_lists_own_stores_only(a, b) -> None:
    assert _client(a.owner).get(reverse("auth-me")).json()["store_ids"] == [str(a.store.pk)]


# --- Modification d'une ressource de l'autre commerce -----------------------


def test_cannot_cancel_another_commerce_sale(a, b) -> None:
    client = _client(a.owner)

    response = client.post(reverse("sale-cancel", kwargs={"pk": b.sale.pk}))
    unknown = client.post(reverse("sale-cancel", kwargs={"pk": uuid4()}))

    _assert_like_unknown(response, unknown)
    b.sale.refresh_from_db()
    assert b.sale.status == Sale.Status.COMPLETED


def test_cannot_cancel_another_commerce_expense(a, b) -> None:
    client = _client(a.owner)
    body = {"reason": "Erreur"}

    response = client.post(reverse("expense-cancel", kwargs={"pk": b.expense.pk}), body)
    unknown = client.post(reverse("expense-cancel", kwargs={"pk": uuid4()}), body)

    _assert_like_unknown(response, unknown)
    b.expense.refresh_from_db()
    assert b.expense.status == Expense.Status.POSTED


def test_cannot_close_another_commerce_session(a, b) -> None:
    client = _client(a.owner)
    body = {"counted_cash": "0"}

    response = client.post(reverse("cash-session-close", kwargs={"pk": b.session.pk}), body)
    unknown = client.post(reverse("cash-session-close", kwargs={"pk": uuid4()}), body)

    _assert_like_unknown(response, unknown)
    b.session.refresh_from_db()
    assert b.session.status == CashSession.Status.OPEN


@pytest.mark.parametrize("route", ["store-list", "cash-register-list"])
def test_stores_and_registers_cannot_be_created_through_the_api(a, route) -> None:
    response = _client(a.owner).post(reverse(route), {"name": "Pirate"}, format="json")

    assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED


def test_cashier_cannot_add_a_product(a) -> None:
    response = _client(a.cashier).post(
        reverse("product-list"), {"name": "Soda", "selling_price": "500"}, format="json"
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN


def test_owner_adds_a_product_to_own_catalog_whatever_the_barcode_elsewhere(a, b) -> None:
    Product.objects.filter(pk=b.product.pk).update(barcode="6000000000001")

    response = _client(a.owner).post(
        reverse("product-list"),
        {"name": "Soda", "selling_price": "500", "barcode": "6000000000002"},
        format="json",
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert Product.objects.get(pk=response.json()["id"]).organization == a.organization


def test_barcode_check_does_not_reveal_another_commerce_catalog(a, b) -> None:
    """Le code-barres d'un autre commerce ne doit pas être signalé « déjà
    utilisé » : la seule vérification porte sur son propre catalogue. (La
    contrainte d'unicité en base devient par commerce en phase 6.)"""
    Product.objects.filter(pk=b.product.pk).update(barcode="6000000000001")
    serializer_errors = _client(a.owner).post(
        reverse("product-list"),
        {"name": "Soda", "selling_price": "500", "barcode": "6000000000001"},
        format="json",
    )
    assert "Ce code-barres est déjà utilisé." not in str(serializer_errors.content.decode())


# --- Création d'un objet qui référence l'autre commerce ---------------------


def _post_sale(client, session, product, **extra):
    return client.post(
        reverse("sale-complete"),
        {
            "cash_session_id": str(session.pk),
            "items": [{"product_id": str(product.pk), "quantity": "1"}],
            "payments": [{"method": "WAVE", "amount": "1000.00"}],
            **extra,
        },
        format="json",
    )


def test_sale_cannot_use_another_commerce_product(a, b) -> None:
    client = _client(a.cashier)
    sales_before = Sale.objects.count()

    response = _post_sale(client, a.session, b.product)
    unknown = _post_sale(client, a.session, Product(pk=uuid4()))

    assert response.status_code == status.HTTP_404_NOT_FOUND
    _assert_like_unknown(response, unknown)
    assert Sale.objects.count() == sales_before
    assert Stock.objects.get(store=b.store).quantity == Decimal("49")


def test_sale_cannot_use_another_commerce_session(a, b) -> None:
    client = _client(a.cashier)

    response = _post_sale(client, b.session, a.product)
    unknown = _post_sale(client, CashSession(pk=uuid4()), a.product)

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    _assert_like_unknown(response, unknown)


def test_credit_sale_cannot_use_another_commerce_customer(a, b) -> None:
    client = _client(a.cashier)
    credit = {"payments": [], "customer_id": str(b.customer.pk), "credit_amount": "1000.00"}

    response = _post_sale(client, a.session, a.product, **credit)
    unknown = _post_sale(
        client, a.session, a.product, **{**credit, "customer_id": str(uuid4())}
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND
    _assert_like_unknown(response, unknown)
    assert not b.customer.sales.exists()


def test_return_cannot_target_another_commerce_sale(a, b) -> None:
    client = _client(a.cashier)

    def post(sale_id):
        return client.post(
            reverse("sale-return-list"),
            {
                "sale_id": str(sale_id),
                "cash_session_id": str(a.session.pk),
                "idempotency_key": str(uuid4()),
                "payment_method": "CASH",
                "items": [
                    {"sale_item_id": str(b.sale.items.get().pk), "quantity": "1", "restock": True}
                ],
            },
            format="json",
        )

    returns_before = SaleReturn.objects.count()
    response = post(b.sale.pk)

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    _assert_like_unknown(response, post(uuid4()))
    assert SaleReturn.objects.count() == returns_before


def test_customer_payment_cannot_target_another_commerce_customer(a, b) -> None:
    client = _client(a.cashier)

    def post(customer_id):
        return client.post(
            reverse("customer-payment-create"),
            {
                "idempotency_key": str(uuid4()),
                "customer_id": str(customer_id),
                "cash_session_id": str(a.session.pk),
                "method": "CASH",
                "amount": "500.00",
                "received_amount": "500.00",
            },
            format="json",
        )

    payments_before = CustomerPayment.objects.count()
    response = post(b.customer.pk)

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    _assert_like_unknown(response, post(uuid4()))
    assert CustomerPayment.objects.count() == payments_before


@pytest.mark.parametrize("field", ["category_id", "cash_session_id"])
def test_expense_cannot_reference_another_commerce(a, b, field) -> None:
    client = _client(a.cashier)
    foreign = {"category_id": b.category.pk, "cash_session_id": b.session.pk}[field]

    def post(value):
        return client.post(
            reverse("expense-list"),
            {
                "idempotency_key": str(uuid4()),
                "cash_session_id": str(a.session.pk),
                "category_id": str(a.category.pk),
                "payment_method": "WAVE",
                "amount": "100.00",
                field: str(value),
            },
            format="json",
        )

    expenses_before = Expense.objects.count()
    response = post(foreign)

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    _assert_like_unknown(response, post(uuid4()))
    assert Expense.objects.count() == expenses_before


def test_customer_cannot_be_created_in_another_commerce_store(a, b) -> None:
    client = _client(a.owner)

    def post(store_id):
        return client.post(
            reverse("customer-list"),
            {"store_id": str(store_id), "name": "Awa", "phone": "760001122"},
            format="json",
        )

    response = post(b.store.pk)

    assert response.status_code == status.HTTP_404_NOT_FOUND
    _assert_like_unknown(response, post(uuid4()))
    assert not Customer.objects.filter(name="Awa").exists()


@pytest.mark.parametrize("field", ["store_id", "product_id"])
def test_stock_in_cannot_reference_another_commerce(a, b, field) -> None:
    from django.contrib.auth.models import Permission

    a.owner.user_permissions.add(Permission.objects.get(codename="change_product"))
    client = _client(a.owner)
    foreign = {"store_id": b.store.pk, "product_id": b.product.pk}[field]

    def post(value):
        return client.post(
            reverse("inventory-stock-in"),
            {
                "store_id": str(a.store.pk),
                "product_id": str(a.product.pk),
                "quantity": "5",
                field: str(value),
            },
            format="json",
        )

    movements_before = InventoryMovement.objects.count()
    response = post(foreign)

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    _assert_like_unknown(response, post(uuid4()))
    assert InventoryMovement.objects.count() == movements_before


def test_cannot_open_a_session_on_another_commerce_register(a, b) -> None:
    client = _client(a.owner)

    def post(register_id):
        return client.post(
            reverse("cash-session-open"),
            {"cash_register_id": str(register_id), "opening_balance": "0"},
            format="json",
        )

    response = post(b.register.pk)

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    _assert_like_unknown(response, post(uuid4()))
    assert not CashSession.objects.filter(cashier=a.owner).exists()


def test_services_refuse_to_stock_a_product_in_another_commerce_store(a, b) -> None:
    with pytest.raises(CrossTenantReference):
        receive_stock(store=a.store, product=b.product, quantity=Decimal("1"))


# --- Synchronisation hors ligne ----------------------------------------------


def _push(client, *, session_id, product, event_id=None, entity_id=None, **payload):
    response = client.post(
        reverse("sync-push"),
        {
            "terminal_id": str(uuid4()),
            "events": [
                {
                    "event_id": str(event_id or uuid4()),
                    "type": "SALE_COMPLETED",
                    "entity_id": str(entity_id or uuid4()),
                    "occurred_at": (timezone.now() - timedelta(minutes=5)).isoformat(),
                    "payload": {
                        "cash_session_id": str(session_id),
                        "items": [
                            {
                                "product_id": str(product.pk),
                                "product_name": "Riz",
                                "unit_price": "1000.00",
                                "quantity": "1",
                            }
                        ],
                        "payments": [{"method": "WAVE", "amount": "1000.00"}],
                        **payload,
                    },
                }
            ],
        },
        format="json",
    )
    assert response.status_code == status.HTTP_200_OK
    return response.json()["results"][0]


def _without_event_id(result: dict) -> dict:
    return {k: v for k, v in result.items() if k != "event_id"}


def test_sync_cannot_use_another_commerce_session(a, b) -> None:
    client = _client(a.cashier)
    sales_before = Sale.objects.count()

    result = _push(client, session_id=b.session.pk, product=a.product)
    unknown = _push(client, session_id=uuid4(), product=a.product)

    assert result["status"] == "REJECTED"
    assert _without_event_id(result) == _without_event_id(unknown)
    assert Sale.objects.count() == sales_before


def test_sync_cannot_use_another_commerce_product(a, b) -> None:
    client = _client(a.cashier)

    result = _push(client, session_id=a.session.pk, product=b.product)
    unknown = _push(client, session_id=a.session.pk, product=Product(pk=uuid4()))

    assert result["status"] == "REJECTED"
    assert result["code"] == unknown["code"] == "PRODUCT_NOT_FOUND"
    assert Stock.objects.get(store=b.store).quantity == Decimal("49")


def test_sync_cannot_put_a_debt_on_another_commerce_customer(a, b) -> None:
    client = _client(a.cashier)
    credit = {"payments": [], "customer_id": str(b.customer.pk), "credit_amount": "1000.00"}

    result = _push(client, session_id=a.session.pk, product=a.product, **credit)

    assert result["status"] == "REJECTED"
    assert result["code"] == "CUSTOMER_NOT_FOUND"
    assert not b.customer.sales.exists()


def _synced_event(commerce: Commerce) -> ProcessedSyncEvent:
    result = _push(
        _client(commerce.cashier), session_id=commerce.session.pk, product=commerce.product
    )
    assert result["status"] == "SYNCED"
    return ProcessedSyncEvent.objects.get(pk=UUID(result["event_id"]))


def test_sync_replay_of_another_commerce_event_reveals_nothing(a, b) -> None:
    b_event = _synced_event(b)

    result = _push(
        _client(a.cashier), session_id=a.session.pk, product=a.product, event_id=b_event.pk
    )

    assert result["status"] == "REJECTED"
    assert result["code"] == "EVENT_ID_CONFLICT"
    assert "entity_id" not in result


def test_sync_reuse_of_another_commerce_sale_id_reveals_nothing(a, b) -> None:
    sales_before = Sale.objects.count()

    result = _push(
        _client(a.cashier), session_id=a.session.pk, product=a.product, entity_id=b.sale.pk
    )

    assert result["status"] == "REJECTED"
    assert result["code"] == "EVENT_ID_CONFLICT"
    assert "entity_id" not in result
    assert Sale.objects.count() == sales_before
    b.sale.refresh_from_db()
    assert b.sale.cash_session == b.session


def test_sync_replay_inside_the_commerce_is_still_idempotent(a, b) -> None:
    event = _synced_event(a)

    result = _push(
        _client(a.cashier), session_id=a.session.pk, product=a.product, event_id=event.pk
    )

    assert result["status"] == "ALREADY_PROCESSED"
    assert result["entity_id"] == str(event.entity_id)


def test_sync_records_the_store_of_the_event(a) -> None:
    assert _synced_event(a).store == a.store


def test_sync_pull_returns_own_catalog_only(a, b) -> None:
    changes = _client(a.cashier).get(reverse("sync-pull")).json()["changes"]

    assert [change["id"] for change in changes] == [str(a.product.pk)]
