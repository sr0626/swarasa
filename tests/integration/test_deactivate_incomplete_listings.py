"""Integration tests: the `deactivate_incomplete_listings` management command
(backend/app/scripts/deactivate_incomplete_listings.py) -- dry run by default,
`apply` hides only ACTIVE listings that fail the readiness rule, one audit row
per change, idempotent, never touches hidden / complete / deleted-brand rows."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.restaurant_location import RestaurantLocation
from app.scripts.deactivate_incomplete_listings import (
    DeactivateIncompleteError,
    deactivate_incomplete_listings,
    parse_flag,
    parse_location_ids,
)
from app.scripts.management import _COMMANDS, run_management_command
from factories import add_full_week_hours, create_brand, create_location, create_owner


async def _setup(db):
    """active+complete, active+no-hours (unclaimed), active+no-phone (owned),
    already coming_soon+no-hours, active but brand soft-deleted."""
    owner = await create_owner(db)
    complete_brand = await create_brand(db, name="Complete Kitchen")
    complete = await create_location(db, brand_id=complete_brand.id)
    await add_full_week_hours(db, complete.id)

    no_hours_brand = await create_brand(db, name="No Hours Cafe")
    no_hours = await create_location(db, brand_id=no_hours_brand.id)

    no_phone_brand = await create_brand(db, name="No Phone Diner", owner_id=owner.id, is_claimed=True)
    no_phone = await create_location(db, brand_id=no_phone_brand.id, phone=None)
    await add_full_week_hours(db, no_phone.id)

    hidden_brand = await create_brand(db, name="Already Hidden")
    hidden = await create_location(db, brand_id=hidden_brand.id, status="coming_soon")

    deleted_brand = await create_brand(db, name="Deleted Place", deleted_at=datetime.now(timezone.utc))
    deleted = await create_location(db, brand_id=deleted_brand.id)
    await db.commit()
    return {"complete": complete, "no_hours": no_hours, "no_phone": no_phone, "hidden": hidden, "deleted": deleted}


async def _statuses(db) -> dict[int, str]:
    rows = (await db.execute(select(RestaurantLocation.id, RestaurantLocation.status))).all()
    return {loc_id: status for loc_id, status in rows}


def test_command_is_registered():
    assert "deactivate_incomplete_listings" in _COMMANDS


@pytest.mark.asyncio
async def test_dry_run_is_the_default_and_changes_nothing(db_session):
    locs = await _setup(db_session)
    before = await _statuses(db_session)

    report = await deactivate_incomplete_listings(db_session)

    assert report["mode"] == "dry_run" and report["changed"] == 0
    assert report["checked_active"] == 3  # complete, no_hours, no_phone (deleted brand + hidden excluded)
    assert report["incomplete"] == 2
    assert report["missing_counts"] == {"hours": 1, "phone": 1}
    listed = {item["location_id"]: item["missing"] for item in report["listings"]}
    assert listed == {locs["no_hours"].id: ["hours"], locs["no_phone"].id: ["phone"]}
    assert await _statuses(db_session) == before
    assert (await db_session.execute(select(AuditLog))).scalars().all() == []


@pytest.mark.asyncio
async def test_apply_hides_only_incomplete_active_listings_with_audit(db_session):
    locs = await _setup(db_session)

    report = await deactivate_incomplete_listings(db_session, apply=True)

    assert report["mode"] == "apply" and report["changed"] == 2
    statuses = await _statuses(db_session)
    assert statuses[locs["no_hours"].id] == "coming_soon"
    assert statuses[locs["no_phone"].id] == "coming_soon"
    assert statuses[locs["complete"].id] == "active"  # complete: untouched
    assert statuses[locs["hidden"].id] == "coming_soon"
    assert statuses[locs["deleted"].id] == "active"  # deleted brand: not our business

    audits = (await db_session.execute(select(AuditLog))).scalars().all()
    assert len(audits) == 2
    assert {a.record_id for a in audits} == {locs["no_hours"].id, locs["no_phone"].id}
    for a in audits:
        assert a.table_name == "restaurant_location" and a.action == "update"
        assert a.actor_id == "system:deactivate_incomplete_listings"
        assert a.old_val == {"status": "active"} and a.new_val == {"status": "coming_soon"}


@pytest.mark.asyncio
async def test_apply_is_idempotent(db_session):
    await _setup(db_session)
    await deactivate_incomplete_listings(db_session, apply=True)
    audits_after_first = len((await db_session.execute(select(AuditLog))).scalars().all())

    again = await deactivate_incomplete_listings(db_session, apply=True)

    assert again["incomplete"] == 0 and again["changed"] == 0
    assert len((await db_session.execute(select(AuditLog))).scalars().all()) == audits_after_first


@pytest.mark.asyncio
async def test_only_unclaimed_limits_to_ownerless_brands(db_session):
    locs = await _setup(db_session)

    report = await deactivate_incomplete_listings(db_session, apply=True, only_unclaimed=True)

    assert report["only_unclaimed"] is True and report["changed"] == 1
    statuses = await _statuses(db_session)
    assert statuses[locs["no_hours"].id] == "coming_soon"  # unclaimed
    assert statuses[locs["no_phone"].id] == "active"  # owned: left alone


@pytest.mark.asyncio
async def test_list_is_capped(db_session, monkeypatch):
    monkeypatch.setattr("app.scripts.deactivate_incomplete_listings.LIST_CAP", 1)
    await _setup(db_session)
    report = await deactivate_incomplete_listings(db_session)
    assert report["incomplete"] == 2 and len(report["listings"]) == 1
    assert report["listings_truncated"] is True


def test_flags_must_be_real_booleans():
    assert parse_flag({}, "apply") is False
    assert parse_flag({"apply": True}, "apply") is True
    for bad in ("true", "false", 1, None, "yes"):
        with pytest.raises(DeactivateIncompleteError):
            parse_flag({"apply": bad}, "apply")


def test_management_wrapper_rejects_a_non_boolean_apply_without_touching_the_db():
    out = run_management_command(
        {"_management_command": "deactivate_incomplete_listings", "apply": "false"}, None
    )
    assert out["ok"] is False and "'apply' must be true or false" in out["error"]


@pytest.mark.asyncio
async def test_location_ids_limits_the_run_to_exactly_those_locations(db_session):
    locs = await _setup(db_session)

    report = await deactivate_incomplete_listings(
        db_session, apply=True, location_ids=[locs["no_hours"].id]
    )

    assert report["location_ids"] == [locs["no_hours"].id]
    assert report["checked_active"] == 1 and report["changed"] == 1
    statuses = await _statuses(db_session)
    assert statuses[locs["no_hours"].id] == "coming_soon"
    assert statuses[locs["no_phone"].id] == "active"  # incomplete but NOT named
    assert statuses[locs["complete"].id] == "active"


@pytest.mark.asyncio
async def test_location_ids_naming_complete_or_hidden_locations_is_a_noop(db_session):
    locs = await _setup(db_session)
    before = await _statuses(db_session)

    report = await deactivate_incomplete_listings(
        db_session, apply=True, location_ids=[locs["complete"].id, locs["hidden"].id, locs["deleted"].id, 999999]
    )

    assert report["changed"] == 0 and report["incomplete"] == 0
    assert await _statuses(db_session) == before


def test_parse_location_ids_validation():
    assert parse_location_ids({}) is None
    assert parse_location_ids({"location_ids": [3, 1, 3]}) == [1, 3]
    for bad in ([], "67", [True], [0], [-1], ["1"], [1.5], 5, [1] * 0, list(range(1, 1002))):
        with pytest.raises(DeactivateIncompleteError):
            parse_location_ids({"location_ids": bad})


def test_management_command_rejects_bad_location_ids(monkeypatch):
    result = run_management_command(
        {"_management_command": "deactivate_incomplete_listings", "location_ids": "67"}, None
    )
    assert result["ok"] is False and "location_ids" in result["error"]
