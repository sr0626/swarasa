"""Integration tests: the admin bulk import creates EVERY listing hidden
(`coming_soon`), reports what is still missing per row, accepts the optional
`hours` column, and leaves activation to the normal readiness rule
(docs/DECISIONS.md "Bulk import is invisible by default")."""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.restaurant_hours import RestaurantHours
from app.models.restaurant_location import RestaurantLocation
import app.main as app_main
from app.dependencies.auth import CurrentUser, get_current_user, get_current_user_optional
from factories import create_cuisine_tag

FULL_WEEK = "Mon-Fri 11:00-22:00; Sat 11:00-23:00; Sun closed"


def row(n: int, **over):
    base = {
        "row_number": n,
        "name": f"Spice Hut {n}",
        "address_line1": f"{n} Main St",
        "city": "Plano",
        "state": "TX",
        "postal_code": "75024",
        "phone": f"(214) 555-{n:04d}",
        "type": "south indian",
        "latitude": "33.02",
        "longitude": "-96.70",
    }
    base.update(over)
    return base


async def validate(client, rows):
    resp = await client.post("/admin/import/validate", json={"rows": rows})
    assert resp.status_code == 200, resp.text
    return resp.json()


async def commit(client, rows):
    resp = await client.post("/admin/import/commit", json={"rows": rows, "include_warnings": False})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _as_admin_viewer(client_user: CurrentUser) -> None:
    """`GET /locations/{id}` reads the caller through `get_current_user_optional`,
    which `as_user` does not override."""

    async def _dep():
        return client_user

    app_main.app.dependency_overrides[get_current_user_optional] = _dep


@pytest.fixture(autouse=True)
def _no_postgis(monkeypatch):
    async def _noop(*_a, **_k):
        return None

    monkeypatch.setattr("app.services.restaurant_bulk_import_service._sync_geom", _noop)


@pytest.fixture
async def tag(db_session):
    return await create_cuisine_tag(db_session, name="south_indian", display_name="South Indian")


@pytest.mark.asyncio
async def test_validate_predicts_missing_for_every_importable_row(client, db_session, as_user, tag):
    as_user("admin")
    rows = [
        row(2),  # no hours
        row(3, hours=FULL_WEEK),  # complete
        row(4, phone=None, hours=FULL_WEEK),  # no phone
        row(5, hours="Mon-Fri 11:00-22:00"),  # 5 of 7 days
        row(6, hours="whenever we feel like it"),  # not understood -> warning issue, no hours
        row(7, name="", hours=FULL_WEEK),  # error: no prediction
    ]
    data = await validate(client, rows)
    by_row = {r["row_number"]: r for r in data["rows"]}
    assert by_row[2]["missing"] == ["hours"]
    assert by_row[3]["missing"] == [] and by_row[3]["status"] == "valid"
    assert by_row[4]["missing"] == ["phone"]
    assert by_row[5]["missing"] == ["hours"]
    assert any(i["code"] == "partial_hours" for i in by_row[5]["issues"])
    # A bad hours cell never blocks the row or changes its status.
    assert by_row[6]["status"] == "valid" and by_row[6]["missing"] == ["hours"]
    assert any(i["code"] == "bad_hours" and i["severity"] == "warning" for i in by_row[6]["issues"])
    assert by_row[7]["status"] == "error" and by_row[7]["missing"] == []
    assert data["summary"]["ready_to_activate"] == 1
    assert data["summary"]["incomplete"] == 4


@pytest.mark.asyncio
async def test_commit_always_creates_hidden_even_when_complete(client, db_session, as_user, tag):
    as_user("admin")
    result = await commit(client, [row(2, hours=FULL_WEEK), row(3), row(4, phone=None, hours=FULL_WEEK)])
    by_row = {r["row_number"]: r for r in result["rows"]}
    assert all(r["result"] == "created" and r["listing_status"] == "coming_soon" for r in by_row.values())
    assert by_row[2]["missing"] == []  # complete: ready to activate, but NOT active
    assert by_row[3]["missing"] == ["hours"]
    assert by_row[4]["missing"] == ["phone"]
    assert result["summary"]["created"] == 3
    assert result["summary"]["created_ready_to_activate"] == 1
    assert result["summary"]["created_incomplete"] == 2
    statuses = (await db_session.execute(select(RestaurantLocation.status))).scalars().all()
    assert statuses == ["coming_soon"] * 3


@pytest.mark.asyncio
async def test_hours_column_is_stored_as_day_rows(client, db_session, as_user, tag):
    as_user("admin")
    await commit(client, [row(2, hours=FULL_WEEK), row(3, hours="Mon-Fri 11:00-22:00"), row(4, hours="bogus")])
    rows = (await db_session.execute(select(RestaurantHours))).scalars().all()
    by_loc: dict[int, list[RestaurantHours]] = {}
    for h in rows:
        by_loc.setdefault(h.location_id, []).append(h)
    assert sorted(len(v) for v in by_loc.values()) == [5, 7]  # the "bogus" row stored nothing
    full = next(v for v in by_loc.values() if len(v) == 7)
    sunday = next(h for h in full if h.day_of_week == 6)
    assert sunday.is_closed is True and sunday.open_time is None
    saturday = next(h for h in full if h.day_of_week == 5)
    assert saturday.is_closed is False and saturday.close_time.hour == 23


@pytest.mark.asyncio
async def test_imported_listing_activates_only_through_the_readiness_rule(client, db_session, as_user, tag):
    admin = as_user("admin")
    _as_admin_viewer(admin)
    result = await commit(client, [row(2, hours=FULL_WEEK), row(3)])
    complete_id = result["rows"][0]["location_id"]
    incomplete_id = result["rows"][1]["location_id"]

    # The editor checklist (setup_missing) shows imported listings like manual ones, to the admin.
    detail = (await client.get(f"/locations/{incomplete_id}")).json()
    assert detail["status"] == "coming_soon" and detail["setup_missing"] == ["hours"]
    assert (await client.get(f"/locations/{complete_id}")).json()["setup_missing"] == []

    refused = await client.post(f"/locations/{incomplete_id}/status", json={"status": "active"})
    assert refused.status_code == 422
    body = refused.json()
    assert body["code"] == "listing_incomplete" and body["missing"] == ["hours"]
    assert "opening hours" in body["detail"]

    ok = await client.post(f"/locations/{complete_id}/status", json={"status": "active"})
    assert ok.status_code == 200 and ok.json()["status"] == "active"


@pytest.mark.asyncio
async def test_hidden_imports_are_not_public(client, db_session, as_user, tag):
    as_user("admin")
    result = await commit(client, [row(2, hours=FULL_WEEK)])
    location_id = result["rows"][0]["location_id"]
    app_main.app.dependency_overrides.pop(get_current_user, None)
    app_main.app.dependency_overrides.pop(get_current_user_optional, None)
    assert (await client.get(f"/locations/{location_id}")).status_code == 404
