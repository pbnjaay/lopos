from django.conf import settings
from django.db import models


class ProcessedSyncEvent(models.Model):
    """Trace un événement de synchronisation qui a produit une vente.

    C'est l'invariant central de la Phase F : `event_id` est la PK (donc
    UNIQUE au niveau PostgreSQL), et l'insertion se fait dans la même
    transaction que la création de la `Sale` associée (voir
    `apps.sync.services.process_sale_completed_event`). Un event_id ne peut
    donc jamais être associé à deux ventes, et il ne peut jamais exister de
    `Sale` "orpheline" côté sync sans son `ProcessedSyncEvent` (commit ou
    rollback ensemble).

    Seuls les événements traités avec succès (statut SYNCED) sont
    enregistrés ici : un conflit ou un rejet n'a aucun effet de bord en
    base, il est donc naturellement ré-évaluable à l'identique lors d'un
    retry, sans avoir besoin d'être mémorisé.
    """

    class EventType(models.TextChoices):
        SALE_COMPLETED = "SALE_COMPLETED", "Vente terminée"

    event_id = models.UUIDField("identifiant d'événement", primary_key=True)
    terminal_id = models.UUIDField("identifiant de terminal")
    event_type = models.CharField(
        "type d'événement", max_length=32, choices=EventType.choices
    )
    entity_id = models.UUIDField("identifiant de l'entité (ex. sale_id)")
    # Magasin de la vente produite : rattache l'événement à un commerce sans
    # passer par `entity_id`, qui n'est pas une clé étrangère. Vide seulement
    # pour un événement antérieur dont la vente n'existe plus.
    store = models.ForeignKey(
        "stores.Store",
        on_delete=models.PROTECT,
        related_name="sync_events",
        verbose_name="magasin",
        blank=True,
        null=True,
    )
    pushed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="pushed_sync_events",
        verbose_name="transmis par",
        blank=True,
        null=True,
        help_text=(
            "Utilisateur connecté sur la caisse quand l'événement a été envoyé. "
            "Peut différer du caissier de la vente : sur une caisse partagée, un "
            "collègue transmet les ventes restées en attente."
        ),
    )
    stock_discrepancy = models.BooleanField(
        "divergence de stock",
        default=False,
        help_text="Vrai si cette vente a fait passer un stock sous zéro.",
    )
    unapproved_discount = models.BooleanField(
        "remise non validée",
        default=False,
        help_text=(
            "Vrai si la vente porte une remise au-delà de ce qu'un caissier "
            "accorde seul, sans validation de gérant valable."
        ),
    )
    catalog_price_discrepancy = models.BooleanField(
        "prix catalogue à vérifier",
        default=False,
        help_text=(
            "Vrai si le prix catalogue envoyé par le poste diffère du prix "
            "catalogue du serveur pour au moins un article (changement de prix "
            "pendant la coupure, ou poste altéré)."
        ),
    )
    processed_at = models.DateTimeField("traité le", auto_now_add=True)

    class Meta:
        ordering = ("-processed_at",)
        verbose_name = "événement de synchronisation traité"
        verbose_name_plural = "événements de synchronisation traités"
        indexes = [
            models.Index(fields=("entity_id",), name="sync_event_entity_id_idx"),
            models.Index(fields=("terminal_id",), name="sync_event_terminal_id_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.event_type} {self.event_id} → {self.entity_id}"
