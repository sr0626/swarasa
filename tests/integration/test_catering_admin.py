"""Integration test: admin side of catering — the MANUAL paid flag
(`PUT /admin/locations/{id}/subscription`), the read-only
`GET /admin/catering` list, and the `set_platform_int` management command
that changes `catering_max_restaurants`."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.platform_config import PlatformConfig
from app.models.restaurant_location import RestaurantLocation
from app.scripts.management import _COMMANDS
from app.scripts.set_platform_int import SetPlatformIntError, set_platform_int
from factories import (
    create_brand,
    create_catering_location,
    create_catering_request,
    create_location,
    create_owner,
)


async def _free_location(db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()
    return location


def _in(days: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).date().isoformat()


# ---------------------------------------------------------------------------
# manual subscription flag
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_subscription_endpoint_is_admin_only(client, db_session, as_user, as_anonymous):
    location = await _free_location(db_session)
    url = f"/admin/locations/{location.id}/subscription"
    body = {"is_paid": True, "paid_until": _in(30)}
    assert (await client.put(url, json=body)).status_code == 401
    for role in ("owner", "manager", "registered_user"):
        as_user(role)
        assert (await client.put(url, json=body)).status_code == 403, role
    await db_session.refresh(location)
    assert location.is_paid is False


@pytest.mark.asyncio
async def test_admin_sets_subscription_with_end_date_and_audits(client, db_session, as_user):
    location = await _free_location(db_session)
    admin = as_user("admin")
    until = _in(30)

    resp = await client.put(
        f"/admin/locations/{location.id}/subscription", json={"is_paid": True, "paid_until": until}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["is_paid"] is True
    assert body["subscribed"] is True
    assert body["paid_until"].startswith(until)

    await db_session.refresh(location)
    assert location.is_paid is True
    assert location.paid_until is not None

    audit = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.table_name == "restaurant_location", AuditLog.record_id == location.id
            )
        )
    ).scalar_one()
    assert audit.actor_id == admin.cognito_sub
    assert audit.actor_role == "admin"
    assert audit.old_val == {"is_paid": False, "paid_until": None}
    assert audit.new_val["is_paid"] is True
    assert audit.new_val["note"] == "manual"
    assert audit.new_val["paid_until"].startswith(until)


@pytest.mark.asyncio
async def test_open_ended_subscription_and_clearing(client, db_session, as_user):
    location = await _free_location(db_session)
    as_user("admin")
    url = f"/admin/locations/{location.id}/subscription"

    on = await client.put(url, json={"is_paid": True, "paid_until": None})
    assert on.json()["subscribed"] is True
    assert on.json()["paid_until"] is None

    # is_paid=false always clears paid_until, even if one is sent.
    off = await client.put(url, json={"is_paid": False, "paid_until": _in(10)})
    assert off.status_code == 200
    assert off.json() == {
        "location_id": location.id,
        "is_paid": False,
        "paid_until": None,
        "subscribed": False,
    }
    await db_session.refresh(location)
    assert location.paid_until is None


@pytest.mark.asyncio
async def test_past_or_today_end_date_rejected(client, db_session, as_user):
    location = await _free_location(db_session)
    as_user("admin")
    url = f"/admin/locations/{location.id}/subscription"
    yesterday = (date.today() - timedelta(days=2)).isoformat()
    resp = await client.put(url, json={"is_paid": True, "paid_until": yesterday})
    assert resp.status_code == 422
    await db_session.refresh(location)
    assert location.is_paid is False
    assert (
        await db_session.execute(select(AuditLog).where(AuditLog.table_name == "restaurant_location"))
    ).first() is None


@pytest.mark.asyncio
async def test_subscription_unknown_location_404_and_bad_body_422(client, db_session, as_user):
    as_user("admin")
    assert (
        await client.put("/admin/locations/999999/subscription", json={"is_paid": True})
    ).status_code == 404
    location = await _free_location(db_session)
    url = f"/admin/locations/{location.id}/subscription"
    assert (await client.put(url, json={})).status_code == 422
    assert (await client.put(url, json={"is_paid": True, "paid_until": "nope"})).status_code == 422
    assert (await client.put(url, json={"is_paid": True, "extra": 1})).status_code == 422


@pytest.mark.asyncio
async def test_manual_flag_makes_a_location_selectable(client, db_session, as_user):
    owner = await create_owner(db_session)
    location = await create_catering_location(db_session, owner=owner, is_paid=False)
    await db_session.commit()
    as_user("registered_user")
    assert (await client.get(f"/catering/eligibility/{location.id}")).json()["eligible"] is False

    as_user("admin")
    await client.put(
        f"/admin/locations/{location.id}/subscription", json={"is_paid": True, "paid_until": _in(7)}
    )
    as_user("registered_user")
    assert (await client.get(f"/catering/eligibility/{location.id}")).json()["eligible"] is True


@pytest.mark.asyncio
async def test_menu_and_deals_stay_free_of_tier_gating(client, db_session, as_user):
    """Setting/clearing the manual flag must not change free features: a
    FREE location's public page still returns normally."""
    location = await _free_location(db_session)
    as_user("admin")
    await client.put(f"/admin/locations/{location.id}/subscription", json={"is_paid": True})
    await client.put(f"/admin/locations/{location.id}/subscription", json={"is_paid": False})
    refreshed = await db_session.get(RestaurantLocation, location.id)
    assert refreshed.is_paid is False
    resp = await client.get(f"/locations/{location.id}/menu")
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# GET /admin/catering
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_admin_catering_list_counts_and_search(client, db_session, as_user, as_anonymous):
    l1 = await create_catering_location(db_session)
    l2 = await create_catering_location(db_session)
    req = await create_catering_request(
        db_session, location_ids=[l1.id, l2.id], requester_email="hungry.person@example.com"
    )
    req.recipients[0].status = "quoted"
    req.recipients[1].status = "declined"
    other = await create_catering_request(db_session, location_ids=[l1.id])
    await db_session.commit()

    assert (await client.get("/admin/catering")).status_code == 401
    as_user("owner")
    assert (await client.get("/admin/catering")).status_code == 403
    as_user("registered_user")
    assert (await client.get("/admin/catering")).status_code == 403

    as_user("admin")
    body = (await client.get("/admin/catering")).json()
    assert body["total"] == 2
    assert body["open_count"] == 2
    by_id = {r["id"]: r for r in body["results"]}
    row = by_id[req.id]
    assert (row["recipient_count"], row["quoted_count"], row["declined_count"]) == (2, 1, 1)
    assert row["pending_count"] == 0
    assert by_id[other.id]["pending_count"] == 1

    found = (await client.get("/admin/catering", params={"q": "HUNGRY.person"})).json()
    assert [r["id"] for r in found["results"]] == [req.id]
    assert (await client.get("/admin/catering", params={"q": "%"})).json()["total"] == 0
    cancelled = (await client.get("/admin/catering", params={"status": "cancelled"})).json()
    assert cancelled["total"] == 0
    assert (await client.get("/admin/catering", params={"status": "bogus"})).status_code == 422


# ---------------------------------------------------------------------------
# set_platform_int
# ---------------------------------------------------------------------------
def test_set_platform_int_registered():
    assert "set_platform_int" in _COMMANDS


@pytest.mark.asyncio
async def test_set_platform_int_reads_writes_and_validates(db_session):
    read = await set_platform_int("catering_max_restaurants", None, db=db_session)
    assert read == {"key": "catering_max_restaurants", "value": 5, "changed": False}

    out = await set_platform_int("catering_max_restaurants", 8, db=db_session)
    assert out == {
        "key": "catering_max_restaurants",
        "value": 8,
        "previous": 5,
        "changed": True,
    }
    assert (await db_session.get(PlatformConfig, "catering_max_restaurants")).value == "8"
    assert (await set_platform_int("catering_max_restaurants", "8", db=db_session))["changed"] is False

    for bad in (0, 21, "x", True, 2.5):
        with pytest.raises(SetPlatformIntError):
            await set_platform_int("catering_max_restaurants", bad, db=db_session)
    with pytest.raises(SetPlatformIntError):
        await set_platform_int("not_a_key", 3, db=db_session)
