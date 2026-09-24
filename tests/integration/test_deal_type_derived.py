"""Integration tests: the Deal-vs-Special label is DERIVED from `end_at`
(2026-09-24 user decision; `app.models.deal.effective_deal_type`) — no end
date (ongoing) -> "special", has an end date -> "deal" — on every surface
that serializes a deal: management CRUD, `deals_today`, `upcoming_deals`.
A client-supplied `deal_type` is accepted and ignored; legacy rows whose
stored column disagrees with `end_at` read back derived (no backfill).

(`GET /auth/me/follows` and `/search` expose only titles / a boolean, never
a deal type, so they have nothing to disagree.)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

import app.main as app_main
from app.dependencies.auth import CurrentUser, get_current_user_optional
from app.models.audit_log import AuditLog
from app.models.deal import Deal, effective_deal_type

from factories import create_brand, create_deal, create_location, create_owner

_START = "2027-01-01T00:00:00Z"
_END = "2027-02-01T00:00:00Z"


def _as_registered_user() -> None:
    user = CurrentUser(cognito_sub=str(uuid.uuid4()), email="viewer@example.com", role="registered_user")

    async def _override():
        return user

    app_main.app.dependency_overrides[get_current_user_optional] = _override


def test_effective_deal_type_pure():
    assert effective_deal_type(None) == "special"
    assert effective_deal_type(datetime(2027, 1, 1, tzinfo=timezone.utc)) == "deal"


async def _seed(db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    return owner, location


@pytest.mark.asyncio
async def test_create_with_end_date_is_deal_and_ongoing_is_special(client, db_session, as_user):
    owner, location = await _seed(db_session)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    with_end = await client.post(
        f"/locations/{location.id}/deals", json={"title": "Dated", "start_at": _START, "end_at": _END}
    )
    assert with_end.status_code == 201, with_end.text
    assert with_end.json()["deal_type"] == "deal"

    ongoing = await client.post(
        f"/locations/{location.id}/deals",
        json={"title": "Standing", "start_at": _START, "ongoing": True},
    )
    assert ongoing.status_code == 201, ongoing.text
    assert ongoing.json()["deal_type"] == "special"

    stored = {d.title: d.deal_type for d in (await db_session.execute(select(Deal))).scalars()}
    assert stored == {"Dated": "deal", "Standing": "special"}


@pytest.mark.asyncio
async def test_client_supplied_deal_type_is_ignored_on_create_and_patch(client, db_session, as_user):
    owner, location = await _seed(db_session)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    created = await client.post(
        f"/locations/{location.id}/deals",
        json={"deal_type": "special", "title": "Wrong label", "start_at": _START, "end_at": _END},
    )
    assert created.status_code == 201, created.text
    assert created.json()["deal_type"] == "deal"
    url = f"/locations/{location.id}/deals/{created.json()['id']}"

    patched = await client.patch(url, json={"deal_type": "special", "title": "Still dated"})
    assert patched.status_code == 200, patched.text
    assert patched.json()["deal_type"] == "deal"
    assert patched.json()["title"] == "Still dated"

    # Even a null / junk value is dropped, not a 422/400.
    junk = await client.patch(url, json={"deal_type": None})
    assert junk.status_code == 200, junk.text
    assert junk.json()["deal_type"] == "deal"


@pytest.mark.asyncio
async def test_patch_adding_and_removing_end_date_flips_type_and_audits(client, db_session, as_user):
    owner, location = await _seed(db_session)
    deal = await create_deal(db_session, location_id=location.id, title="Flip", start_at=None, end_at=None)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    url = f"/locations/{location.id}/deals/{deal.id}"

    r = await client.patch(url, json={"start_at": _START, "end_at": _END})
    assert r.status_code == 200, r.text
    assert r.json()["deal_type"] == "deal"

    r = await client.patch(url, json={"ongoing": True})
    assert r.status_code == 200, r.text
    assert r.json()["deal_type"] == "special"
    assert r.json()["end_at"] is None

    # Toggle active + title edit do not disturb it.
    r = await client.patch(url, json={"is_active": False, "title": "Renamed"})
    assert r.status_code == 200, r.text
    assert r.json()["deal_type"] == "special"

    entries = (
        await db_session.execute(
            select(AuditLog)
            .where(AuditLog.table_name == "deal", AuditLog.record_id == deal.id, AuditLog.action == "update")
            .order_by(AuditLog.id)
        )
    ).scalars().all()
    assert [(e.old_val["deal_type"], e.new_val["deal_type"]) for e in entries] == [
        ("special", "deal"),
        ("deal", "special"),
        ("special", "special"),
    ]


@pytest.mark.asyncio
async def test_create_audit_records_effective_type(client, db_session, as_user):
    owner, location = await _seed(db_session)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    r = await client.post(
        f"/locations/{location.id}/deals",
        json={"deal_type": "deal", "title": "Aud", "start_at": _START, "ongoing": True},
    )
    assert r.status_code == 201, r.text
    entry = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.table_name == "deal", AuditLog.record_id == r.json()["id"], AuditLog.action == "create"
            )
        )
    ).scalar_one()
    assert entry.new_val["deal_type"] == "special"


@pytest.mark.asyncio
async def test_legacy_mismatched_rows_read_back_derived_everywhere(client, db_session, as_user):
    """Stored column deliberately disagrees with end_at (hand-picked labels
    from before this change): every read path must still return the derived
    value, and a write heals the stored column without changing what is
    returned."""
    owner, location = await _seed(db_session)
    ongoing_labelled_deal = await create_deal(
        db_session, location_id=location.id, title="Ongoing mislabelled", deal_type="deal", end_at=None
    )
    dated_labelled_special = await create_deal(
        db_session,
        location_id=location.id,
        title="Dated mislabelled",
        deal_type="special",
        end_at=datetime(2099, 1, 1, tzinfo=timezone.utc),
    )
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    listing = await client.get(f"/locations/{location.id}/deals")
    by_title = {d["title"]: d["deal_type"] for d in listing.json()["results"]}
    assert by_title == {"Ongoing mislabelled": "special", "Dated mislabelled": "deal"}

    # Public detail (registered user): deals_today carries derived types.
    _as_registered_user()
    detail = (await client.get(f"/locations/{location.id}")).json()
    today = {d["title"]: d["deal_type"] for d in detail["deals_today"]}
    assert today == {"Ongoing mislabelled": "special", "Dated mislabelled": "deal"}

    # Lazy heal on next write; response unchanged.
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    r = await client.patch(
        f"/locations/{location.id}/deals/{ongoing_labelled_deal.id}", json={"title": "Healed"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["deal_type"] == "special"
    await db_session.refresh(ongoing_labelled_deal)
    assert ongoing_labelled_deal.deal_type == "special"
    await db_session.refresh(dated_labelled_special)
    assert dated_labelled_special.deal_type == "special"  # untouched row: stored value left as-is


@pytest.mark.asyncio
async def test_upcoming_deals_use_derived_type(client, db_session):
    _, location = await _seed(db_session)
    weekday = (datetime.now(timezone.utc).weekday() + 3) % 7
    await create_deal(
        db_session,
        location_id=location.id,
        title="Later dated",
        deal_type="special",  # stale
        applicable_days=[weekday],
        end_at=datetime(2099, 1, 1, tzinfo=timezone.utc),
    )
    await create_deal(
        db_session,
        location_id=location.id,
        title="Later ongoing",
        deal_type="deal",  # stale
        applicable_days=[weekday],
    )
    await db_session.commit()

    _as_registered_user()
    body = (await client.get(f"/locations/{location.id}")).json()
    assert {d["title"]: d["deal_type"] for d in body["upcoming_deals"]} == {
        "Later dated": "deal",
        "Later ongoing": "special",
    }
