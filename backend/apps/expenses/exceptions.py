class InvalidExpense(Exception):
    """Raised when an expense cannot be recorded as requested."""


class ExpenseSessionNotOwned(InvalidExpense):
    """Raised when the cash session belongs to another cashier."""


class ExpenseAlreadyCancelled(Exception):
    """Raised when cancelling an expense that is already cancelled."""


class ExpenseNotCancellable(Exception):
    """Raised when an expense can no longer be cancelled (closed session)."""


class ExpenseCancellationNotAllowed(Exception):
    """Raised when the user may not cancel this expense."""


class ImmutableExpense(Exception):
    """Raised on any direct attempt to update or delete an expense."""
