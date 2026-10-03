from rest_framework import serializers

from .models import CashRegister, Store


class StoreSerializer(serializers.ModelSerializer):
    class Meta:
        model = Store
        fields = ("id", "name", "address", "is_active", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")


class CashRegisterSerializer(serializers.ModelSerializer):
    store_id = serializers.PrimaryKeyRelatedField(
        source="store",
        queryset=Store.objects.all(),
    )

    class Meta:
        model = CashRegister
        fields = ("id", "store_id", "name", "is_active", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")

    def validate(self, attrs):
        store = attrs.get("store", getattr(self.instance, "store", None))
        name = attrs.get("name", getattr(self.instance, "name", None))
        if store and name:
            queryset = CashRegister.objects.filter(store=store, name=name)
            if self.instance:
                queryset = queryset.exclude(pk=self.instance.pk)
            if queryset.exists():
                raise serializers.ValidationError(
                    {"name": "Une caisse portant ce nom existe déjà dans ce magasin."}
                )
        return attrs
