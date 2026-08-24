import uuid

from django.conf import settings
from django.db import models


class Store(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField("nom", max_length=255)
    address = models.TextField("adresse", blank=True, null=True)
    is_active = models.BooleanField("actif", default=True)
    created_at = models.DateTimeField("créé le", auto_now_add=True)
    updated_at = models.DateTimeField("modifié le", auto_now=True)

    class Meta:
        ordering = ("name",)
        verbose_name = "magasin"
        verbose_name_plural = "magasins"

    def __str__(self) -> str:
        return self.name


class CashRegister(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    store = models.ForeignKey(
        Store,
        on_delete=models.PROTECT,
        related_name="cash_registers",
        verbose_name="magasin",
    )
    name = models.CharField("nom", max_length=255)
    is_active = models.BooleanField("active", default=True)
    created_at = models.DateTimeField("créée le", auto_now_add=True)
    updated_at = models.DateTimeField("modifiée le", auto_now=True)

    class Meta:
        ordering = ("store__name", "name")
        verbose_name = "caisse"
        verbose_name_plural = "caisses"
        constraints = [
            models.UniqueConstraint(
                fields=("store", "name"),
                name="stores_unique_register_name_per_store",
            )
        ]

    def __str__(self) -> str:
        return f"{self.store} — {self.name}"


class StoreAssignment(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="store_assignments",
        verbose_name="utilisateur",
    )
    store = models.ForeignKey(
        Store,
        on_delete=models.CASCADE,
        related_name="user_assignments",
        verbose_name="magasin",
    )
    is_active = models.BooleanField("active", default=True)
    created_at = models.DateTimeField("créée le", auto_now_add=True)
    updated_at = models.DateTimeField("modifiée le", auto_now=True)

    class Meta:
        ordering = ("store__name", "user__username")
        verbose_name = "affectation à un magasin"
        verbose_name_plural = "affectations aux magasins"
        constraints = [
            models.UniqueConstraint(
                fields=("user", "store"),
                name="stores_unique_user_assignment_per_store",
            )
        ]

    def __str__(self) -> str:
        return f"{self.user} — {self.store}"
