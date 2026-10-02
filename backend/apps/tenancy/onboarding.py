"""Accueillir un commerce pilote, en une transaction.

Un commerce reçoit d'office ce sans quoi il ne peut pas travailler : ses
catégories de dépenses par défaut, et — avec `create_pilot` — un premier
magasin, sa caisse et son propriétaire. Rien d'autre : ni produits, ni
clients, ni configuration devinée.
"""

import secrets
from dataclasses import dataclass

from django.contrib.auth import get_user_model
from django.db import transaction

from apps.expenses.services import ensure_default_categories
from apps.stores.models import CashRegister, Store

from .models import Organization, OrganizationMembership
from .roles import sync_member_access

User = get_user_model()

DEFAULT_REGISTER_NAME = "Caisse 01"


class OnboardingError(Exception):
    """Le commerce ne peut pas être créé tel que demandé (rien n'est créé)."""


@dataclass(frozen=True)
class Pilot:
    organization: Organization
    store: Store
    owner: User
    owner_password: str
    register: CashRegister | None
    expense_categories: int


def temporary_password() -> str:
    """Lisible au téléphone et sans caractère ambigu, mais long : ~70 bits."""
    alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
    groups = ("".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(3))
    return "-".join(groups) + "-" + str(secrets.randbelow(90) + 10)


def start_commerce(organization: Organization) -> int:
    """Ce dont tout commerce a besoin dès sa création ; idempotent."""
    return ensure_default_categories(organization)


@transaction.atomic
def create_pilot(
    *,
    name: str,
    slug: str,
    store_name: str,
    owner_username: str,
    owner_first_name: str = "",
    owner_last_name: str = "",
    register_name: str | None = DEFAULT_REGISTER_NAME,
) -> Pilot:
    if Organization.objects.filter(slug=slug).exists():
        raise OnboardingError(f"Un commerce utilise déjà l'identifiant « {slug} ».")
    if User.objects.filter(username=owner_username).exists():
        raise OnboardingError(f"Le nom d'utilisateur « {owner_username} » est déjà pris.")

    organization = Organization.objects.create(name=name, slug=slug)
    categories = start_commerce(organization)
    store = Store.objects.create(name=store_name, organization=organization)
    register = (
        CashRegister.objects.create(store=store, name=register_name) if register_name else None
    )

    password = temporary_password()
    owner = User.objects.create_user(
        username=owner_username,
        password=password,
        first_name=owner_first_name,
        last_name=owner_last_name,
    )
    OrganizationMembership.objects.create(
        organization=organization, user=owner, role=OrganizationMembership.Role.OWNER
    )
    sync_member_access(owner)

    return Pilot(
        organization=organization,
        store=store,
        owner=owner,
        owner_password=password,
        register=register,
        expense_categories=categories,
    )
