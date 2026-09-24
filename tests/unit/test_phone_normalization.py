"""Unit test: the ONE shared US phone rule — app.core.phone.normalize_us_phone
(also re-exported as app.schemas.location.normalize_phone). Pure, no DB, no HTTP.

The frontend twin (frontend/src/lib/phone.ts `normalizePhone`) is tested
against this SAME case table in frontend/src/lib/phone.test.ts — keep the two
tables identical so both layers stay provably in sync.
"""
from __future__ import annotations

import pytest

from app.core.phone import US_PHONE_ERROR, normalize_us_phone
from app.schemas.location import normalize_phone

VALID = [
    ("(972) 555-0142", "+19725550142"),
    ("972-555-0142", "+19725550142"),
    ("972.555.0142", "+19725550142"),
    ("972 555 0142", "+19725550142"),
    ("9725550142", "+19725550142"),
    ("1 972 555 0142", "+19725550142"),
    ("1-972-555-0142", "+19725550142"),
    ("19725550142", "+19725550142"),
    ("1 (972) 555-0142", "+19725550142"),
    ("+19725550142", "+19725550142"),
    ("+1 (972) 555-0142", "+19725550142"),
    ("+1 972-555-0142", "+19725550142"),
    ("  (972) 555-0142  ", "+19725550142"),
]

INVALID = [
    "",
    "   ",
    "12345",
    "not a phone",
    "555-0142",  # missing area code
    "0725550142",  # area code can't start with 0
    "1725550142",  # area code can't start with 1
    "9720550142",  # exchange can't start with 0
    "9721550142",  # exchange can't start with 1
    "97255501420",  # 11 digits not starting with the 1 country code (the reported bug)
    "29725550142",  # 11 digits, country code 2
    "972555014",  # 9 digits
    "+1555555",  # too short after +1
    "+1 972 555 01421",  # too long after +1
    "+29725550142",  # "+" only means the +1 country code
    "+44 20 7946 0958",  # non-US country code
    "+442079460958",
    "972-555-0142 ext 5",  # extensions aren't part of the stored number
    "972-555-0142x5",
    "(972) 555-01ab",
    "972+5550142",  # "+" anywhere but the front
    "++19725550142",
    "١٩٧٢٥٥٥٠١٤٢",  # non-ASCII digits
]


@pytest.mark.parametrize("raw,expected", VALID)
def test_valid_numbers_normalise_to_e164(raw, expected):
    assert normalize_us_phone(raw) == expected


@pytest.mark.parametrize("raw", INVALID)
def test_invalid_numbers_return_none(raw):
    assert normalize_us_phone(raw) is None


def test_schema_module_reexports_the_same_rule():
    assert normalize_phone is normalize_us_phone


def test_error_message_is_the_shared_inline_copy():
    assert US_PHONE_ERROR == "Enter a valid 10-digit US phone number"
