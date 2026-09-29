class InvalidPhone(Exception):
    """Raised when a phone number cannot be normalized."""


class InvalidCustomer(Exception):
    """Raised when customer details are invalid."""


class DuplicateCustomer(Exception):
    """Raised when a customer with the same phone already exists in the store."""

    def __init__(self, existing) -> None:
        self.existing = existing
        super().__init__(
            f"Un client existe déjà avec ce numéro dans ce magasin : {existing.name}."
        )


class InvalidLedgerEntry(Exception):
    """Raised when a ledger entry violates a business invariant."""


class NegativeCustomerBalance(InvalidLedgerEntry):
    """Raised when an entry would leave the customer owing less than zero."""


class ImmutableLedgerEntry(Exception):
    """Raised on any attempt to update or delete a ledger entry."""


class InvalidCustomerPayment(Exception):
    """Raised when a customer repayment cannot be recorded as requested."""


class CustomerOverpayment(InvalidCustomerPayment):
    """Raised when a repayment exceeds what the customer owes."""

    def __init__(self, balance) -> None:
        from apps.dashboard.formatting import format_fcfa

        self.balance = balance
        super().__init__(
            f"Le montant dépasse le solde dû par le client ({format_fcfa(balance)})."
        )
