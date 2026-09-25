"""The shipped CSV template (`scripts/data/restaurants_import_template.csv`)
must always pass the real importer's parse + validate steps, and the helper
script's local validation must reject the same bad rows the server would.
Pure logic -- no DB, no network, no AWS.
"""
from __future__ import annotations

import csv
import importlib.util
import json
from pathlib import Path

from app.core.phone import normalize_us_phone
from app.schemas.restaurant_bulk_import import RestaurantCsvRowIn
from app.services.restaurant_bulk_import_service import parse_csv_rows

_REPO = Path(__file__).resolve().parents[2]
_TEMPLATE = _REPO / "scripts" / "data" / "restaurants_import_template.csv"
_TAXONOMY = _REPO / "backend" / "app" / "scripts" / "taxonomy.json"

# Every header the parser/schema understands (`type` is renamed to
# `cuisine_type` by `parse_csv_rows`; `timezone`/`is_verified` are schema
# fields the helper script does not pass through).
_KNOWN_HEADERS = {
    "name", "address_line1", "address_line2", "city", "state", "postal_code",
    "country", "phone", "website", "type", "description", "owner_email",
    "latitude", "longitude",
}


def _load_script():
    spec = importlib.util.spec_from_file_location(
        "bulk_import_script", _REPO / "scripts" / "bulk_import_restaurants_csv.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_template_header_is_exactly_the_supported_columns():
    with _TEMPLATE.open(newline="", encoding="utf-8") as f:
        header = next(csv.reader(f))
    assert set(header) == _KNOWN_HEADERS
    assert len(header) == len(set(header))


def test_template_rows_pass_parse_schema_and_phone_rule():
    rows = parse_csv_rows(_TEMPLATE.read_text(encoding="utf-8"))
    assert len(rows) >= 2
    tag_forms = set()
    for tag in json.loads(_TAXONOMY.read_text(encoding="utf-8")):
        tag_forms |= {tag["name"], tag["display_name"].lower()}
    for raw in rows:
        row = RestaurantCsvRowIn.model_validate(raw)
        if row.phone:
            assert normalize_us_phone(row.phone) is not None
        if row.cuisine_type:
            assert row.cuisine_type.lower().replace(" ", "_") in tag_forms
        assert row.owner_email


def test_template_rows_pass_script_validation():
    script = _load_script()
    rows = script.read_input_csv(_TEMPLATE)
    errors, warnings = script.validate_rows(rows)
    assert errors == []
    assert warnings == []


def test_script_validation_rejects_bad_rows():
    script = _load_script()
    good = {
        "name": "X", "address_line1": "1 Main", "city": "Plano", "state": "TX",
        "postal_code": "75024", "owner_email": "o@example.com",
    }
    assert script.validate_rows([good]) == ([], [])

    bad_phone, _ = script.validate_rows([{**good, "phone": "123-456-7890"}])
    assert any("invalid phone" in e for e in bad_phone)

    bad_state, _ = script.validate_rows([{**good, "state": "Texas"}])
    assert any("state" in e for e in bad_state)

    missing, _ = script.validate_rows([{**good, "owner_email": ""}])
    assert any("owner_email" in e for e in missing)

    half_coords, _ = script.validate_rows([{**good, "latitude": "32.8"}])
    assert any("latitude and longitude" in e for e in half_coords)

    _, warnings = script.validate_rows([{**good, "type": "not a real tag"}])
    assert len(warnings) == 1
