from decimal import Decimal

from django.db import migrations

# Marque les initialisations faites par cette migration : c'est ce qui permet
# de les retrouver (audit) et de les défaire (retour arrière) sans toucher à
# une initialisation faite plus tard à la main.
INITIAL_REASON = "Initialisé depuis le prix d'achat catalogue"


def initialize_average_cost(apps, schema_editor):
    """Initialisation unique du coût moyen des stocks existants.

    Règle validée : coût moyen inconnu ET prix d'achat catalogue connu →
    coût moyen = prix d'achat, avec une ligne d'audit par stock. Un prix
    d'achat à 0 compte comme inconnu : c'est presque toujours une saisie ou
    un import par défaut, et il gonflerait la marge. Rejouée, elle ne fait
    rien (seuls les coûts encore inconnus sont concernés).
    """
    Stock = apps.get_model("inventory", "Stock")
    StockCostChange = apps.get_model("inventory", "StockCostChange")

    rows = list(
        Stock.objects.filter(
            average_unit_cost__isnull=True,
            product__purchase_price__gt=Decimal("0"),
        ).values_list("id", "store_id", "product_id", "quantity", "product__purchase_price")
    )
    if not rows:
        return

    StockCostChange.objects.bulk_create(
        [
            StockCostChange(
                store_id=store_id,
                product_id=product_id,
                source="INITIAL",
                previous_cost=None,
                new_cost=purchase_price,
                quantity_at_change=quantity,
                reason=INITIAL_REASON,
                created_by=None,
            )
            for _id, store_id, product_id, quantity, purchase_price in rows
        ],
        batch_size=500,
    )
    for stock_id, _store_id, _product_id, _quantity, purchase_price in rows:
        Stock.objects.filter(pk=stock_id, average_unit_cost__isnull=True).update(
            average_unit_cost=purchase_price
        )


def forget_initial_average_cost(apps, schema_editor):
    """Défait uniquement ce que cette migration a posé."""
    Stock = apps.get_model("inventory", "Stock")
    StockCostChange = apps.get_model("inventory", "StockCostChange")

    changes = StockCostChange.objects.filter(
        source="INITIAL", reason=INITIAL_REASON, created_by__isnull=True
    )
    for store_id, product_id, new_cost in changes.values_list("store_id", "product_id", "new_cost"):
        Stock.objects.filter(
            store_id=store_id, product_id=product_id, average_unit_cost=new_cost
        ).update(average_unit_cost=None)
    changes.delete()


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0006_stock_costing"),
    ]

    operations = [
        migrations.RunPython(initialize_average_cost, forget_initial_average_cost),
    ]
