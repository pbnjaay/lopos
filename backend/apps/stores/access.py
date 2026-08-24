from django.db.models import QuerySet

from .models import CashRegister, Store


def stores_accessible_to(user) -> QuerySet[Store]:
    queryset = Store.objects.all()
    if user.is_staff or user.is_superuser:
        return queryset
    return queryset.filter(
        is_active=True,
        user_assignments__user=user,
        user_assignments__is_active=True,
    ).distinct()


def cash_registers_accessible_to(user) -> QuerySet[CashRegister]:
    queryset = CashRegister.objects.select_related("store")
    if user.is_staff or user.is_superuser:
        return queryset
    return queryset.filter(
        is_active=True,
        store__is_active=True,
        store__user_assignments__user=user,
        store__user_assignments__is_active=True,
    ).distinct()


def user_can_access_store(user, store: Store) -> bool:
    if user.is_staff or user.is_superuser:
        return True
    return store.user_assignments.filter(user=user, is_active=True).exists()
