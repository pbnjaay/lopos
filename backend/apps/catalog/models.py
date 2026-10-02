import re
import uuid
from decimal import Decimal

from django.db import models
from django.db.models import Q

from apps.tenancy.models import Organization

_WHITESPACE_RE = re.compile(r"\s+")


def format_product_name(raw_name: str) -> str:
    """Normalise un nom de produit saisi à la main.

    Selon le caissier, un même produit arrive en "COCA COLA 50CL", "coca
    cola 50cl" ou "Coca Cola 50CL" — visuellement incohérent dans le
    catalogue. On met en casse de titre chaque mot qui n'a qu'une seule
    casse (tout majuscule ou tout minuscule), et on laisse intacts ceux qui
    mélangent déjà les deux (ex. "iPhone") pour ne pas abîmer une casse
    volontaire — au prix de ne pas pouvoir distinguer un sigle voulu en
    majuscules ("CFA") d'une saisie clavier verrouillé en majuscules.
    """
    collapsed = _WHITESPACE_RE.sub(" ", raw_name).strip()
    words = [
        word.capitalize() if word.isupper() or word.islower() else word
        for word in collapsed.split(" ")
    ]
    return " ".join(words)


class Product(models.Model):
    class SaleUnit(models.TextChoices):
        UNIT = "UNIT", "Unité"
        KG = "KG", "Kilogramme"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Le catalogue est celui du commerce, partagé par ses magasins ; chaque
    # magasin garde son propre stock et son propre coût moyen (`Stock`).
    organization = models.ForeignKey(
        Organization,
        on_delete=models.PROTECT,
        related_name="products",
        verbose_name="organisation",
    )
    name = models.CharField("nom", max_length=255)
    barcode = models.CharField("code-barres", max_length=64, blank=True, null=True)
    selling_price = models.DecimalField("prix de vente", max_digits=14, decimal_places=2)
    purchase_price = models.DecimalField(
        "dernier prix d'achat",
        max_digits=14,
        decimal_places=2,
        blank=True,
        null=True,
        help_text=(
            "Prix payé au fournisseur lors de la dernière réception, mis à jour "
            "à chaque réception et proposé pour la suivante. Le modifier ne "
            "change pas la valeur du stock, calculée au coût moyen par magasin."
        ),
    )
    sale_unit = models.CharField(
        "unité de vente", max_length=8, choices=SaleUnit.choices, default=SaleUnit.UNIT
    )
    low_stock_threshold = models.PositiveIntegerField(
        "seuil de stock faible",
        blank=True,
        null=True,
        help_text=(
            "En dessous de cette quantité, le produit est signalé en stock "
            "faible. Laisser vide pour utiliser le seuil par défaut de la boutique."
        ),
    )
    is_active = models.BooleanField("actif", default=True)
    created_at = models.DateTimeField("créé le", auto_now_add=True)
    updated_at = models.DateTimeField("modifié le", auto_now=True)

    class Meta:
        ordering = ("name",)
        verbose_name = "produit"
        verbose_name_plural = "produits"
        constraints = [
            models.CheckConstraint(
                condition=Q(selling_price__gte=Decimal("0")),
                name="catalog_product_selling_price_nonnegative",
            ),
            models.CheckConstraint(
                condition=Q(purchase_price__isnull=True)
                | Q(purchase_price__gte=Decimal("0")),
                name="catalog_product_purchase_price_nonnegative",
            ),
            # Unique dans le catalogue d'un commerce, pas dans toute la base :
            # deux boutiques indépendantes peuvent coder leurs produits pareil.
            models.UniqueConstraint(
                fields=("organization", "barcode"),
                condition=Q(barcode__isnull=False),
                name="catalog_unique_product_barcode_per_organization",
            ),
        ]

    def __str__(self) -> str:
        return self.name

    def save(self, *args, **kwargs) -> None:
        self.name = format_product_name(self.name)
        super().save(*args, **kwargs)
