"""Unit tests for the `list_ungeocoded_locations` / `set_location_coordinates`
management-command wrappers in app/scripts/management.py -- registration,
payload validation, and dispose_engine handling, with the DB-touching
`run_*` functions faked (no DB, no AWS, no network)."""
from __future__ import annotations

import pytest

import app.db.session as session_mod
import app.scripts.geocode_backfill as gb
from app.scripts.management import _COMMANDS, run_management_command


@pytest.fixture
def disposed(monkeypatch):
    calls = []

    async def _dispose():
        calls.append(1)

    monkeypatch.setattr(session_mod, "dispose_engine", _dispose)
    return calls


def test_both_commands_are_registered():
    assert {"list_ungeocoded_locations", "set_location_coordinates"} <= set(_COMMANDS)


def test_list_command_returns_rows_and_disposes_engine(monkeypatch, disposed):
    async def _fake():
        return {"count": 1, "locations": [{"id": 5}]}

    monkeypatch.setattr(gb, "run_list_ungeocoded_locations", _fake)
    out = run_management_command({"_management_command": "list_ungeocoded_locations"}, None)
    assert out == {"ok": True, "command": "list_ungeocoded_locations", "count": 1, "locations": [{"id": 5}]}
    assert disposed == [1]


def test_set_command_passes_entries_and_overwrite_flag(monkeypatch, disposed):
    seen = {}

    async def _fake(entries, overwrite):
        seen["entries"], seen["overwrite"] = entries, overwrite
        return {"summary": {"updated": 1}, "results": []}

    monkeypatch.setattr(gb, "run_set_location_coordinates", _fake)
    entries = [{"location_id": 1, "latitude": 32.8, "longitude": -96.9}]
    out = run_management_command(
        {"_management_command": "set_location_coordinates", "locations": entries, "overwrite": True}, None
    )
    assert out["ok"] is True and out["summary"] == {"updated": 1}
    assert seen == {"entries": entries, "overwrite": True}
    assert disposed == [1]


@pytest.mark.parametrize("locations", [None, [], "nope", {"location_id": 1}])
def test_set_command_rejects_missing_or_non_list_payload(locations, disposed):
    event = {"_management_command": "set_location_coordinates"}
    if locations is not None:
        event["locations"] = locations
    out = run_management_command(event, None)
    assert out["ok"] is False and "locations" in out["error"]
    assert disposed == []


def test_overwrite_defaults_false_and_only_true_enables_it(monkeypatch, disposed):
    seen = []

    async def _fake(entries, overwrite):
        seen.append(overwrite)
        return {"summary": {}, "results": []}

    monkeypatch.setattr(gb, "run_set_location_coordinates", _fake)
    base = {"_management_command": "set_location_coordinates", "locations": [{}]}
    run_management_command(base, None)
    run_management_command({**base, "overwrite": "true"}, None)
    assert seen == [False, False]
