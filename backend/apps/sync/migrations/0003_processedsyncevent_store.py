import django.db.models.deletion
from django.db import migrations, models
from django.db.models import OuterRef, Subquery


def backfill_store_from_sale(apps, schema_editor):
    """Chaque événement traité a produit une vente (`entity_id`) : son
    magasin est celui de la caisse de cette vente."""
    ProcessedSyncEvent = apps.get_model("sync", "ProcessedSyncEvent")
    Sale = apps.get_model("sales", "Sale")
    ProcessedSyncEvent.objects.filter(store__isnull=True).update(
        store_id=Subquery(
            Sale.objects.filter(pk=OuterRef("entity_id")).values(
                "cash_session__cash_register__store_id"
            )[:1]
        )
    )


class Migration(migrations.Migration):

    dependencies = [
        ("sales", "0011_list_names"),
        ("stores", "0004_store_organization"),
        ("sync", "0002_processed_sync_event_pushed_by"),
    ]

    operations = [
        migrations.AddField(
            model_name="processedsyncevent",
            name="store",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="sync_events",
                to="stores.store",
                verbose_name="magasin",
            ),
        ),
        migrations.RunPython(backfill_store_from_sale, migrations.RunPython.noop),
    ]
