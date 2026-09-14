import re

from django.db import migrations

_WHITESPACE_RE = re.compile(r"\s+")


def _format_product_name(raw_name: str) -> str:
    # Doit rester une copie figée de apps.catalog.models.format_product_name :
    # une migration de données ne doit pas dépendre d'un code applicatif qui
    # peut changer après coup.
    collapsed = _WHITESPACE_RE.sub(" ", raw_name).strip()
    words = [
        word.capitalize() if word.isupper() or word.islower() else word
        for word in collapsed.split(" ")
    ]
    return " ".join(words)


def format_existing_names(apps, schema_editor):
    Product = apps.get_model("catalog", "Product")
    for product in Product.objects.all():
        formatted = _format_product_name(product.name)
        if formatted != product.name:
            Product.objects.filter(pk=product.pk).update(name=formatted)


def noop_reverse(apps, schema_editor):
    # Normalisation non réversible (perte d'info sur la casse d'origine) :
    # on n'essaie pas de revenir en arrière.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0003_product_sale_unit"),
    ]

    operations = [
        migrations.RunPython(format_existing_names, noop_reverse),
    ]
