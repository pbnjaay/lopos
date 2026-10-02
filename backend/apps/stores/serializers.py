from rest_framework import serializers

from .models import CashRegister, Store


class StoreSerializer(serializers.ModelSerializer):
    class Meta:
        model = Store
        fields = ("id", "name", "address", "is_active", "created_at", "updated_at")
        read_only_fields = fields


class CashRegisterSerializer(serializers.ModelSerializer):
    # Lecture seule : une caisse se crée dans l'administration, jamais par
    # l'API (le magasin d'une caisse ne se choisit pas depuis un poste).
    store_id = serializers.PrimaryKeyRelatedField(source="store", read_only=True)

    class Meta:
        model = CashRegister
        fields = ("id", "store_id", "name", "is_active", "created_at", "updated_at")
        read_only_fields = fields
