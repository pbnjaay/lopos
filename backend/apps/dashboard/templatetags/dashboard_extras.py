from django import template

from apps.dashboard.formatting import format_fcfa

register = template.Library()


@register.filter(name="fcfa")
def fcfa(value):
    return format_fcfa(value)


@register.filter(name="settlement")
def settlement(sale):
    """« Espèces + Cahier » : comment la vente a été réglée, cahier compris.

    Lit les paiements préchargés (`prefetch_related("payments")`) : aucune
    requête de plus par ligne.
    """
    labels = [payment.get_method_display() for payment in sale.payments.all()]
    if sale.credit_amount:
        labels.append("Cahier")
    return " + ".join(labels)


@register.filter(name="uncovered_share")
def uncovered_share(coverage_percent):
    """Part du CA sans coût d'achat, à partir de la couverture (en %). Une
    part arrondie à 0 alors que des ventes n'ont pas de coût se lit
    « moins de 1 »."""
    share = 100 - coverage_percent
    return share if share > 0 else "moins de 1"
