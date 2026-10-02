"""Un remboursement en espèces ne dépasse jamais les espèces attendues du
tiroir — même règle que les dépenses. Seule la part réellement rendue en
espèces compte : la part déduite du cahier ne sort pas de la caisse."""

from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from apps.cash.models import CashSession
from apps.cash.services import close_cash_session, get_cash_session_summary
from apps.catalog.models import Product
from apps.customers.services import create_customer
from apps.inventory.models import Stock
from apps.sales.exceptions import InsufficientCashForRefund
from apps.sales.models import SaleReturn
from apps.sales.services import complete_sale, create_sale_return
from apps.stores.models import CashRegister, Store, StoreAssignment


pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def cashier():
    return User.objects.create_user(username="cashier")


@pytest.fixture
def store() -> Store:
    return Store.objects.create(name="Supérette Test")


@pytest.fixture
def cash_session(store: Store, cashier) -> CashSession:
    # Une caisse ne s'ouvre que dans un magasin où le caissier est affecté.
    StoreAssignment.objects.get_or_create(user=cashier, store=store)
    register = CashRegister.objects.create(store=store, name="Caisse 01")
    return CashSession.objects.create(
        cash_register=register, cashier=cashier, opening_balance=Decimal("0")
    )


@pytest.fixture
def product(store: Store) -> Product:
    product = Product.objects.create(name="Riz", selling_price=Decimal("10000.00"))
    Stock.objects.create(store=store, product=product, quantity=10)
    return product


def _sale(cash_session, product, payments, **credit):
    return complete_sale(
        cash_session=cash_session,
        items=[{"product_id": product.id, "quantity": 1}],
        payments=payments,
        **credit,
    )


def _return(sale, cash_session, cashier, method):
    return create_sale_return(
        original_sale=sale,
        cash_session=cash_session,
        created_by=cashier,
        items=[{"sale_item_id": sale.items.get().id, "quantity": Decimal("1"), "restock": True}],
        idempotency_key=uuid4(),
        payment_method=method,
    )


def test_cash_refund_beyond_the_drawer_is_refused(cash_session, cashier, product) -> None:
    # Vente payée par Wave : le tiroir reste vide.
    sale = _sale(cash_session, product, [{"method": "WAVE", "amount": Decimal("10000")}])

    with pytest.raises(InsufficientCashForRefund) as excinfo:
        _return(sale, cash_session, cashier, "CASH")

    assert excinfo.value.available == Decimal("0.00")
    assert "Wave ou Orange Money" in str(excinfo.value)
    assert SaleReturn.objects.count() == 0
    assert Stock.objects.get(product=product).quantity == Decimal("9.000")


def test_mobile_money_refund_is_not_limited_by_the_drawer(cash_session, cashier, product) -> None:
    sale = _sale(cash_session, product, [{"method": "WAVE", "amount": Decimal("10000")}])

    sale_return = _return(sale, cash_session, cashier, "WAVE")

    assert sale_return.payment_method == "WAVE"


def test_refund_of_exactly_the_drawer_is_accepted_and_closes(cash_session, cashier, product) -> None:
    sale = _sale(
        cash_session,
        product,
        [{"method": "CASH", "amount": Decimal("10000"), "received_amount": Decimal("10000")}],
    )

    _return(sale, cash_session, cashier, "CASH")

    assert get_cash_session_summary(cash_session=cash_session).expected_cash == Decimal("0.00")
    close_cash_session(cash_session=cash_session, counted_cash=Decimal("0"))


def test_only_the_money_part_of_a_credit_return_is_checked(
    store, cash_session, cashier, product
) -> None:
    """Vente de 10 000 : 4 000 en espèces, 6 000 au cahier. Le retour efface
    d'abord les 6 000 de dette ; seuls 4 000 sortent du tiroir, qui les a."""
    customer = create_customer(store=store, name="Moussa Fall", phone="771234567")
    sale = _sale(
        cash_session,
        product,
        [{"method": "CASH", "amount": Decimal("4000"), "received_amount": Decimal("4000")}],
        customer_id=customer.pk,
        credit_amount=Decimal("6000"),
    )

    sale_return = _return(sale, cash_session, cashier, "CASH")

    assert sale_return.credit_reduction == Decimal("6000.00")
    assert sale_return.money_refund == Decimal("4000.00")
    assert get_cash_session_summary(cash_session=cash_session).expected_cash == Decimal("0.00")


def test_api_reports_insufficient_cash_with_what_is_available(cash_session, cashier, product) -> None:
    sale = _sale(cash_session, product, [{"method": "ORANGE_MONEY", "amount": Decimal("10000")}])
    client = APIClient()
    client.force_authenticate(cashier)

    response = client.post(
        reverse("sale-return-list"),
        {
            "sale_id": str(sale.pk),
            "cash_session_id": str(cash_session.pk),
            "idempotency_key": str(uuid4()),
            "payment_method": "CASH",
            "items": [{"sale_item_id": str(sale.items.get().id), "quantity": "1", "restock": True}],
        },
        format="json",
    )

    assert response.status_code == 409, response.content
    body = response.json()
    assert body["code"] == "INSUFFICIENT_CASH"
    assert body["available"] == "0.00"
    assert "Pas assez d’espèces en caisse pour rembourser" in body["message"]
