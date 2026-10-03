import csv
import io
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

from django.db import transaction

from apps.inventory.services import receive_stock
from apps.stores.models import Store

from .models import Product

REQUIRED_COLUMNS = {"name", "selling_price"}


@dataclass(frozen=True, slots=True)
class ProductImportRowError:
    line: int
    message: str


@dataclass(frozen=True, slots=True)
class ProductImportResult:
    created_count: int
    errors: list[ProductImportRowError]


@dataclass(frozen=True, slots=True)
class _ParsedRow:
    name: str
    barcode: str | None
    purchase_price: Decimal | None
    selling_price: Decimal
    store: Store | None
    initial_stock: int


def _parse_decimal(raw_value: str, row_errors: list[str], label: str) -> Decimal | None:
    try:
        value = Decimal(raw_value)
    except InvalidOperation:
        row_errors.append(f"Le {label} doit être un nombre.")
        return None
    if value < 0:
        row_errors.append(f"Le {label} doit être positif ou nul.")
        return None
    return value


def import_products_from_csv(csv_file) -> ProductImportResult:
    content = csv_file.read().decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(content))

    columns = {name.strip() for name in reader.fieldnames or []}
    if not REQUIRED_COLUMNS.issubset(columns):
        return ProductImportResult(
            created_count=0,
            errors=[
                ProductImportRowError(
                    line=1,
                    message=(
                        "Colonnes manquantes. Le fichier doit contenir au moins : "
                        "name, selling_price."
                    ),
                )
            ],
        )

    stores_by_name = {store.name.strip().lower(): store for store in Store.objects.all()}

    errors: list[ProductImportRowError] = []
    parsed_rows: list[_ParsedRow] = []
    seen_barcodes: set[str] = set()
    row_count = 0

    for line_number, raw_row in enumerate(reader, start=2):
        row_count += 1
        row_errors: list[str] = []

        name = (raw_row.get("name") or "").strip()
        if not name:
            row_errors.append("Le nom est requis.")

        barcode = (raw_row.get("barcode") or "").strip() or None
        if barcode:
            if barcode in seen_barcodes:
                row_errors.append(f"Code-barres {barcode} en double dans le fichier.")
            elif Product.objects.filter(barcode=barcode).exists():
                row_errors.append("Un produit avec ce code-barres existe déjà.")

        selling_price_raw = (raw_row.get("selling_price") or "").strip()
        selling_price = None
        if not selling_price_raw:
            row_errors.append("Le prix de vente est requis.")
        else:
            selling_price = _parse_decimal(selling_price_raw, row_errors, "prix de vente")

        purchase_price = None
        purchase_price_raw = (raw_row.get("purchase_price") or "").strip()
        if purchase_price_raw:
            purchase_price = _parse_decimal(purchase_price_raw, row_errors, "prix d'achat")

        initial_stock = 0
        initial_stock_raw = (raw_row.get("initial_stock") or "").strip()
        if initial_stock_raw:
            try:
                initial_stock = int(initial_stock_raw)
                if initial_stock < 0:
                    raise ValueError
            except ValueError:
                row_errors.append(
                    "La quantité initiale doit être un entier positif ou nul."
                )
                initial_stock = 0

        store_name = (raw_row.get("store") or "").strip()
        store = None
        if store_name:
            store = stores_by_name.get(store_name.lower())
            if store is None:
                row_errors.append(f"Magasin introuvable : {store_name}.")
        elif initial_stock > 0:
            row_errors.append("Le magasin est requis pour enregistrer un stock initial.")

        if row_errors:
            errors.append(
                ProductImportRowError(line=line_number, message=" ".join(row_errors))
            )
            continue

        if barcode:
            seen_barcodes.add(barcode)

        parsed_rows.append(
            _ParsedRow(
                name=name,
                barcode=barcode,
                purchase_price=purchase_price,
                selling_price=selling_price,
                store=store,
                initial_stock=initial_stock,
            )
        )

    if row_count == 0:
        errors.append(ProductImportRowError(line=1, message="Le fichier est vide."))

    if errors:
        return ProductImportResult(created_count=0, errors=errors)

    with transaction.atomic():
        for row in parsed_rows:
            product = Product.objects.create(
                name=row.name,
                barcode=row.barcode,
                purchase_price=row.purchase_price,
                selling_price=row.selling_price,
            )
            if row.initial_stock > 0:
                receive_stock(
                    store=row.store, product=product, quantity=row.initial_stock
                )

    return ProductImportResult(created_count=len(parsed_rows), errors=[])
