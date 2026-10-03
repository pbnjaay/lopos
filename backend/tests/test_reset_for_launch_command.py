from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth.models import Group
from django.contrib.auth import get_user_model
from django.core.management import CommandError, call_command
from django.db import connection

from apps.catalog.models import Product
from apps.expenses.models import ExpenseCategory
from apps.stores.models import Store


pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def some_data() -> None:
    Store.objects.create(name="Supérette Louga")
    Product.objects.create(name="Coca 50cl", selling_price=Decimal("500.00"))
    User.objects.create_user(username="caissier", password="password123")
    # Le test tient tout dans une transaction : les contrôles de clés
    # étrangères différés de ces insertions y restent en attente, et
    # PostgreSQL refuse alors le TRUNCATE de `flush`. En production la
    # commande tourne hors transaction, sans rien en attente.
    with connection.cursor() as cursor:
        cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")


def _db_name() -> str:
    return connection.settings_dict["NAME"]


def test_wrong_confirmation_deletes_nothing(some_data) -> None:
    with pytest.raises(CommandError):
        with patch("builtins.input", return_value="ce-nest-pas-le-bon-nom"):
            call_command("reset_for_launch")

    assert Store.objects.count() == 1
    assert Product.objects.count() == 1
    assert User.objects.count() == 1


def test_typing_the_db_name_flushes_everything(some_data) -> None:
    with patch("builtins.input", return_value=_db_name()):
        call_command("reset_for_launch")

    assert Store.objects.count() == 0
    assert Product.objects.count() == 0
    assert User.objects.count() == 0


def test_flush_recreates_the_role_groups(some_data) -> None:
    with patch("builtins.input", return_value=_db_name()):
        call_command("reset_for_launch")

    assert set(Group.objects.values_list("name", flat=True)) == {
        "Propriétaire",
        "Gérant",
        "Caissier",
    }



def test_flush_leaves_no_expense_category_without_a_commerce(some_data) -> None:
    """Une catégorie appartient toujours à un commerce : après un vidage, il
    n'en existe plus aucune, chaque commerce reçoit les siennes à son arrivée."""
    with patch("builtins.input", return_value=_db_name()):
        call_command("reset_for_launch")

    assert not ExpenseCategory.objects.exists()


def test_yes_flag_skips_the_interactive_prompt(some_data) -> None:
    with patch("builtins.input") as mocked_input:
        call_command("reset_for_launch", "--yes")

    mocked_input.assert_not_called()
    assert Store.objects.count() == 0
