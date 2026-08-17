import uuid

import pytest
from django.contrib import admin
from django.db import IntegrityError, transaction

from apps.stores.models import CashRegister, Store


pytestmark = pytest.mark.django_db


def test_store_uses_uuid_and_defaults_to_active() -> None:
    store = Store.objects.create(name="Supérette Louga Centre")

    assert isinstance(store.id, uuid.UUID)
    assert store.is_active is True
    assert store.created_at is not None
    assert store.updated_at is not None


def test_register_name_is_unique_inside_a_store() -> None:
    store = Store.objects.create(name="Supérette Louga Centre")
    CashRegister.objects.create(store=store, name="Caisse 01")

    with pytest.raises(IntegrityError), transaction.atomic():
        CashRegister.objects.create(store=store, name="Caisse 01")


def test_register_name_can_be_reused_in_another_store() -> None:
    first_store = Store.objects.create(name="Louga")
    second_store = Store.objects.create(name="Dakar")

    CashRegister.objects.create(store=first_store, name="Caisse 01")
    CashRegister.objects.create(store=second_store, name="Caisse 01")

    assert CashRegister.objects.count() == 2


def test_store_and_register_are_registered_in_admin() -> None:
    assert Store in admin.site._registry
    assert CashRegister in admin.site._registry
