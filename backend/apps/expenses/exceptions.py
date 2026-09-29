class InvalidExpense(Exception):
    """Raised when an expense cannot be recorded as requested."""


class ExpenseSessionNotOwned(InvalidExpense):
    """Raised when the cash session belongs to another cashier."""


class InsufficientCash(InvalidExpense):
    """Raised when a cash expense exceeds the cash expected in the drawer."""

    def __init__(self, available) -> None:
        from apps.dashboard.formatting import format_fcfa

        self.available = available
        super().__init__(
            f"Pas assez d’espèces en caisse : {format_fcfa(available)} attendus."
        )


class ExpenseAlreadyCancelled(Exception):
    """Raised when cancelling an expense that is already cancelled."""


class ExpenseNotCancellable(Exception):
    """Raised when an expense can no longer be cancelled (closed session)."""


class ExpenseCancellationNotAllowed(Exception):
    """Raised when the user may not cancel this expense."""


class ImmutableExpense(Exception):
    """Raised on any direct attempt to update or delete an expense."""
