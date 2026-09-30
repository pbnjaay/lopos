"""Colonnes d'admin lisibles pour les montants et les quantités.

Sans elles, Django affiche les décimaux tels que stockés : « 25000,00 » pour
un montant, « 6,000 » pour six unités. Chaque admin déclare ses colonnes en
une ligne, par exemple `total_display = money_column("total", "total")`, et
les utilise aussi bien en liste qu'en fiche.
"""

from django.contrib import admin
from unfold.decorators import display

from .formatting import format_fcfa, format_quantity


def _resolve(obj, path: str):
    for part in path.split("__"):
        if obj is None:
            return None
        obj = getattr(obj, part)
    return obj


def money_column(field: str, description: str):
    """Montant en FCFA (« 25 000 FCFA ») ; « — » quand il est vide."""

    @admin.display(description=description, ordering=field)
    def column(self, obj) -> str:
        value = _resolve(obj, field)
        return "—" if value is None else format_fcfa(value)

    return column


def quantity_column(field: str, description: str, *, unit_field: str = "sale_unit"):
    """Quantité (« 6 », « 18,25 kg »), selon l'unité de vente de `unit_field`
    (chemin avec « __ » accepté, ex. « product__sale_unit »)."""

    @admin.display(description=description, ordering=field)
    def column(self, obj) -> str:
        return format_quantity(_resolve(obj, field), _resolve(obj, unit_field))

    return column


def status_badge(field: str, description: str, colors: dict[str, str]):
    """Statut en pastille colorée (Unfold) : « Terminée » en vert, « Annulée »
    en rouge… `colors` associe chaque valeur à un type de pastille (success,
    danger, warning, info) ; une valeur absente reste grise."""

    @display(description=description, ordering=field, label=colors)
    def column(self, obj):
        value = getattr(obj, field)
        text = getattr(obj, f"get_{field}_display")()
        # Sans couleur associée, Unfold afficherait la clé brute (« CLOSED ») :
        # on ne lui passe alors que le libellé, en pastille grise.
        return (value, text) if value in colors else text

    return column
