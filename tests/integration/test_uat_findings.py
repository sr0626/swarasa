"""Integration tests for fixes from the 2026-11 UAT run:

- rejecting a claim is audited;
- a manual subscription change reads clearly, ends at the end of the day at the
  location, and never appears in a manager's activity feed;
- a ZIP code must belong to its state;
- a catering request closes at the end of its event date;
- no "deal available today" on a day the location is closed.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.restaurant_hours import RestaurantHours
from factories import (
    create_brand,
    create_catering_request,
    create_catering_location,
    create_claim,
    create_deal,
    create_location,
    create_location_manager,
    create_owner,
)

CHICAGO = ZoneInfo("America/Chicago")


def _today_local():
    return datetime.now(timezone.utc).astimezone(CHICAGO).date()


async def _owned_location(db_session, **fields):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id, **fields)
    await db_session.commit()
    return owner, brand, location


@pytest.mark.asyncio
async def test_rejecting_a_claim_is_audited_and_is_not_a_note_edit(client, db_session, as_user):
    brand = await create_brand(db_session, is_claimed=False, owner_id=None)
    claim = await create_claim(db_session, brand_id=brand.id, status="pending_review")
    await db_session.commit()
    admin = as_user("admin")

    response = await client.post(
        f"/claim/{claim.id}/reject", json={"reviewer_notes": "Could not verify."}
    )
    assert response.status_code == 200, response.text

    rows = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.table_name == "claim_request", AuditLog.record_id == claim.id
            )
        )
    ).scalars().all()
    assert [(r.action, r.actor_id, r.new_val) for r in rows] == [
        ("update", admin.cognito_sub, {"status": "rejected"})
    ]

    log = (await client.get("/admin/audit-log?entity=claim_request")).json()
    assert log["results"][0]["summary"] == "Claim rejected"
    queue = (await client.get("/claim?status=rejected")).json()["results"][0]
    assert queue.get("notes_edited_at") is None


@pytest.mark.asyncio
async def test_manual_subscription_ends_locally_and_stays_out_of_the_manager_feed(
    client, db_session, as_user
):
    owner, _, location = await _owned_location(db_session, timezone="America/Chicago")
    manager = await create_location_manager(db_session, location_id=location.id, is_active=True)
    await db_session.commit()
    until = _today_local() + timedelta(days=30)

    as_user("admin")
    url = f"/admin/locations/{location.id}/subscription"
    assert (await client.put(url, json={"is_paid": True, "paid_until": until.isoformat()})).status_code == 200
    assert (await client.put(url, json={"is_paid": False, "paid_until": None})).status_code == 200

    as_user("manager", sub=manager.user_id)
    feed = (await client.get("/auth/me/activity")).json()
    assert feed["total"] == 0, feed

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    mine = (await client.get("/auth/me/activity")).json()
    assert [r["summary"] for r in mine["results"]] == [
        "Manual subscription cleared",
        "Manual subscription set",
    ]
    changes = {c["field"]: c for c in mine["results"][1]["changes"]}
    assert "note" not in changes
    assert changes["paid_until"]["new"] == f"{until.strftime('%b')} {until.day}, {until.year}"


@pytest.mark.asyncio
async def test_zip_must_belong_to_the_state_when_it_changes(client, db_session, as_user):
    # An older row with a bad pair stays editable until its ZIP or state changes.
    owner, brand, location = await _owned_location(db_session, state="TX", postal_code="66666")
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    unrelated = await client.patch(
        f"/locations/{location.id}", json={"state": "TX", "postal_code": "66666", "city": "Irving"}
    )
    assert unrelated.status_code == 200, unrelated.text

    bad = await client.patch(f"/locations/{location.id}", json={"postal_code": "10001"})
    assert bad.status_code == 422, bad.text
    assert bad.json()["code"] == "zip_state_mismatch"
    assert (await client.patch(f"/locations/{location.id}", json={"postal_code": "75038"})).status_code == 200

    created = await client.post(
        "/locations",
        json={
            "brand_id": brand.id,
            "address_line1": "1 Test St",
            "city": "Irving",
            "state": "TX",
            "postal_code": "66666",
            "phone": "(214) 555-0142",
        },
    )
    assert created.status_code == 422, created.text
    assert created.json()["code"] == "zip_state_mismatch"


@pytest.mark.asyncio
async def test_catering_request_closes_after_its_event_date(client, db_session, as_user):
    location = await create_catering_location(db_session)
    sub = "11111111-1111-1111-1111-111111111111"
    # Created before the rule: still within its 14 days, but the event passed.
    await create_catering_request(
        db_session,
        location_ids=[location.id],
        requester_sub=sub,
        event_date=_today_local() - timedelta(days=1),
        expires_at=datetime.now(timezone.utc) + timedelta(days=9),
    )
    upcoming = _today_local() + timedelta(days=3)
    await create_catering_request(
        db_session,
        location_ids=[location.id],
        requester_sub=sub,
        event_date=upcoming,
        expires_at=datetime.now(timezone.utc) + timedelta(days=14),
    )
    await db_session.commit()
    # One shared test session: drop the cached rows so the request re-reads them
    # after the bulk expiry update (production uses a session per request).
    db_session.expire_all()
    as_user("registered_user", sub=sub)

    results = (await client.get("/catering/requests")).json()["results"]
    by_date = {r["event_date"]: r for r in results}
    past = by_date[(_today_local() - timedelta(days=1)).isoformat()]
    assert past["status"] == "closed"
    open_one = by_date[upcoming.isoformat()]
    assert open_one["status"] == "open"
    closes = datetime.fromisoformat(open_one["expires_at"].replace("Z", "+00:00")).astimezone(CHICAGO)
    # Shown as "open until <date>": it must be the event date itself.
    assert (closes.date(), closes.hour, closes.minute) == (upcoming, 23, 59)


@pytest.mark.asyncio
async def test_no_deal_today_on_a_day_the_location_is_closed(client, db_session, as_user):
    _, brand, location = await _owned_location(db_session, timezone="America/Chicago")
    today = _today_local().weekday()
    db_session.add(RestaurantHours(location_id=location.id, day_of_week=today, is_closed=True))
    await create_deal(
        db_session,
        location_id=location.id,
        is_active=True,
        applicable_days=None,
        start_at=None,
        end_at=None,
    )
    await db_session.commit()
    as_user("registered_user")

    detail = (await client.get(f"/locations/{location.id}")).json()
    assert detail["has_deal_today"] is False
    page = (await client.get(f"/restaurants/by-slug/{brand.slug}")).json()
    assert page["locations"][0]["has_deal_today"] is False

    as_user_detail = await client.get(f"/restaurants/by-slug/{brand.slug}/locations/{location.slug}")
    body = as_user_detail.json()["location"]
    assert body["has_deal_today"] is False
