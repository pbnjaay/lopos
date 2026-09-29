from django.db import migrations

# Copie figée de `apps.expenses.defaults.DEFAULT_CATEGORIES` au moment de la
# migration : une migration ne doit pas changer si la liste évolue ensuite.
CATEGORIES = (
    ("Électricité", False),
    ("Eau", False),
    ("Transport", False),
    ("Service", True),
    ("Nettoyage", False),
    ("Réparation", True),
    ("Achat divers", True),
    ("Autre", True),
)


def create_default_categories(apps, schema_editor):
    ExpenseCategory = apps.get_model("expenses", "ExpenseCategory")
    for position, (name, requires_description) in enumerate(CATEGORIES):
        ExpenseCategory.objects.get_or_create(
            name=name,
            defaults={
                "requires_description": requires_description,
                "sort_order": (position + 1) * 10,
            },
        )


class Migration(migrations.Migration):
    dependencies = [("expenses", "0001_initial")]

    operations = [
        migrations.RunPython(create_default_categories, migrations.RunPython.noop),
    ]
