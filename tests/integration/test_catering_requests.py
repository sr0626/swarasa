"""Integration test: catering quote requests, REQUESTER side — config,
eligible-restaurant list, submit (role + eligibility + max + dup + rate limit),
my requests, cancel, lazy expiry. docs/API_CONTRACTS.md "Catering quote requests"."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.models.audit_log import AuditLog
from app.models.catering import CateringRequest, CateringRequestRecipient
from app.models.platform_config import PlatformConfig
from factories import (
    create_brand,
    create_catering_location,
    create_catering_request,
    create_location,
    create_owner,
)


def _payload(location_ids=None, **overrides):
    body = {
        "event_date": (datetime.now(timezone.utc) + timedelta(days=12)).date().isoformat(),
        "headcount": 50,
        "delivery_or_pickup": "delivery",
        "delivery_city": "Irving",
        "delivery_zip": "75038",
        "notes": "Mostly vegetarian",
        "items": [
            {"item_name": "Chicken biryani", "size": "full_tray", "quantity": 2},
            {"item_name": "Paneer tikka", "size": "medium_tray", "quantity": 1, "note": "mild"},
            {"item_name": "Naan", "size": "flat_tray", "quantity": 3},
        ],
        "location_ids": location_ids or [],
    }
    body.update(overrides)
    return body


async def _count_requests(db_session) -> int:
    return (await db_session.execute(select(func.count()).select_from(CateringRequest))).scalar_one()


# ---------------------------------------------------------------------------
# config + eligible list
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_config_defaults_to_five_and_follows_platform_config(client, db_session, as_user):
    as_user("registered_user")
    assert (await client.get("/catering/config")).json()["max_restaurants"] == 5

    db_session.add(PlatformConfig(key="catering_max_restaurants", value="8"))
    await db_session.commit()
    assert (await client.get("/catering/config")).json()["max_restaurants"] == 8


@pytest.mark.asyncio
async def test_config_is_clamped_and_survives_garbage(client, db_session, as_user):
    as_user("registered_user")
    db_session.add(PlatformConfig(key="catering_max_restaurants", value="9999"))
    await db_session.commit()
    assert (await client.get("/catering/config")).json()["max_restaurants"] == 20

    row = await db_session.get(PlatformConfig, "catering_max_restaurants")
    row.value = "0"
    await db_session.commit()
    assert (await client.get("/catering/config")).json()["max_restaurants"] == 1

    row.value = "lots"
    await db_session.commit()
    assert (await client.get("/catering/config")).json()["max_restaurants"] == 5


@pytest.mark.asyncio
async def test_catering_endpoints_require_registered_user(client, db_session, as_user, as_anonymous):
    for path in ("/catering/config", "/catering/restaurants", "/catering/requests"):
        assert (await client.get(path)).status_code == 401
    for role in ("owner", "manager", "admin"):
        as_user(role)
        for path in ("/catering/config", "/catering/restaurants", "/catering/requests"):
            assert (await client.get(path)).status_code == 403, (role, path)


@pytest.mark.asyncio
async def test_eligible_list_only_subscribed_opted_in_public_locations(client, db_session, as_user):
    future = datetime.now(timezone.utc) + timedelta(days=30)
    past = datetime.now(timezone.utc) - timedelta(days=1)
    good = await create_catering_location(db_session)
    good_dated = await create_catering_location(db_session, paid_until=future)
    await create_catering_location(db_session, is_paid=False)  # free tier
    await create_catering_location(db_session, paid_until=past)  # lapsed
    await create_catering_location(db_session, accepts_catering=False)  # not opted in
    await create_catering_location(db_session, status="owner_deactivated")  # hidden
    await create_catering_location(db_session, status="coming_soon")
    deleted_brand_owner = await create_owner(db_session)
    deleted_brand = await create_brand(
        db_session,
        owner_id=deleted_brand_owner.id,
        deleted_at=datetime.now(timezone.utc),
    )
    await create_location(
        db_session,
        brand_id=deleted_brand.id,
        is_paid=True,
        accepts_catering=True,
    )
    await db_session.commit()
    as_user("registered_user")

    resp = await client.get("/catering/restaurants")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert {r["location_id"] for r in body["results"]} == {good.id, good_dated.id}
    assert body["total"] == 2
    assert body["max_restaurants"] == 5
    # No sensitive data: only name/city/state/slugs.
    assert set(body["results"][0]) == {
        "location_id",
        "restaurant_name",
        "city",
        "state",
        "brand_slug",
        "location_slug",
    }


@pytest.mark.asyncio
async def test_eligible_list_filters_by_city_and_name_and_paginates(client, db_session, as_user):
    from app.models.restaurant_brand import RestaurantBrand

    a = await create_catering_location(db_session, city="Irving")
    b = await create_catering_location(db_session, city="Plano")
    c = await create_catering_location(db_session, city="Irving")
    brand_b = await db_session.get(RestaurantBrand, b.brand_id)
    brand_b.name = "Zesty Zaika Kitchen"
    await db_session.commit()
    as_user("registered_user")

    irving = await client.get("/catering/restaurants", params={"city": "irving"})
    assert {r["location_id"] for r in irving.json()["results"]} == {a.id, c.id}

    by_name = await client.get("/catering/restaurants", params={"q": "zaika"})
    assert [r["location_id"] for r in by_name.json()["results"]] == [b.id]

    # `%` / `_` are literals, not wildcards.
    assert (await client.get("/catering/restaurants", params={"q": "%"})).json()["total"] == 0

    page = await client.get("/catering/restaurants", params={"page_size": 1, "page": 2})
    assert len(page.json()["results"]) == 1
    assert page.json()["total"] == 3


@pytest.mark.asyncio
async def test_eligibility_endpoint(client, db_session, as_user):
    ok = await create_catering_location(db_session)
    no = await create_catering_location(db_session, is_paid=False)
    await db_session.commit()
    # Public: no sign-in needed, and it returns only the boolean.
    yes = (await client.get(f"/catering/eligibility/{ok.id}")).json()
    assert yes["eligible"] is True
    assert yes["restaurant"]["location_id"] == ok.id
    assert set(yes["restaurant"]) == {
        "location_id",
        "restaurant_name",
        "city",
        "state",
        "brand_slug",
        "location_slug",
    }
    for lid in (no.id, 999999):
        assert (await client.get(f"/catering/eligibility/{lid}")).json() == {
            "location_id": lid,
            "eligible": False,
            "restaurant": None,
        }


# ---------------------------------------------------------------------------
# submit
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_registered_user_can_submit_and_sees_it_in_my_requests(client, db_session, as_user):
    l1 = await create_catering_location(db_session)
    l2 = await create_catering_location(db_session)
    await db_session.commit()
    user = as_user("registered_user", email="diner@example.com")

    resp = await client.post("/catering/requests", json=_payload([l1.id, l2.id]))
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "open"
    assert body["headcount"] == 50
    assert [i["size"] for i in body["items"]] == ["full_tray", "medium_tray", "flat_tray"]
    assert {r["location_id"] for r in body["recipients"]} == {l1.id, l2.id}
    assert all(r["status"] == "pending" for r in body["recipients"])
    # Requester's own view carries no restaurant-only data.
    assert "requester_email" not in body

    row = (await db_session.execute(select(CateringRequest))).scalar_one()
    assert row.requester_user_sub == user.cognito_sub
    assert row.requester_email == "diner@example.com"
    audit = (
        await db_session.execute(select(AuditLog).where(AuditLog.table_name == "catering_request"))
    ).scalar_one()
    assert audit.action == "create"
    assert audit.actor_id == user.cognito_sub

    mine = await client.get("/catering/requests")
    assert mine.json()["total"] == 1
    assert mine.json()["results"][0]["id"] == body["id"]
    one = await client.get(f"/catering/requests/{body['id']}")
    assert one.status_code == 200


@pytest.mark.asyncio
async def test_owner_manager_admin_cannot_submit(client, db_session, as_user):
    loc = await create_catering_location(db_session)
    await db_session.commit()
    for role in ("owner", "manager", "admin"):
        as_user(role)
        resp = await client.post("/catering/requests", json=_payload([loc.id]))
        assert resp.status_code == 403, role
        assert resp.json()["code"] == "forbidden"
    assert await _count_requests(db_session) == 0


@pytest.mark.asyncio
async def test_anonymous_cannot_submit(client, db_session, as_anonymous):
    loc = await create_catering_location(db_session)
    await db_session.commit()
    assert (await client.post("/catering/requests", json=_payload([loc.id]))).status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides",
    [
        {"is_paid": False},
        {"paid_until": datetime.now(timezone.utc) - timedelta(days=1)},
        {"accepts_catering": False},
        {"status": "owner_deactivated"},
        {"status": "coming_soon"},
    ],
)
async def test_ineligible_location_rejects_whole_request_generically(
    client, db_session, as_user, overrides
):
    good = await create_catering_location(db_session)
    bad = await create_catering_location(db_session, **overrides)
    await db_session.commit()
    as_user("registered_user")

    resp = await client.post("/catering/requests", json=_payload([good.id, bad.id]))
    assert resp.status_code == 422
    assert resp.json() == {
        "detail": "One or more restaurants are not available",
        "code": "restaurants_unavailable",
    }
    assert await _count_requests(db_session) == 0


@pytest.mark.asyncio
async def test_deleted_brand_and_unknown_location_rejected_identically(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, deleted_at=datetime.now(timezone.utc))
    deleted = await create_location(db_session, brand_id=brand.id, is_paid=True, accepts_catering=True)
    await db_session.commit()
    as_user("registered_user")
    r1 = await client.post("/catering/requests", json=_payload([deleted.id]))
    r2 = await client.post("/catering/requests", json=_payload([999_999]))
    assert r1.status_code == r2.status_code == 422
    assert r1.json() == r2.json()


@pytest.mark.asyncio
async def test_future_paid_until_is_accepted(client, db_session, as_user):
    loc = await create_catering_location(
        db_session, paid_until=datetime.now(timezone.utc) + timedelta(days=10)
    )
    await db_session.commit()
    as_user("registered_user")
    assert (await client.post("/catering/requests", json=_payload([loc.id]))).status_code == 201


@pytest.mark.asyncio
async def test_max_restaurants_default_and_config_change(client, db_session, as_user):
    locs = [await create_catering_location(db_session) for _ in range(7)]
    await db_session.commit()
    ids = [loc.id for loc in locs]
    as_user("registered_user")

    too_many = await client.post("/catering/requests", json=_payload(ids[:6]))
    assert too_many.status_code == 422
    assert too_many.json()["code"] == "too_many_restaurants"
    assert await _count_requests(db_session) == 0

    assert (await client.post("/catering/requests", json=_payload(ids[:5]))).status_code == 201

    # Raise the cap through platform_config: 6 is now fine.
    db_session.add(PlatformConfig(key="catering_max_restaurants", value="6"))
    await db_session.commit()
    assert (await client.post("/catering/requests", json=_payload(ids[:6]))).status_code == 201
    # ...and lowering it applies immediately.
    row = await db_session.get(PlatformConfig, "catering_max_restaurants")
    row.value = "2"
    await db_session.commit()
    assert (await client.post("/catering/requests", json=_payload(ids[:3]))).status_code == 422
    assert (await client.post("/catering/requests", json=_payload(ids[:2]))).status_code == 201


@pytest.mark.asyncio
async def test_hard_cap_of_twenty_even_if_config_is_huge(client, db_session, as_user):
    db_session.add(PlatformConfig(key="catering_max_restaurants", value="500"))
    await db_session.commit()
    as_user("registered_user")
    resp = await client.post("/catering/requests", json=_payload(list(range(1, 22))))
    assert resp.status_code == 422  # schema cap (20) — never reaches the fan-out


@pytest.mark.asyncio
async def test_duplicate_locations_rejected(client, db_session, as_user):
    loc = await create_catering_location(db_session)
    await db_session.commit()
    as_user("registered_user")
    resp = await client.post("/catering/requests", json=_payload([loc.id, loc.id]))
    assert resp.status_code == 422
    assert resp.json()["code"] == "duplicate_restaurants"
    assert await _count_requests(db_session) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides",
    [
        {"items": []},
        {"items": [{"item_name": "x", "size": "huge_tray", "quantity": 1}]},
        {"items": [{"item_name": "x", "size": "full_tray", "quantity": 0}]},
        {"items": [{"item_name": "x", "size": "full_tray", "quantity": 101}]},
        {"items": [{"item_name": "  ", "size": "full_tray", "quantity": 1}]},
        {"items": [{"item_name": "y" * 121, "size": "full_tray", "quantity": 1}]},
        {"items": [{"item_name": "x", "size": "full_tray", "quantity": 1}] * 31},
        {"headcount": 0},
        {"headcount": 5001},
        {"notes": "n" * 2001},
        {"delivery_or_pickup": "drone"},
        {"location_ids": []},
        {"event_date": "2001-01-01"},
    ],
)
async def test_validation_errors(client, db_session, as_user, overrides):
    loc = await create_catering_location(db_session)
    await db_session.commit()
    as_user("registered_user")
    resp = await client.post(
        "/catering/requests", json=_payload(**{"location_ids": [loc.id], **overrides})
    )
    assert resp.status_code == 422, resp.text
    assert await _count_requests(db_session) == 0


@pytest.mark.asyncio
async def test_thirty_items_is_allowed(client, db_session, as_user):
    loc = await create_catering_location(db_session)
    await db_session.commit()
    as_user("registered_user")
    items = [{"item_name": f"Dish {i}", "size": "other", "quantity": 1} for i in range(30)]
    assert (
        await client.post("/catering/requests", json=_payload([loc.id], items=items))
    ).status_code == 201


@pytest.mark.asyncio
async def test_rate_limit_five_per_day(client, db_session, as_user):
    loc = await create_catering_location(db_session)
    await db_session.commit()
    as_user("registered_user")
    for _ in range(5):
        assert (await client.post("/catering/requests", json=_payload([loc.id]))).status_code == 201
    resp = await client.post("/catering/requests", json=_payload([loc.id]))
    assert resp.status_code == 429
    assert resp.json()["code"] == "rate_limited"
    assert await _count_requests(db_session) == 5


@pytest.mark.asyncio
async def test_rate_limit_is_per_user_and_rolls_off(client, db_session, as_user):
    loc = await create_catering_location(db_session)
    sub = str(uuid.uuid4())
    old = datetime.now(timezone.utc) - timedelta(days=2)
    for _ in range(5):
        await create_catering_request(
            db_session, location_ids=[loc.id], requester_sub=sub, created_at=old
        )
    await db_session.commit()
    as_user("registered_user", sub=sub)
    assert (await client.post("/catering/requests", json=_payload([loc.id]))).status_code == 201


@pytest.mark.asyncio
async def test_submit_without_email_is_rejected(client, db_session, as_user):
    loc = await create_catering_location(db_session)
    await db_session.commit()
    user = as_user("registered_user")
    user.email = None
    resp = await client.post("/catering/requests", json=_payload([loc.id]))
    assert resp.status_code == 400
    assert resp.json()["code"] == "email_required"


# ---------------------------------------------------------------------------
# read / cancel / expiry
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_requester_only_sees_and_cancels_own_requests(client, db_session, as_user):
    loc = await create_catering_location(db_session)
    mine_sub, other_sub = str(uuid.uuid4()), str(uuid.uuid4())
    mine = await create_catering_request(db_session, location_ids=[loc.id], requester_sub=mine_sub)
    theirs = await create_catering_request(db_session, location_ids=[loc.id], requester_sub=other_sub)
    await db_session.commit()
    as_user("registered_user", sub=mine_sub)

    listing = await client.get("/catering/requests")
    assert [r["id"] for r in listing.json()["results"]] == [mine.id]
    assert (await client.get(f"/catering/requests/{theirs.id}")).status_code == 404
    assert (await client.post(f"/catering/requests/{theirs.id}/cancel")).status_code == 404
    await db_session.refresh(theirs)
    assert theirs.status == "open"


@pytest.mark.asyncio
async def test_cancel_marks_cancelled_audits_and_is_idempotent(client, db_session, as_user):
    loc = await create_catering_location(db_session)
    sub = str(uuid.uuid4())
    req = await create_catering_request(db_session, location_ids=[loc.id], requester_sub=sub)
    await db_session.commit()
    as_user("registered_user", sub=sub)

    resp = await client.post(f"/catering/requests/{req.id}/cancel")
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "cancelled"
    assert resp.json()["recipients"][0]["status"] == "expired"
    assert (await client.post(f"/catering/requests/{req.id}/cancel")).status_code == 200
    audits = (
        await db_session.execute(
            select(AuditLog).where(AuditLog.table_name == "catering_request", AuditLog.action == "update")
        )
    ).scalars().all()
    assert len(audits) == 1


@pytest.mark.asyncio
async def test_open_requests_expire_lazily_on_read(client, db_session, as_user):
    loc = await create_catering_location(db_session)
    sub = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    stale = await create_catering_request(
        db_session,
        location_ids=[loc.id],
        requester_sub=sub,
        created_at=now - timedelta(days=15),
        expires_at=now - timedelta(days=1),
    )
    quoted_req = await create_catering_request(
        db_session,
        location_ids=[loc.id],
        requester_sub=sub,
        created_at=now - timedelta(days=15),
        expires_at=now - timedelta(days=1),
    )
    quoted_req.recipients[0].status = "quoted"
    quoted_req.recipients[0].quote_amount_cents = 45000
    await db_session.commit()
    # The test shares one session with the app (production has one per
    # request), so drop cached rows to see the lazy-expiry bulk UPDATE.
    db_session.expire_all()
    as_user("registered_user", sub=sub)

    resp = await client.get("/catering/requests")
    by_id = {r["id"]: r for r in resp.json()["results"]}
    assert by_id[stale.id]["status"] == "closed"
    assert by_id[stale.id]["recipients"][0]["status"] == "expired"
    # A quote that arrived before expiry keeps its outcome.
    assert by_id[quoted_req.id]["recipients"][0]["status"] == "quoted"
    assert by_id[quoted_req.id]["recipients"][0]["quote_amount_cents"] == 45000

    # Cancelling an already-expired request is refused.
    assert (await client.post(f"/catering/requests/{stale.id}/cancel")).status_code == 409


@pytest.mark.asyncio
async def test_recipient_unique_per_request_location(db_session):
    loc = await create_catering_location(db_session)
    req = await create_catering_request(db_session, location_ids=[loc.id])
    from sqlalchemy.exc import IntegrityError

    db_session.add(CateringRequestRecipient(request_id=req.id, location_id=loc.id))
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()
