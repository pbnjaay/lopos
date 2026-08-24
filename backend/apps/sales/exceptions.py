from uuid import UUID


class InvalidSaleItems(Exception):
    """Raised when a sale has no items or contains an invalid quantity."""


class ProductNotFound(Exception):
    def __init__(self, product_id: UUID) -> None:
        self.product_id = product_id
        super().__init__(f"Le produit {product_id} n'existe pas.")


class ProductInactive(Exception):
    def __init__(self, product_name: str) -> None:
        self.product_name = product_name
        super().__init__(f"Le produit {product_name} est inactif.")


class InsufficientStock(Exception):
    def __init__(
        self,
        *,
        product_name: str,
        requested: int,
        available: int,
    ) -> None:
        self.product_name = product_name
        self.requested = requested
        self.available = available
        super().__init__(f"Stock insuffisant pour {product_name}.")


class InvalidPayment(Exception):
    """Raised when payment details cannot settle a sale."""


class InvalidReturn(Exception):
    """Raised when a merchandise return violates a business invariant."""
