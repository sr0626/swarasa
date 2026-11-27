from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.core.bulk_import_rules import check_row_fields
from app.core.us_zip import _RANGES, zip_matches_state


@pytest.mark.parametrize(
    ("postal", "state"),
    [("75038", "TX"), ("75038-1234", "tx"), ("88510", "TX"), ("73301", "TX"), ("73301", "OK"),
     ("10001", "NY"), ("06390", "NY"), ("02108", "MA"), ("94105", "CA"), ("20001", "DC")],
)
def test_zips_that_belong_to_their_state(postal, state):
    assert zip_matches_state(postal, state)


@pytest.mark.parametrize(("postal", "state"), [("66666", "TX"), ("10001", "TX"), ("75038", "CA")])
def test_wrong_state_is_caught(postal, state):
    assert not zip_matches_state(postal, state)


@pytest.mark.parametrize(("postal", "state"), [("75038", "ZZ"), ("", "TX"), (None, "TX"), ("abc", "TX"), ("75038", None)])
def test_missing_or_unknown_data_is_never_blocked(postal, state):
    assert zip_matches_state(postal, state)


def test_bulk_import_reports_a_wrong_state_zip():
    row = {
        "name": "Spice Route",
        "address_line1": "1 Main St",
        "city": "Irving",
        "state": "TX",
        "postal_code": "66666",
        "phone": "(214) 555-0142",
    }
    codes = [i.code for i in check_row_fields(row).issues]
    assert "zip_state_mismatch" in codes
    ok = [i.code for i in check_row_fields({**row, "postal_code": "75038"}).issues]
    assert "zip_state_mismatch" not in ok


def test_frontend_copy_of_the_table_is_identical():
    source = (
        Path(__file__).resolve().parents[2] / "frontend/src/lib/geocode/usZip.ts"
    ).read_text()
    table = source[source.index("ZIP_PREFIX_RANGES") : source.index("const PREFIX")]
    frontend = {
        state: tuple((int(a), int(b)) for a, b in re.findall(r"\[(\d+), (\d+)\]", ranges))
        for state, ranges in re.findall(r"^  ([A-Z]{2}): \[(.*)\],$", table, re.M)
    }
    assert frontend == _RANGES
