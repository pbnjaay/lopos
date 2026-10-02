from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import override_settings

from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.inventory.models import InventoryMovement, Stock
from apps.stores.models import CashRegister, Store
from apps.tenancy.models import Organization, OrganizationMembership


pytestmark = [pytest.mark.django_db, pytest.mark.explicit_tenancy]
User = get_user_model()


@override_settings(DEBUG=True)
def test_seed_demo_is_idempotent_and_preserves_existing_admin_password() -> None:
    admin = User.objects.create_superuser(
        username="admin",
        password="Passer1234",
        email="admin@localhost",
    )
    first_output = StringIO()
    second_output = StringIO()

    call_command("seed_demo", "--open-session", stdout=first_output)
    call_command("seed_demo", "--open-session", stdout=second_output)

    admin.refresh_from_db()
    assert admin.check_password("Passer1234")
    assert "admin (existant, mot de passe inchangé)" in first_output.getvalue()
    assert Store.objects.filter(name="Supérette Louga Centre").count() == 1
    assert CashRegister.objects.filter(name="Caisse 01").count() == 1
    assert Product.objects.count() == 5
    assert Stock.objects.count() == 5
    assert sorted(Stock.objects.values_list("quantity", flat=True)) == [15, 25, 30, 40, 60]
    assert InventoryMovement.objects.filter(
        movement_type=InventoryMovement.Type.STOCK_IN
    ).count() == 5
    assert CashSession.objects.filter(status=CashSession.Status.OPEN).count() == 1
    # Le stock de démo entre au prix d'achat : valorisation et marges ont des chiffres.
    assert not Stock.objects.filter(average_unit_cost__isnull=True).exists()
    assert Stock.objects.get(product__name="Coca 50cl").average_unit_cost == 350


@override_settings(DEBUG=True)
def test_seed_demo_creates_one_commerce_with_an_owner_and_a_cashier() -> None:
    call_command("seed_demo", stdout=StringIO())
    call_command("seed_demo", stdout=StringIO())

    organization = Organization.objects.get()
    assert Store.objects.get().organization == organization
    assert not Product.objects.exclude(organization=organization).exists()
    roles = dict(
        OrganizationMembership.objects.values_list("user__username", "role")
    )
    assert roles == {"caissier": "CASHIER", "proprietaire": "OWNER"}
    assert not OrganizationMembership.objects.filter(user__username="admin").exists()


@override_settings(DEBUG=True)
def test_seed_demo_reuses_the_existing_commerce() -> None:
    pilot = Organization.objects.create(name="Organisation pilote", slug="pilote")

    call_command("seed_demo", stdout=StringIO())

    assert list(Organization.objects.all()) == [pilot]
    assert Store.objects.get().organization == pilot


@override_settings(DEBUG=True)
def test_seed_demo_refuses_a_hosted_database_even_in_debug(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgres://user:pass@db.example.com:5432/lopos")

    with pytest.raises(CommandError, match="DATABASE_URL"):
        call_command("seed_demo", stdout=StringIO())

    assert not User.objects.filter(username="admin").exists()
    assert not Organization.objects.exists()
