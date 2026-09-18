"""Unit tests for `app.services.restaurant_bulk_import_service.parse_csv_rows`
-- pure stdlib `csv` parsing, no DB involved (tests/CLAUDE.md: unit tests
are "pure logic, no DB, no HTTP"). DB-touching CSV-path behavior (owner
resolution, cuisine matching, brand/location creation) is covered in
`tests/integration/test_restaurant_bulk_import.py` instead.
"""
from __future__ import annotations

import pytest

from app.schemas.restaurant_bulk_import import RestaurantCsvRowIn
from app.services.restaurant_bulk_import_service import BulkImportError, parse_csv_rows

_HEADER = "name,address_line1,address_line2,city,state,postal_code,country,phone,website,type,owner_email,latitude,longitude"


def test_parse_csv_rows_happy_path():
    csv_content = (
        f"{_HEADER}\n"
        'Namaste Grill,2234 W Walnut Hill Ln,,Irving,TX,75038,US,+12145550100,'
        "https://namastegrill.example,south indian,owner@example.com,32.865192,-96.976317\n"
    )
    rows = parse_csv_rows(csv_content)
    assert len(rows) == 1
    row = rows[0]
    assert row["name"] == "Namaste Grill"
    assert row["address_line1"] == "2234 W Walnut Hill Ln"
    assert "address_line2" not in row  # blank cell -> key omitted, not ""/None
    assert row["website"] == "https://namastegrill.example"
    assert row["type"] == "south indian"
    assert row["owner_email"] == "owner@example.com"
    assert row["latitude"] == pytest.approx(32.865192)
    assert row["longitude"] == pytest.approx(-96.976317)


def test_parse_csv_rows_blank_optional_cells_are_omitted_not_empty_string():
    """A blank cell's key is omitted entirely, not set to `None` --
    required so pydantic applies a field's own default (e.g. `country`
    defaulting to "US") instead of rejecting an explicit `None` against a
    non-Optional field type. See `parse_csv_rows`'s own comment on this.
    """
    csv_content = (
        f"{_HEADER}\n"
        "Bare Bones Cafe,100 Main St,,Plano,TX,75024,,,,,"
        "owner@example.com,,\n"
    )
    rows = parse_csv_rows(csv_content)
    assert len(rows) == 1
    row = rows[0]
    assert "phone" not in row
    assert "website" not in row
    assert "type" not in row
    assert "latitude" not in row
    assert "longitude" not in row
    assert "country" not in row  # lets RestaurantCsvRowIn's "US" default apply


def test_parse_csv_rows_multiple_data_rows():
    csv_content = (
        f"{_HEADER}\n"
        "Restaurant One,100 Main St,,Plano,TX,75024,US,,,,owner1@example.com,,\n"
        "Restaurant Two,200 Main St,,Plano,TX,75024,US,,,,owner2@example.com,,\n"
    )
    rows = parse_csv_rows(csv_content)
    assert len(rows) == 2
    assert [r["name"] for r in rows] == ["Restaurant One", "Restaurant Two"]


def test_parse_csv_rows_missing_required_column_raises_bulk_import_error():
    # No 'owner_email' column at all -- a structural problem, not a
    # per-row one, so this must raise rather than silently import rows
    # with no owner.
    csv_content = "name,address_line1,city,state,postal_code\nFoo,100 Main St,Plano,TX,75024\n"
    with pytest.raises(BulkImportError, match="owner_email"):
        parse_csv_rows(csv_content)


def test_parse_csv_rows_no_header_raises_bulk_import_error():
    with pytest.raises(BulkImportError):
        parse_csv_rows("")


def test_parse_csv_rows_header_only_no_data_rows_raises_bulk_import_error():
    with pytest.raises(BulkImportError, match="no data rows"):
        parse_csv_rows(f"{_HEADER}\n")


def test_parse_csv_rows_output_validates_with_blank_country_defaulting_to_us():
    """Regression test for a real bug caught during manual end-to-end
    testing: a blank `country` cell used to come through as an explicit
    `None`, which crashed `RestaurantCsvRowIn.model_validate` ("Input
    should be a valid string") instead of falling back to the field's
    "US" default. `parse_csv_rows` now omits blank-cell keys entirely so
    pydantic's own default applies -- this test exercises the real
    parse -> validate round trip, not just `parse_csv_rows` in isolation.
    """
    csv_content = (
        f"{_HEADER}\n"
        "Bare Bones Cafe,100 Main St,,Plano,TX,75024,,,,,"
        "owner@example.com,,\n"
    )
    rows = parse_csv_rows(csv_content)
    validated = RestaurantCsvRowIn.model_validate(rows[0])
    assert validated.country == "US"
    assert validated.timezone == "America/Chicago"


def test_parse_csv_rows_skips_fully_blank_lines():
    csv_content = (
        f"{_HEADER}\n"
        "Restaurant One,100 Main St,,Plano,TX,75024,US,,,,owner1@example.com,,\n"
        ",,,,,,,,,,,,\n"  # a fully blank data row -- should be skipped, not an error
    )
    rows = parse_csv_rows(csv_content)
    assert len(rows) == 1
