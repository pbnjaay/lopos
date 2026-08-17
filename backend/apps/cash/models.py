import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.stores.models import CashRegister


class CashSession(models.Model):
    class Status(models.TextChoices):
        OPEN = "OPEN", "Ouverte"
        CLOSED = "CLOSED", "Fermée"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    cash_register = models.ForeignKey(
        CashRegister,
        on_delete=models.PROTECT,
        related_name="cash_sessions",
    )
    cashier = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="cash_sessions",
    )
    opening_balance = models.DecimalField(max_digits=14, decimal_places=2)
    status = models.CharField(
        max_length=8,
        choices=Status.choices,
        default=Status.OPEN,
    )
    opened_at = models.DateTimeField(auto_now_add=True)
    closing_balance = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        blank=True,
        null=True,
    )
    expected_balance = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        blank=True,
        null=True,
    )
    difference = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        blank=True,
        null=True,
    )
    closed_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        ordering = ("-opened_at",)
        constraints = [
            models.UniqueConstraint(
                fields=("cash_register",),
                condition=Q(status="OPEN"),
                name="cash_unique_open_session_per_register",
            ),
            models.CheckConstraint(
                condition=Q(status__in=("OPEN", "CLOSED")),
                name="cash_session_status_valid",
            ),
            models.CheckConstraint(
                condition=Q(opening_balance__gte=Decimal("0")),
                name="cash_session_opening_balance_nonnegative",
            ),
            models.CheckConstraint(
                condition=Q(closing_balance__isnull=True)
                | Q(closing_balance__gte=Decimal("0")),
                name="cash_session_closing_balance_nonnegative",
            ),
            models.CheckConstraint(
                condition=Q(expected_balance__isnull=True)
                | Q(expected_balance__gte=Decimal("0")),
                name="cash_session_expected_balance_nonnegative",
            ),
        ]

    def __str__(self) -> str:
        opened_at = (
            self.opened_at.strftime("%Y-%m-%d %H:%M")
            if self.opened_at
            else "non ouverte"
        )
        return f"{self.cash_register} — {opened_at}"
