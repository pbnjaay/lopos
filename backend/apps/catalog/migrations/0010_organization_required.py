"""Un produit appartient toujours au catalogue d'un commerce.

Même garde que pour les magasins : rattaché au commerce unique s'il n'y en
a qu'un, sinon la migration s'arrête en disant quoi corriger.
"""

import django.db.models.deletion
from django.db import migrations, models


def _attach_or_refuse(apps, schema_editor):
    Product = apps.get_model("catalog", "Product")
    Organization = apps.get_model("tenancy", "Organization")
    orphans = Product.objects.filter(organization__isnull=True)
    if not orphans.exists():
        return
    organizations = list(Organization.objects.all()[:2])
    if len(organizations) == 1:
        orphans.update(organization=organizations[0])
        return
    raise RuntimeError(
        f"{orphans.count()} produit(s) sans organisation et pas de commerce unique "
        "auquel les rattacher. Rattachez-les (voir `tenancy_audit`), puis relancez "
        "`migrate`."
    )


def attach_or_refuse(apps, schema_editor):
    _attach_or_refuse(apps, schema_editor)
    # Les contrôles de clés étrangères différés de ces écritures resteraient
    # en attente, et PostgreSQL refuserait l'ALTER TABLE qui suit dans la
    # même transaction : ils sont vérifiés maintenant.
    schema_editor.execute("SET CONSTRAINTS ALL IMMEDIATE")


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0009_unique_per_organization"),
        ("tenancy", "0003_manager_store_assignments"),
    ]

    operations = [
        migrations.RunPython(attach_or_refuse, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="product",
            name="organization",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="products",
                to="tenancy.organization",
                verbose_name="organisation",
            ),
        ),
    ]
