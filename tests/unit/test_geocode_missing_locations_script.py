"""Unit tests for the human-run scripts/geocode_missing_locations.py -- query
building, fallback order, rate limiting, payload building. The Nominatim
fetch and sleep are injected fakes: no network, no AWS, no real sleeping."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "geocode_missing_locations.py"
_spec = importlib.util.spec_from_file_location("geocode_missing_locations", _SCRIPT)
gml = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gml)

LOC = {
    "id": 11, "brand_name": "Taj Chaat House", "address_line1": "1 Main St", "address_line2": None,
    "city": "Irving", "state": "TX", "postal_code": "75038",
}


def test_query_order_is_full_then_street_then_postal():
    methods = [m for m, _ in gml.build_queries(LOC)]
    assert methods == [gml.METHOD_FULL, gml.METHOD_STREET, gml.METHOD_POSTAL]
    queries = dict(gml.build_queries(LOC))
    assert queries[gml.METHOD_FULL]["postalcode"] == "75038"
    assert "postalcode" not in queries[gml.METHOD_STREET]
    # postalcode only: adding `state` makes Nominatim's structured search return nothing.
    assert queries[gml.METHOD_POSTAL] == {
        "format": "json", "limit": "1", "country": "US", "postalcode": "75038",
    }


@pytest.mark.parametrize("raw,expected", [
    ("7447 N MacArthur Blvd Ste 150", "7447 N MacArthur Blvd"),
    ("7750 N MacArthur Blvd #135", "7750 N MacArthur Blvd"),
    ("3311 Regent Blvd Suite 121", "3311 Regent Blvd"),
    ("5250 N O'Connor Blvd Ste 146", "5250 N O'Connor Blvd"),
    ("833 E Shady Grove Rd A", "833 E Shady Grove Rd"),
    ("100 Main St, Unit 4", "100 Main St"),
    ("1001 MacArthur Park Dr", "1001 MacArthur Park Dr"),
])
def test_clean_street_strips_unit_designators(raw, expected):
    assert gml.clean_street(raw) == expected


def test_queries_use_the_cleaned_street():
    loc = {**LOC, "address_line1": "7447 N MacArthur Blvd Ste 150"}
    assert dict(gml.build_queries(loc))[gml.METHOD_FULL]["street"] == "7447 N MacArthur Blvd"


def test_postal_fallback_can_be_disabled_and_missing_postal_skips_redundant_query():
    assert [m for m, _ in gml.build_queries(LOC, include_postal_fallback=False)] == [gml.METHOD_FULL, gml.METHOD_STREET]
    no_postal = {**LOC, "postal_code": ""}
    assert [m for m, _ in gml.build_queries(no_postal)] == [gml.METHOD_FULL]
    assert "postalcode" not in dict(gml.build_queries(no_postal))[gml.METHOD_FULL]


def _run(loc, responses, **kw):
    calls, sleeps = [], []

    def fetch(params):
        calls.append(params)
        return responses[len(calls) - 1]

    return gml.geocode_location(loc, fetch=fetch, sleep=sleeps.append, **kw), calls, sleeps


def test_first_hit_stops_and_rate_limits_each_request():
    result, calls, sleeps = _run(LOC, [[{"lat": "32.85", "lon": "-96.95"}]])
    assert result == {"method": gml.METHOD_FULL, "latitude": 32.85, "longitude": -96.95}
    assert len(calls) == 1 and sleeps == [1.0]


def test_falls_back_through_each_query_and_sleeps_after_every_request():
    result, calls, sleeps = _run(LOC, [[], [], [{"lat": "32.9", "lon": "-96.9"}]])
    assert result["method"] == gml.METHOD_POSTAL and result["latitude"] == 32.9
    assert len(calls) == 3 and sleeps == [1.0, 1.0, 1.0]


def test_failed_request_and_empty_results_both_fall_through_to_unresolved():
    result, calls, _ = _run(LOC, [None, [], None])
    assert result == {"method": None, "latitude": None, "longitude": None}
    assert len(calls) == 3


def test_malformed_result_falls_through_instead_of_crashing():
    result, _, _ = _run(LOC, [[{"nope": 1}], [{"lat": "32.8", "lon": "-96.8"}]])
    assert result["method"] == gml.METHOD_STREET


def test_payload_contains_only_resolved_rows():
    rows = [
        {**LOC, "id": 1, "method": gml.METHOD_FULL, "latitude": 32.8, "longitude": -96.9},
        {**LOC, "id": 2, "method": None, "latitude": None, "longitude": None},
    ]
    assert gml.build_set_payload(rows) == {
        "_management_command": "set_location_coordinates",
        "locations": [{"location_id": 1, "latitude": 32.8, "longitude": -96.9}],
    }
    assert gml.build_set_payload([rows[1]]) is None


def test_table_marks_resolved_and_unresolved():
    rows = [
        {**LOC, "id": 1, "method": gml.METHOD_POSTAL, "latitude": 32.8, "longitude": -96.9},
        {**LOC, "id": 2, "method": None, "latitude": None, "longitude": None},
    ]
    table = gml.format_table(rows)
    assert "resolved" in table and "UNRESOLVED" in table and "zip-approx" in table
    assert "32.800000" in table


def test_defaults_match_other_scripts():
    assert (gml.DEFAULT_PROFILE, gml.DEFAULT_REGION, gml.DEFAULT_FUNCTION_NAME) == (
        "swarasa-dev", "us-east-1", "swarasa-api-dev",
    )
    assert gml.NOMINATIM_RATE_LIMIT_SECONDS >= 1.0
    assert "swarasa" in gml.NOMINATIM_USER_AGENT
