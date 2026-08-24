class CashRegisterInactive(Exception):
    """Raised when an operation requires an active cash register."""


class CashRegisterNotAllowed(Exception):
    """Raised when a cashier is not assigned to a register's store."""


class StoreInactive(Exception):
    """Raised when an operation requires an active store."""


class CashSessionAlreadyOpen(Exception):
    """Raised when a register already has an open session."""


class CashSessionClosed(Exception):
    """Raised when an operation requires an open cash session."""


class CashSessionAlreadyClosed(Exception):
    """Raised when trying to close a cash session that is already closed."""


class InvalidOpeningBalance(Exception):
    """Raised when a cash session opening balance is invalid."""


class InvalidCountedCash(Exception):
    """Raised when a cash session counted cash amount is invalid."""
