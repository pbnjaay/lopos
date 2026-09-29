import pytest

from apps.customers.exceptions import InvalidPhone
from apps.customers.phone import normalize_phone


@pytest.mark.parametrize(
    "raw",
    [
        "77 123 45 67",
        "771234567",
        "+221771234567",
        "+221 77 123 45 67",
        "00221771234567",
        "221771234567",
        "77.123.45.67",
        "77-123-45-67",
        "  771234567  ",
    ],
)
def test_senegal_mobile_formats_normalize_to_e164(raw: str) -> None:
    assert normalize_phone(raw) == "+221771234567"


def test_senegal_landline_is_accepted() -> None:
    assert normalize_phone("33 821 00 00") == "+221338210000"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("+33 6 12 34 56 78", "+33612345678"),
        ("0033612345678", "+33612345678"),
    ],
)
def test_explicit_foreign_numbers_are_kept(raw: str, expected: str) -> None:
    assert normalize_phone(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "77123456",  # 8 chiffres
        "7712345678",  # 10 chiffres
        "671234567",  # préfixe national inconnu
        "Moussa Fall",
        "77 123 45 6a",
        "+221 67 123 45 67",
        "+12",
    ],
)
def test_invalid_numbers_are_rejected(raw: str) -> None:
    with pytest.raises(InvalidPhone):
        normalize_phone(raw)
