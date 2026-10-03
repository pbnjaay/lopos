from django.core.exceptions import ImproperlyConfigured
from rest_framework import serializers

from .context import get_tenant
from .scoping import scope


class TenantPrimaryKeyRelatedField(serializers.PrimaryKeyRelatedField):
    """Clé étrangère d'un payload, cherchée seulement parmi ce que le compte
    peut voir : l'identifiant d'un autre commerce reçoit exactement la même
    erreur qu'un identifiant inexistant.

    Le serializer doit recevoir la requête dans son contexte."""

    def get_queryset(self):
        request = self.context.get("request")
        if request is None:
            raise ImproperlyConfigured(
                f"{type(self.parent).__name__} doit recevoir context={{'request': ...}}."
            )
        return scope(super().get_queryset(), get_tenant(request))
