from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import override_settings

from apps.cash.models import CashSession
from apps.catalog.models import Product
from apps.inventory.models import InventoryMovement, Stock
from apps.stores.models import CashRegister, Store


pytestmark = pytest.mark.django_db
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
