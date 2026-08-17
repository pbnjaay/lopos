from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction

from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.sales.models import Payment, Sale, SaleItem
from apps.stores.models import CashRegister, Store


pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def cashier():
    return User.objects.create_user(username="cashier")


@pytest.fixture
def cash_session(cashier) -> CashSession:
    store = Store.objects.create(name="Supérette Test")
    cash_register = CashRegister.objects.create(store=store, name="Caisse 01")
    return CashSession.objects.create(
        cash_register=cash_register,
        cashier=cashier,
        opening_balance=Decimal("15000.00"),
    )


@pytest.fixture
def sale(cash_session: CashSession, cashier) -> Sale:
    return Sale.objects.create(
        cash_session=cash_session,
        cashier=cashier,
        subtotal=Decimal("1000.00"),
        discount=Decimal("0.00"),
        total=Decimal("1000.00"),
        status=Sale.Status.COMPLETED,
    )


@pytest.fixture
def product() -> Product:
    return Product.objects.create(
        name="Coca 50cl",
        selling_price=Decimal("500.00"),
    )


def test_sale_amounts_must_be_consistent(cash_session: CashSession, cashier) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        Sale.objects.create(
            cash_session=cash_session,
            cashier=cashier,
            subtotal=Decimal("1000.00"),
            discount=Decimal("100.00"),
            total=Decimal("1000.00"),
            status=Sale.Status.COMPLETED,
        )


def test_sale_item_keeps_product_snapshot(sale: Sale, product: Product) -> None:
    item = SaleItem.objects.create(
        sale=sale,
        product=product,
        product_name=product.name,
        unit_price=product.selling_price,
        quantity=2,
        line_total=Decimal("1000.00"),
    )

    product.name = "Coca nouveau nom"
    product.selling_price = Decimal("600.00")
    product.save(update_fields=("name", "selling_price"))
    item.refresh_from_db()

    assert item.product_name == "Coca 50cl"
    assert item.unit_price == Decimal("500.00")


@pytest.mark.parametrize(
    ("quantity", "line_total"),
    [(0, Decimal("0.00")), (2, Decimal("999.00"))],
)
def test_sale_item_rejects_invalid_quantity_or_total(
    sale: Sale,
    product: Product,
    quantity: int,
    line_total: Decimal,
) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        SaleItem.objects.create(
            sale=sale,
            product=product,
            product_name=product.name,
            unit_price=Decimal("500.00"),
            quantity=quantity,
            line_total=line_total,
        )


def test_cash_payment_requires_exact_change_calculation(sale: Sale) -> None:
    payment = Payment.objects.create(
        sale=sale,
        method=Payment.Method.CASH,
        amount=Decimal("1000.00"),
        received_amount=Decimal("2000.00"),
        change_amount=Decimal("1000.00"),
    )

    assert payment.change_amount == Decimal("1000.00")


@pytest.mark.parametrize(
    ("received_amount", "change_amount"),
    [
        (Decimal("500.00"), Decimal("0.00")),
        (Decimal("2000.00"), Decimal("999.00")),
        (None, None),
    ],
)
def test_cash_payment_rejects_invalid_details(
    sale: Sale,
    received_amount: Decimal | None,
    change_amount: Decimal | None,
) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        Payment.objects.create(
            sale=sale,
            method=Payment.Method.CASH,
            amount=Decimal("1000.00"),
            received_amount=received_amount,
            change_amount=change_amount,
        )


@pytest.mark.parametrize("method", [Payment.Method.WAVE, Payment.Method.ORANGE_MONEY])
def test_mobile_payment_requires_null_received_and_change(
    sale: Sale,
    method: str,
) -> None:
    payment = Payment.objects.create(
        sale=sale,
        method=method,
        amount=Decimal("1000.00"),
    )

    assert payment.received_amount is None
    assert payment.change_amount is None


def test_sale_accepts_only_one_payment(sale: Sale) -> None:
    Payment.objects.create(
        sale=sale,
        method=Payment.Method.WAVE,
        amount=Decimal("1000.00"),
    )

    with pytest.raises(IntegrityError), transaction.atomic():
        Payment.objects.create(
            sale=sale,
            method=Payment.Method.ORANGE_MONEY,
            amount=Decimal("1000.00"),
        )
