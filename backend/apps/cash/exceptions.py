class CashRegisterInactive(Exception):
    """Raised when an operation requires an active cash register."""


class CashSessionAlreadyOpen(Exception):
    """Raised when a register already has an open session."""


class CashSessionClosed(Exception):
    """Raised when an operation requires an open cash session."""


class InvalidOpeningBalance(Exception):
    """Raised when a cash session opening balance is invalid."""
