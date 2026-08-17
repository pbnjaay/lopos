from decimal import Decimal

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.cash.exceptions import CashSessionAlreadyOpen
from apps.cash.models import CashSession
from apps.cash.services import open_cash_session
from apps.catalog.models import Product
from apps.inventory.models import Stock
from apps.inventory.services import receive_stock
from apps.stores.models import CashRegister, Store


User = get_user_model()

DEMO_PRODUCTS = [
    {
        "name": "Coca 50cl",
        "barcode": "3017620422003",
        "selling_price": Decimal("500.00"),
        "stock": 40,
    },
    {
        "name": "Eau minérale 1.5L",
        "barcode": "6111242100017",
        "selling_price": Decimal("400.00"),
        "stock": 60,
    },
    {
        "name": "Pain",
        "barcode": None,
        "selling_price": Decimal("150.00"),
        "stock": 30,
    },
    {
        "name": "Riz brisé 1kg",
        "barcode": "6111242100062",
        "selling_price": Decimal("900.00"),
        "stock": 25,
    },
    {
        "name": "Lait en poudre 400g",
        "barcode": "6111242100369",
        "selling_price": Decimal("2200.00"),
        "stock": 15,
    },
]


class Command(BaseCommand):
    help = (
        "Peuple la base avec des données de démonstration "
        "(magasin, caisse, produits, stock, caissier)."
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

        with transaction.atomic():
            store, store_created = Store.objects.get_or_create(
                name="Supérette Louga Centre",
                defaults={"address": "Avenue Léopold Sédar Senghor, Louga"},
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
                conflicting_product = (
                    Product.objects.filter(barcode=item["barcode"])
                    .exclude(name=item["name"])
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
                    name=item["name"],
                    defaults={
                        "barcode": item["barcode"],
                        "selling_price": item["selling_price"],
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
