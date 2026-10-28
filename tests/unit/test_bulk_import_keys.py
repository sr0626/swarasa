"""Duplicate keys + DuplicateIndex (app/services/bulk_import_keys.py) and the
shared row rules (app/core/bulk_import_rules.py). Pure logic."""
from __future__ import annotations

import pytest

from app.core.bulk_import_rules import check_row_fields
from app.services import bulk_import_keys as k


def test_name_key_ignores_case_punctuation_whitespace_and_accents():
    assert k.name_key("Dera Grill!") == k.name_key("  dera   GRILL ")
    assert k.name_key("Café Madras") == k.name_key("cafe-madras")
    assert k.name_key("!!!") == ""


def test_address_key_normalizes_street_words_units_and_zip():
    a = k.address_key("100 North Main Street, Ste 5", "75038-1234")
    b = k.address_key("100 N. Main St", "75038")
    c = k.address_key("100 N Main St #12", "75038")
    assert a == b == c
    assert k.address_key("100 N Main St", "75039") != a
    assert k.address_key("101 N Main St", "75038") != a


def _index() -> k.DuplicateIndex:
    idx = k.DuplicateIndex()
    idx.add(
        k.DupEntry(
            name_key=k.name_key("Dera Grill"),
            addr_key=k.address_key("100 Main St", "75038"),
            phone="+12145550142",
            label="row 2",
            row_number=2,
        )
    )
    return idx


def test_same_name_and_address_is_definite():
    m = _index().check(k.name_key("DERA GRILL"), k.address_key("100 Main Street", "75038"), None)
    assert m and m.level == k.DEFINITE and m.entry.row_number == 2


def test_same_name_and_phone_is_definite_even_if_address_differs():
    m = _index().check(k.name_key("Dera Grill"), k.address_key("999 Other Rd", "75024"), "+12145550142")
    assert m and m.level == k.DEFINITE


def test_phone_only_is_possible():
    m = _index().check(k.name_key("Totally Different"), k.address_key("999 Other Rd", "75024"), "+12145550142")
    assert m and m.level == k.POSSIBLE and "phone" in m.reason


def test_same_address_different_name_is_possible():
    m = _index().check(k.name_key("New Name"), k.address_key("100 Main St", "75038"), None)
    assert m and m.level == k.POSSIBLE and "address" in m.reason


def test_definite_beats_an_earlier_possible_match():
    idx = k.DuplicateIndex()
    idx.add(k.DupEntry(k.name_key("Other"), k.address_key("1 A St", "75001"), "+12145550199", "row 2", 2))
    idx.add(k.DupEntry(k.name_key("Real"), k.address_key("1 A St", "75001"), None, "row 3", 3))
    m = idx.check(k.name_key("Real"), k.address_key("1 A St", "75001"), None)
    assert m and m.level == k.DEFINITE and m.entry.row_number == 3


def test_no_match_and_no_phone_never_matches_none_phone():
    idx = k.DuplicateIndex()
    idx.add(k.DupEntry(k.name_key("A"), k.address_key("1 A St", "75001"), None, "row 2", 2))
    assert idx.check(k.name_key("B"), k.address_key("2 B St", "75002"), None) is None


GOOD = {
    "name": "Spice Hut", "address_line1": "1 Main St", "city": "Plano",
    "state": "tx", "postal_code": "75024", "phone": "(214) 555-0142",
}


def test_rules_accept_good_row_and_normalize():
    check = check_row_fields(GOOD)
    assert not check.has_errors
    assert check.values["state"] == "TX"
    assert check.values["phone"] == "+12145550142"


@pytest.mark.parametrize(
    "override, code",
    [
        ({"name": ""}, "missing"),
        ({"address_line1": None}, "missing"),
        ({"state": "Texas"}, "bad_state"),
        ({"postal_code": "7502"}, "bad_zip"),
        ({"phone": "123-456-7890"}, "bad_phone"),
        ({"website": "javascript:alert(1)"}, "bad_website"),
        ({"name": "x" * 256}, "too_long"),
        ({"description": "x\x00y"}, "bad_characters"),
        ({"country": "CA"}, "bad_country"),
        ({"latitude": "32.8"}, "half_coordinates"),
        ({"latitude": "abc", "longitude": "-96.8"}, "bad_latitude"),
        ({"latitude": "51.5", "longitude": "-0.12"}, "outside_us"),
    ],
)
def test_rules_reject_bad_cells(override, code):
    check = check_row_fields({**GOOD, **override})
    assert code in {i.code for i in check.issues if i.severity == "error"}


def test_rules_never_treat_cell_content_as_anything_but_text():
    check = check_row_fields({**GOOD, "name": "=HYPERLINK(\"http://evil\")"})
    assert not check.has_errors  # allowed as data; the browser neutralises it on download
    assert check.values["name"].startswith("=")
