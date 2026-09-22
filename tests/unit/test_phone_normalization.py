"""Unit test: app.schemas.location.normalize_phone — pure, no DB, no HTTP.

This is a line-for-line port of frontend/src/lib/phone.ts normalizePhone
(see that file's module docstring and
backend/app/schemas/location.py's own note) — the cases below mirror what
that function is expected to accept/reject so both layers stay provably in
sync.
"""
from __future__ import annotations

import pytest

from app.schemas.location import normalize_phone


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("(972) 555-0142", "+19725550142"),
        ("972-555-0142", "+19725550142"),
        ("972.555.0142", "+19725550142"),
        ("9725550142", "+19725550142"),
        ("19725550142", "+19725550142"),
        ("+19725550142", "+19725550142"),
        ("+44 20 7946 0958", "+442079460958"),
        ("  (972) 555-0142  ", "+19725550142"),
    ],
)
def test_valid_numbers_normalise_to_e164(raw, expected):
    assert normalize_phone(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "12345",
        "not a phone",
        "555-0142",  # missing area code
        "0725550142",  # NANP area code can't start with 0/1
        "1725550142",
        "+1555555",  # not 11 digits after country code
        "+0123456789",  # intl number can't start with 0
    ],
)
def test_invalid_numbers_return_none(raw):
    assert normalize_phone(raw) is None
