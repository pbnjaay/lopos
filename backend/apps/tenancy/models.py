import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q


class OrganizationQuerySet(models.QuerySet):
    def sole(self) -> "Organization | None":
        """L'organisation de la base quand il n'en existe qu'une, sinon None.

        Pour les outils d'une installation à un seul commerce (démo,
        catégories par défaut) ; jamais pour deviner le commerce d'une
        donnée créée par un compte, qui vient toujours de son contexte."""
        organizations = list(self.order_by()[:2])
        return organizations[0] if len(organizations) == 1 else None


class Organization(models.Model):
    """Le commerçant : une entreprise, un ou plusieurs magasins, ses comptes.

    Aucune donnée d'une organisation n'est visible d'une autre ; seul un
    super-utilisateur de la plateforme les voit toutes.
    """

    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        SUSPENDED = "SUSPENDED", "Suspendue"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField("nom", max_length=255)
    slug = models.SlugField(
        "identifiant",
        max_length=64,
        unique=True,
        help_text="Court et stable, sert de préfixe aux identifiants (ex. « ndiaye »).",
    )
    status = models.CharField(
        "statut", max_length=16, choices=Status.choices, default=Status.ACTIVE
    )
    created_at = models.DateTimeField("créée le", auto_now_add=True)
    updated_at = models.DateTimeField("modifiée le", auto_now=True)

    objects = OrganizationQuerySet.as_manager()

    class Meta:
        ordering = ("name",)
        verbose_name = "organisation"
        verbose_name_plural = "organisations"
        constraints = [
            models.CheckConstraint(
                condition=~Q(name=""),
                name="tenancy_organization_name_not_empty",
            ),
            models.CheckConstraint(
                condition=Q(status__in=("ACTIVE", "SUSPENDED")),
                name="tenancy_organization_status_valid",
            ),
        ]

    def __str__(self) -> str:
        return self.name


class OrganizationMembership(models.Model):
    """Appartenance d'un compte à une organisation, avec son rôle.

    Les magasins accessibles restent donnés par `StoreAssignment` ; un
    propriétaire accède à tous les magasins de son organisation.
    """

    class Role(models.TextChoices):
        OWNER = "OWNER", "Propriétaire"
        MANAGER = "MANAGER", "Gérant"
        CASHIER = "CASHIER", "Caissier"

    organization = models.ForeignKey(
        Organization,
        on_delete=models.PROTECT,
        related_name="memberships",
        verbose_name="organisation",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="memberships",
        verbose_name="utilisateur",
    )
    role = models.CharField("rôle", max_length=16, choices=Role.choices)
    can_view_costs = models.BooleanField(
        "voit les coûts et marges",
        default=False,
        help_text=(
            "Pour un gérant : coût d'achat, valorisation du stock et marges. "
            "Un propriétaire les voit toujours, un caissier jamais."
        ),
    )
    is_active = models.BooleanField("actif", default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="memberships_created",
        verbose_name="créé par",
        blank=True,
        null=True,
    )
    created_at = models.DateTimeField("créé le", auto_now_add=True)
    updated_at = models.DateTimeField("modifié le", auto_now=True)

    class Meta:
        ordering = ("organization__name", "user__username")
        verbose_name = "membre"
        verbose_name_plural = "membres"
        constraints = [
            models.UniqueConstraint(
                fields=("organization", "user"),
                name="tenancy_unique_membership_per_organization",
            ),
            # V1 : un compte n'agit que pour un seul commerce à la fois, ce qui
            # évite tout sélecteur d'organisation. Retirer cette contrainte
            # suffira le jour où un compte devra en servir plusieurs.
            models.UniqueConstraint(
                fields=("user",),
                condition=Q(is_active=True),
                name="tenancy_one_active_membership_per_user",
            ),
            models.CheckConstraint(
                condition=Q(role__in=("OWNER", "MANAGER", "CASHIER")),
                name="tenancy_membership_role_valid",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user} — {self.organization} ({self.get_role_display()})"
