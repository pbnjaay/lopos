"""Deux commerces complets sur la même base, pour les tests d'isolation."""

from dataclasses import dataclass
from decimal import Decimal
from uuid import uuid4

from django.contrib.auth import get_user_model

from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.customers.models import Customer, CustomerPayment
from apps.customers.services import (
    create_customer,
    record_customer_payment,
    record_opening_balance,
)
from apps.expenses.models import Expense, ExpenseCategory
from apps.expenses.services import create_expense
from apps.inventory.services import receive_stock
from apps.sales.models import Sale, SaleReturn
from apps.sales.services import complete_sale, create_sale_return
from apps.stores.models import CashRegister, Store, StoreAssignment
from apps.tenancy.models import Organization, OrganizationMembership

User = get_user_model()
Role = OrganizationMembership.Role


@dataclass
class Commerce:
    organization: Organization
    store: Store
    owner: User
    cashier: User
    register: CashRegister
    session: CashSession
    product: Product
    customer: Customer
    sale: Sale
    sale_return: SaleReturn
    payment: CustomerPayment
    category: ExpenseCategory
    expense: Expense


def build_commerce(slug: str) -> Commerce:
    organization = Organization.objects.create(name=f"Commerce {slug}", slug=slug)
    store = Store.objects.create(name=f"Magasin {slug}", organization=organization)
    owner = User.objects.create_user(username=f"owner-{slug}", is_staff=True)
    OrganizationMembership.objects.create(organization=organization, user=owner, role=Role.OWNER)
    cashier = User.objects.create_user(username=f"cashier-{slug}")
    OrganizationMembership.objects.create(
        organization=organization, user=cashier, role=Role.CASHIER
    )
    StoreAssignment.objects.create(user=cashier, store=store)
    register = CashRegister.objects.create(store=store, name="Caisse 01")
    session = CashSession.objects.create(
        cash_register=register, cashier=cashier, opening_balance=Decimal("20000")
    )
    product = Product.objects.create(
        name=f"Riz {slug}", selling_price=Decimal("1000"), organization=organization
    )
    receive_stock(store=store, product=product, quantity=Decimal("50"), unit_cost=Decimal("700"))
    customer = create_customer(store=store, name=f"Client {slug}", phone="771234567")
    record_opening_balance(customer=customer, amount=Decimal("5000"))
    sale = complete_sale(
        cash_session=session,
        items=[{"product_id": product.pk, "quantity": Decimal("2"), "unit_price": None}],
        payments=[{"method": "CASH", "amount": Decimal("2000"), "received_amount": Decimal("2000")}],
    )
    sale_return = create_sale_return(
        original_sale=sale,
        cash_session=session,
        created_by=cashier,
        items=[{"sale_item_id": sale.items.get().pk, "quantity": Decimal("1"), "restock": True}],
        idempotency_key=uuid4(),
        payment_method="CASH",
    )
    payment = record_customer_payment(
        customer=customer,
        cash_session=session,
        created_by=cashier,
        method="CASH",
        amount=Decimal("1000"),
        received_amount=Decimal("1000"),
        idempotency_key=uuid4(),
    )
    category = ExpenseCategory.objects.create(name=f"Loyer {slug}", organization=organization)
    expense = create_expense(
        cash_session=session,
        created_by=cashier,
        category=category,
        amount=Decimal("500"),
        payment_method="CASH",
        idempotency_key=uuid4(),
    )
    return Commerce(
        organization, store, owner, cashier, register, session, product, customer,
        sale, sale_return, payment, category, expense,
    )
