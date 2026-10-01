from decimal import Decimal

from rest_framework import serializers

from apps.cash.models import CashSession
from apps.sales.models import Payment
from apps.stores.access import user_can_manage_store

from .models import Expense, ExpenseCategory


class ExpenseCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ExpenseCategory
        fields = ("id", "name", "requires_description")


class CreateExpenseSerializer(serializers.Serializer):
    idempotency_key = serializers.UUIDField()
    cash_session_id = serializers.PrimaryKeyRelatedField(
        source="cash_session", queryset=CashSession.objects.all()
    )
    category_id = serializers.PrimaryKeyRelatedField(
        source="category", queryset=ExpenseCategory.objects.all()
    )
    payment_method = serializers.ChoiceField(choices=Payment.Method.choices)
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.01"))
    description = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=1000, trim_whitespace=True
    )
    document_reference = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=64, trim_whitespace=True
    )


class CancelExpenseSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=500, trim_whitespace=True)


class ExpenseListQuerySerializer(serializers.Serializer):
    cash_session_id = serializers.UUIDField(required=False)
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)
    category_id = serializers.UUIDField(required=False)
    payment_method = serializers.ChoiceField(choices=Payment.Method.choices, required=False)
    status = serializers.ChoiceField(choices=Expense.Status.choices, required=False)


class ExpenseSerializer(serializers.ModelSerializer):
    category = ExpenseCategorySerializer(read_only=True)
    store = serializers.SerializerMethodField()
    cash_register = serializers.SerializerMethodField()
    cash_session_id = serializers.UUIDField(read_only=True, allow_null=True)
    created_by = serializers.CharField(source="created_by.username", read_only=True)
    cancelled_by = serializers.CharField(
        source="cancelled_by.username", read_only=True, allow_null=True, default=None
    )
    can_cancel = serializers.SerializerMethodField()

    class Meta:
        model = Expense
        fields = (
            "id",
            "reference",
            "category",
            "amount",
            "payment_method",
            "description",
            "document_reference",
            "status",
            "store",
            "cash_register",
            "cash_session_id",
            "occurred_at",
            "created_by",
            "cancelled_at",
            "cancelled_by",
            "cancellation_reason",
            "can_cancel",
        )

    def get_store(self, expense: Expense) -> dict:
        return {"id": expense.store_id, "name": expense.store.name}

    def get_cash_register(self, expense: Expense) -> dict | None:
        if expense.cash_session is None:
            return None
        register = expense.cash_session.cash_register
        return {"id": register.id, "name": register.name}

    def get_can_cancel(self, expense: Expense) -> bool:
        """Même règle que `cancel_expense`, pour n'afficher l'action que si
        elle peut réussir."""
        request = self.context.get("request")
        if request is None or expense.status != Expense.Status.POSTED:
            return False
        if expense.created_by_id != request.user.pk and not user_can_manage_store(
            request.user, expense.store_id
        ):
            return False
        return expense.cash_session is None or expense.cash_session.status == CashSession.Status.OPEN
