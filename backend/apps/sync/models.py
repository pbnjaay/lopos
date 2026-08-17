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
    stock_discrepancy = models.BooleanField(
        "divergence de stock",
        default=False,
        help_text="Vrai si cette vente a fait passer un stock sous zéro.",
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
