"""Une catégorie de dépense appartient toujours à un commerce.

Avant le NOT NULL, une catégorie sans commerce :
- jamais utilisée et en double d'une catégorie du commerce (ou sans aucun
  commerce, comme les 8 catégories semées sur une installation neuve) :
  supprimée — chaque commerce reçoit les siennes à son arrivée ;
- sinon rattachée au commerce unique s'il n'y en a qu'un ;
- sinon la migration s'arrête en disant quoi corriger.
"""

import django.db.models.deletion
from django.db import migrations, models


def _attach_or_refuse(apps, schema_editor):
    ExpenseCategory = apps.get_model("expenses", "ExpenseCategory")
    Organization = apps.get_model("tenancy", "Organization")
    orphans = ExpenseCategory.objects.filter(organization__isnull=True)
    if not orphans.exists():
        return
    unused = orphans.filter(expenses__isnull=True)
    organizations = list(Organization.objects.all()[:2])

    if not organizations:
        unused.delete()
    elif len(organizations) == 1:
        organization = organizations[0]
        taken = ExpenseCategory.objects.filter(organization=organization).values("name")
        unused.filter(name__in=taken).delete()
        orphans.update(organization=organization)

    remaining = ExpenseCategory.objects.filter(organization__isnull=True).count()
    if remaining:
        raise RuntimeError(
            f"{remaining} catégorie(s) de dépense sans organisation, déjà utilisées. "
            "Rattachez-les à leur commerce (voir `tenancy_audit`), puis relancez "
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
        ("expenses", "0005_unique_per_organization"),
        ("tenancy", "0003_manager_store_assignments"),
    ]

    operations = [
        migrations.RunPython(attach_or_refuse, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="expensecategory",
            name="organization",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="expense_categories",
                to="tenancy.organization",
                verbose_name="organisation",
            ),
        ),
    ]
