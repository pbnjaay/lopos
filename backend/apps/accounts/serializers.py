from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework import serializers


User = get_user_model()


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(trim_whitespace=False, write_only=True)


class CurrentUserSerializer(serializers.ModelSerializer):
    """Le compte connecté et son commerce. `organization`, `role`,
    `store_ids` et `can_view_costs` viennent du contexte tenant calculé
    côté serveur, jamais d'une valeur envoyée par le client."""

    organization = serializers.SerializerMethodField()
    role = serializers.SerializerMethodField()
    store_ids = serializers.SerializerMethodField()
    can_view_costs = serializers.SerializerMethodField()
    approval_policy = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "is_staff",
            "organization",
            "role",
            "store_ids",
            "can_view_costs",
            "approval_policy",
        )
        read_only_fields = fields

    def get_organization(self, user) -> dict:
        organization = self.context["tenant"].organization
        return {"id": str(organization.pk), "name": organization.name}

    def get_role(self, user) -> str:
        return self.context["tenant"].role

    def get_store_ids(self, user) -> list[str]:
        return sorted(str(store_id) for store_id in self.context["tenant"].store_ids)

    def get_can_view_costs(self, user) -> bool:
        return self.context["tenant"].can_view_costs

    def get_approval_policy(self, user) -> dict:
        """Ce que le poste doit faire valider par un gérant (le serveur
        refait toujours le contrôle). Un gérant ou un propriétaire n'en a
        jamais besoin pour lui-même : `required` est faux."""
        return {
            "required": self.context["tenant"].role == "CASHIER",
            "amount_threshold": f"{settings.APPROVAL_AMOUNT_THRESHOLD:.2f}",
            "max_discount_rate": f"{settings.APPROVAL_MAX_DISCOUNT_RATE}",
            "return_window_days": settings.APPROVAL_RETURN_WINDOW_DAYS,
        }
