"""Un magasin appartient toujours à un commerce.

Garde avant le NOT NULL : un magasin resté sans commerce est rattaché au
commerce unique s'il n'y en a qu'un (comme `tenancy 0002`) ; sinon rien
n'est deviné et la migration s'arrête en disant quoi corriger.
"""

import django.db.models.deletion
from django.db import migrations, models


def _attach_or_refuse(apps, schema_editor):
    Store = apps.get_model("stores", "Store")
    Organization = apps.get_model("tenancy", "Organization")
    orphans = Store.objects.filter(organization__isnull=True)
    if not orphans.exists():
        return
    organizations = list(Organization.objects.all()[:2])
    if len(organizations) == 1:
        orphans.update(organization=organizations[0])
        return
    raise RuntimeError(
        f"{orphans.count()} magasin(s) sans organisation et pas de commerce unique "
        "auquel les rattacher. Rattachez-les dans l'administration (Magasins, "
        "voir `tenancy_audit`), puis relancez `migrate`."
    )


def attach_or_refuse(apps, schema_editor):
    _attach_or_refuse(apps, schema_editor)
    # Les contrôles de clés étrangères différés de ces écritures resteraient
    # en attente, et PostgreSQL refuserait l'ALTER TABLE qui suit dans la
    # même transaction : ils sont vérifiés maintenant.
    schema_editor.execute("SET CONSTRAINTS ALL IMMEDIATE")


class Migration(migrations.Migration):
    dependencies = [
        ("stores", "0004_store_organization"),
        ("tenancy", "0003_manager_store_assignments"),
    ]

    operations = [
        migrations.RunPython(attach_or_refuse, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="store",
            name="organization",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="stores",
                to="tenancy.organization",
                verbose_name="organisation",
            ),
        ),
    ]
