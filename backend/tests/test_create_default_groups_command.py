import pytest
from django.contrib.auth.models import Group, Permission
from django.core.management import call_command


pytestmark = pytest.mark.django_db


def test_creates_manager_and_cashier_groups() -> None:
    call_command("create_default_groups")

    assert Group.objects.filter(name="Gérant").exists()
    assert Group.objects.filter(name="Caissier").exists()


def test_manager_group_can_manage_catalog_but_only_view_audit_models() -> None:
    call_command("create_default_groups")
    manager_group = Group.objects.get(name="Gérant")
    codenames = set(manager_group.permissions.values_list("codename", flat=True))

    assert {"add_product", "change_product", "delete_product", "view_product"} <= codenames
    assert "change_sale" not in codenames
    assert "change_cashsession" not in codenames
    assert "view_sale" in codenames
    assert "view_cashsession" in codenames
    assert {
        "add_storeassignment",
        "change_storeassignment",
        "delete_storeassignment",
        "view_storeassignment",
    } <= codenames


def test_cashier_group_has_no_admin_permissions() -> None:
    call_command("create_default_groups")
    cashier_group = Group.objects.get(name="Caissier")

    assert cashier_group.permissions.count() == 0


def test_command_is_idempotent_and_stays_in_sync() -> None:
    manager_group = Group.objects.create(name="Gérant")
    manager_group.permissions.add(
        Permission.objects.get(content_type__app_label="auth", codename="add_group")
    )

    call_command("create_default_groups")

    manager_group.refresh_from_db()
    codenames = set(manager_group.permissions.values_list("codename", flat=True))
    assert "add_group" not in codenames
    assert "view_product" in codenames
