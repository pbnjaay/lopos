import os
from decimal import Decimal

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.cash.exceptions import CashSessionAlreadyOpen
from apps.cash.models import CashSession
from apps.cash.services import open_cash_session
from apps.catalog.models import Product, format_product_name
from apps.inventory.models import Stock
from apps.inventory.services import receive_stock
from apps.stores.models import CashRegister, Store, StoreAssignment
from apps.tenancy.models import Organization, OrganizationMembership
from apps.tenancy.roles import sync_member_access


User = get_user_model()

DEMO_PRODUCTS = [
    {
        "name": "Coca 50cl",
        "barcode": "3017620422003",
        "selling_price": Decimal("500.00"),
        "purchase_price": Decimal("350.00"),
        "stock": 40,
    },
    {
        "name": "Eau minérale 1.5L",
        "barcode": "6111242100017",
        "selling_price": Decimal("400.00"),
        "purchase_price": Decimal("280.00"),
        "stock": 60,
    },
    {
        "name": "Pain",
        "barcode": None,
        "selling_price": Decimal("150.00"),
        "purchase_price": Decimal("120.00"),
        "stock": 30,
    },
    {
        "name": "Riz brisé 1kg",
        "barcode": "6111242100062",
        "selling_price": Decimal("900.00"),
        "purchase_price": Decimal("750.00"),
        "stock": 25,
    },
    {
        "name": "Lait en poudre 400g",
        "barcode": "6111242100369",
        "selling_price": Decimal("2200.00"),
        "purchase_price": Decimal("1800.00"),
        "stock": 15,
    },
]


class Command(BaseCommand):
    help = (
        "Peuple la base avec des données de démonstration "
        "(commerce, magasin, caisse, produits, stock, propriétaire, caissier)."
    )

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--open-session",
            action="store_true",
            help="Ouvre également une session de caisse pour le caissier de démonstration.",
        )

    def handle(self, *args, **options) -> None:
        if not settings.DEBUG:
            raise CommandError("seed_demo est réservé aux environnements DEBUG.")
        # Deuxième verrou, indépendant de DEBUG : une base hébergée (fournie
        # par DATABASE_URL, comme sur Railway) ne reçoit jamais les comptes
        # de démo et leurs mots de passe connus.
        if os.getenv("DATABASE_URL"):
            raise CommandError(
                "seed_demo refuse une base fournie par DATABASE_URL (base hébergée)."
            )

        with transaction.atomic():
            # Le commerce déjà présent (pilote migré, démo précédente) plutôt
            # qu'un second : la démo doit rester à un seul commerce.
            organization = Organization.objects.sole()
            organization_created = False
            if organization is None:
                organization, organization_created = Organization.objects.get_or_create(
                    slug="demo", defaults={"name": "Commerce démo"}
                )
            self._report("Commerce", organization.name, organization_created)

            store, store_created = Store.objects.get_or_create(
                name="Supérette Louga Centre",
                defaults={
                    "address": "Avenue Léopold Sédar Senghor, Louga",
                    "organization": organization,
                },
            )
            self._report("Magasin", store.name, store_created)

            register, register_created = CashRegister.objects.get_or_create(
                store=store,
                name="Caisse 01",
            )
            self._report("Caisse", register.name, register_created)

            cashier, cashier_created = User.objects.get_or_create(
                username="caissier",
                defaults={"first_name": "Caissier", "last_name": "Démo"},
            )
            if cashier_created:
                cashier.set_password("password123")
                cashier.save(update_fields=["password"])
            self._report_user(
                "Caissier",
                cashier.username,
                cashier_created,
                initial_password="password123",
            )
            assignment, assignment_created = StoreAssignment.objects.get_or_create(
                user=cashier,
                store=store,
                defaults={"is_active": True},
            )
            if not assignment.is_active:
                assignment.is_active = True
                assignment.save(update_fields=("is_active", "updated_at"))
            self._report("Affectation", f"{cashier.username} → {store.name}", assignment_created)
            self._ensure_member(organization, cashier, OrganizationMembership.Role.CASHIER)

            # Le super-utilisateur administre la plateforme mais ne vend pas :
            # la caisse se teste avec ce compte propriétaire.
            owner, owner_created = User.objects.get_or_create(
                username="proprietaire",
                defaults={"first_name": "Propriétaire", "last_name": "Démo", "is_staff": True},
            )
            if owner_created:
                owner.set_password("password123")
                owner.save(update_fields=["password"])
            self._report_user(
                "Propriétaire",
                owner.username,
                owner_created,
                initial_password="password123",
            )
            self._ensure_member(organization, owner, OrganizationMembership.Role.OWNER)

            admin, admin_created = User.objects.get_or_create(
                username="admin",
                defaults={"is_staff": True, "is_superuser": True},
            )
            if admin_created:
                admin.set_password("admin123")
                admin.save(update_fields=["password"])
            self._report_user(
                "Administrateur",
                admin.username,
                admin_created,
                initial_password="admin123",
            )

            for item in DEMO_PRODUCTS:
                # Product.save() normalise le nom (casse) : comparer contre le
                # même nom normalisé, sinon chaque relance re-détecte un faux
                # conflit / recrée le produit au lieu de le retrouver.
                expected_name = format_product_name(item["name"])
                conflicting_product = (
                    Product.objects.filter(barcode=item["barcode"])
                    .exclude(name=expected_name)
                    .first()
                    if item["barcode"] is not None
                    else None
                )
                if conflicting_product is not None:
                    raise CommandError(
                        f"Le code-barres {item['barcode']} est déjà utilisé par "
                        f"{conflicting_product.name}."
                    )

                product, product_created = Product.objects.get_or_create(
                    name=expected_name,
                    defaults={
                        "organization": organization,
                        "barcode": item["barcode"],
                        "selling_price": item["selling_price"],
                        # Dernier prix d'achat : le stock de démo entre à ce
                        # coût, pour que valorisation et marges aient des chiffres.
                        "purchase_price": item["purchase_price"],
                    },
                )
                self._report("Produit", product.name, product_created)

                stock = Stock.objects.filter(store=store, product=product).first()
                current_quantity = stock.quantity if stock is not None else 0
                quantity_to_add = max(item["stock"] - current_quantity, 0)
                if quantity_to_add:
                    result = receive_stock(
                        store=store,
                        product=product,
                        quantity=quantity_to_add,
                    )
                    self.stdout.write(
                        f"    stock initial: {result.stock.quantity}"
                    )
                else:
                    self.stdout.write(f"    stock existant: {current_quantity}")

            if options["open_session"]:
                try:
                    session = open_cash_session(
                        cash_register=register,
                        cashier=cashier,
                        opening_balance=Decimal("15000.00"),
                    )
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"  + Session de caisse ouverte ({session.id}) avec un fond de 15000.00"
                        )
                    )
                except CashSessionAlreadyOpen:
                    self.stdout.write("  = Une session est déjà ouverte sur cette caisse.")

        self.stdout.write(self.style.SUCCESS("\nSeed terminé."))

    def _ensure_member(self, organization, user, role: str) -> None:
        membership, created = OrganizationMembership.objects.get_or_create(
            user=user,
            organization=organization,
            defaults={"role": role},
        )
        self._report("Membre", f"{user.username} ({membership.get_role_display()})", created)
        sync_member_access(user)

    def _report(self, label: str, name: str, created: bool) -> None:
        marker = "+" if created else "="
        self.stdout.write(f"  {marker} {label}: {name}")

    def _report_user(
        self,
        label: str,
        username: str,
        created: bool,
        *,
        initial_password: str,
    ) -> None:
        if created:
            detail = f"{username} (mot de passe initial: {initial_password})"
        else:
            detail = f"{username} (existant, mot de passe inchangé)"
        self._report(label, detail, created)
