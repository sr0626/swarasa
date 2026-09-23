"""Integration tests: `GET /admin/owners` — the admin "Owners" report
(docs/API_CONTRACTS.md "GET /admin/owners").

Covers: admin-only auth, pagination, search (email + name, LIKE-wildcard
escaping), sorting, per-owner brand/location/status/verified/follower/
pending-request counts across multiple brands and statuses (including
no fan-out between the independent aggregates), zero-brand owners,
CCPA-deleted owners, and that no billing fields leak.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.models.location_reopen_request import LocationReopenRequest
from factories import (
    create_brand,
    create_claim,
    create_follow,
    create_location,
    create_owner,
)


@pytest.mark.asyncio
async def test_requires_admin(client, db_session, as_user):
    as_user("owner")
    assert (await client.get("/admin/owners")).status_code == 403
    as_user("manager")
    assert (await client.get("/admin/owners")).status_code == 403
    as_user("registered_user")
    assert (await client.get("/admin/owners")).status_code == 403


@pytest.mark.asyncio
async def test_anonymous_rejected(client, as_anonymous):
    resp = await client.get("/admin/owners")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_empty_state(client, db_session, as_user):
    as_user("admin")
    resp = await client.get("/admin/owners")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"results": [], "page": 1, "page_size": 20, "total": 0}


@pytest.mark.asyncio
async def test_counts_across_multiple_brands_and_statuses(client, db_session, as_user):
    owner = await create_owner(
        db_session, email="multi@example.com", full_name="Multi Owner", phone="+12145550100"
    )
    brand_a = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    brand_b = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    await create_brand(db_session, owner_id=owner.id, is_claimed=True)  # no locations

    await create_location(db_session, brand_id=brand_a.id, status="active", is_verified=True)
    await create_location(db_session, brand_id=brand_a.id, status="active", is_verified=False)
    await create_location(db_session, brand_id=brand_a.id, status="coming_soon", is_verified=True)
    loc_deact = await create_location(db_session, brand_id=brand_b.id, status="owner_deactivated")
    loc_closed = await create_location(
        db_session, brand_id=brand_b.id, status="closed_pending_reopen"
    )

    # Followers: 3 on brand_a, 2 on brand_b => 5 (fan-out check: the
    # multiple locations above must not multiply this).
    for _ in range(3):
        await create_follow(db_session, brand_id=brand_a.id)
    for _ in range(2):
        await create_follow(db_session, brand_id=brand_b.id)

    # One pending claim by this owner's own identity, one already
    # resolved (not counted), one by somebody else (not counted).
    await create_claim(db_session, brand_id=brand_a.id, claimant_user_id=owner.cognito_sub)
    await create_claim(
        db_session, brand_id=brand_b.id, claimant_user_id=owner.cognito_sub, status="approved"
    )
    await create_claim(db_session, brand_id=brand_b.id)

    # Pending reopen for the closed location; a rejected one for the
    # deactivated location (not counted).
    db_session.add(
        LocationReopenRequest(
            location_id=loc_closed.id, requested_by_user_id=owner.cognito_sub, status="pending_review"
        )
    )
    db_session.add(
        LocationReopenRequest(
            location_id=loc_deact.id, requested_by_user_id=owner.cognito_sub, status="rejected"
        )
    )
    await db_session.commit()

    as_user("admin")
    resp = await client.get("/admin/owners")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 1
    row = body["results"][0]

    assert row["id"] == owner.id
    assert row["email"] == "multi@example.com"
    assert row["full_name"] == "Multi Owner"
    assert row["phone"] == "+12145550100"
    assert row["joined_at"]
    assert row["personal_data_deleted"] is False
    assert row["brand_count"] == 3
    assert row["location_count"] == 5
    assert row["by_status"] == {
        "active": 2,
        "owner_deactivated": 1,
        "coming_soon": 1,
        "closed_pending_reopen": 1,
    }
    assert sum(row["by_status"].values()) == row["location_count"]
    assert row["verified_location_count"] == 2
    assert row["follower_count"] == 5
    assert row["pending_claim_count"] == 1
    assert row["pending_reopen_request_count"] == 1


@pytest.mark.asyncio
async def test_counts_are_isolated_per_owner(client, db_session, as_user):
    a = await create_owner(db_session, email="a@example.com")
    b = await create_owner(db_session, email="b@example.com")
    brand_a = await create_brand(db_session, owner_id=a.id, is_claimed=True)
    brand_b = await create_brand(db_session, owner_id=b.id, is_claimed=True)
    await create_location(db_session, brand_id=brand_a.id, status="active")
    await create_location(db_session, brand_id=brand_b.id, status="active")
    await create_location(db_session, brand_id=brand_b.id, status="active")
    await create_follow(db_session, brand_id=brand_b.id)
    await db_session.commit()

    as_user("admin")
    body = (await client.get("/admin/owners?sort=email")).json()
    by_email = {r["email"]: r for r in body["results"]}
    assert by_email["a@example.com"]["location_count"] == 1
    assert by_email["a@example.com"]["follower_count"] == 0
    assert by_email["b@example.com"]["location_count"] == 2
    assert by_email["b@example.com"]["follower_count"] == 1


@pytest.mark.asyncio
async def test_owner_with_no_brands_is_listed_with_zero_counts(client, db_session, as_user):
    await create_owner(db_session, email="fresh@example.com")
    await db_session.commit()

    as_user("admin")
    body = (await client.get("/admin/owners")).json()
    assert body["total"] == 1
    row = body["results"][0]
    assert row["brand_count"] == 0
    assert row["location_count"] == 0
    assert row["by_status"] == {
        "active": 0,
        "owner_deactivated": 0,
        "coming_soon": 0,
        "closed_pending_reopen": 0,
    }
    assert row["verified_location_count"] == 0
    assert row["follower_count"] == 0
    assert row["pending_claim_count"] == 0
    assert row["pending_reopen_request_count"] == 0


@pytest.mark.asyncio
async def test_unclaimed_brands_do_not_count_toward_any_owner(client, db_session, as_user):
    await create_owner(db_session, email="solo@example.com")
    unclaimed = await create_brand(db_session, owner_id=None, is_claimed=False)
    await create_location(db_session, brand_id=unclaimed.id, status="active")
    await create_follow(db_session, brand_id=unclaimed.id)
    await db_session.commit()

    as_user("admin")
    row = (await client.get("/admin/owners")).json()["results"][0]
    assert row["brand_count"] == 0
    assert row["location_count"] == 0
    assert row["follower_count"] == 0


@pytest.mark.asyncio
async def test_pagination(client, db_session, as_user):
    for i in range(5):
        await create_owner(db_session, email=f"owner{i}@example.com")
    await db_session.commit()

    as_user("admin")
    page1 = (await client.get("/admin/owners?page=1&page_size=2&sort=email")).json()
    assert page1["total"] == 5
    assert page1["page"] == 1
    assert page1["page_size"] == 2
    assert [r["email"] for r in page1["results"]] == ["owner0@example.com", "owner1@example.com"]

    page3 = (await client.get("/admin/owners?page=3&page_size=2&sort=email")).json()
    assert [r["email"] for r in page3["results"]] == ["owner4@example.com"]

    beyond = (await client.get("/admin/owners?page=4&page_size=2&sort=email")).json()
    assert beyond["results"] == []
    assert beyond["total"] == 5


@pytest.mark.asyncio
async def test_pagination_bounds(client, db_session, as_user):
    as_user("admin")
    assert (await client.get("/admin/owners?page_size=101")).status_code == 422
    assert (await client.get("/admin/owners?page=0")).status_code == 422
    assert (await client.get("/admin/owners?page_size=100")).status_code == 200


@pytest.mark.asyncio
async def test_search_by_email_and_name_case_insensitive(client, db_session, as_user):
    await create_owner(db_session, email="priya@example.com", full_name="Priya Sharma")
    await create_owner(db_session, email="other@example.com", full_name="Rahul Verma")
    await create_owner(db_session, email="third@example.com", full_name=None)
    await db_session.commit()

    as_user("admin")
    by_email = (await client.get("/admin/owners?q=PRIYA@")).json()
    assert [r["email"] for r in by_email["results"]] == ["priya@example.com"]
    assert by_email["total"] == 1

    by_name = (await client.get("/admin/owners?q=verma")).json()
    assert [r["email"] for r in by_name["results"]] == ["other@example.com"]

    none = (await client.get("/admin/owners?q=nobody")).json()
    assert none["results"] == []
    assert none["total"] == 0

    blank = (await client.get("/admin/owners?q=%20%20")).json()
    assert blank["total"] == 3


@pytest.mark.asyncio
async def test_search_treats_like_wildcards_literally(client, db_session, as_user):
    await create_owner(db_session, email="plain@example.com")
    await create_owner(db_session, email="has%pct@example.com")
    await db_session.commit()

    as_user("admin")
    body = (await client.get("/admin/owners?q=%25")).json()
    assert [r["email"] for r in body["results"]] == ["has%pct@example.com"]


@pytest.mark.asyncio
async def test_sort_options(client, db_session, as_user):
    now = datetime.now(timezone.utc)
    old = await create_owner(
        db_session, email="b-old@example.com", created_at=now - timedelta(days=30)
    )
    mid = await create_owner(
        db_session, email="a-mid@example.com", created_at=now - timedelta(days=10)
    )
    new = await create_owner(db_session, email="c-new@example.com", created_at=now)
    brand = await create_brand(db_session, owner_id=old.id, is_claimed=True)
    for _ in range(3):
        await create_location(db_session, brand_id=brand.id, status="active")
    brand2 = await create_brand(db_session, owner_id=mid.id, is_claimed=True)
    await create_location(db_session, brand_id=brand2.id, status="active")
    await db_session.commit()
    assert new.id

    as_user("admin")

    def emails(body: dict) -> list[str]:
        return [r["email"] for r in body["results"]]

    assert emails((await client.get("/admin/owners")).json()) == [
        "c-new@example.com",
        "a-mid@example.com",
        "b-old@example.com",
    ]
    assert emails((await client.get("/admin/owners?sort=newest")).json())[0] == "c-new@example.com"
    assert emails((await client.get("/admin/owners?sort=oldest")).json()) == [
        "b-old@example.com",
        "a-mid@example.com",
        "c-new@example.com",
    ]
    assert emails((await client.get("/admin/owners?sort=most_locations")).json()) == [
        "b-old@example.com",
        "a-mid@example.com",
        "c-new@example.com",
    ]
    assert emails((await client.get("/admin/owners?sort=email")).json()) == [
        "a-mid@example.com",
        "b-old@example.com",
        "c-new@example.com",
    ]
    assert (await client.get("/admin/owners?sort=bogus")).status_code == 422


@pytest.mark.asyncio
async def test_ccpa_deleted_owner_is_flagged_and_identity_withheld(client, db_session, as_user):
    owner = await create_owner(
        db_session,
        email="deleted-owner-1@deleted.swarasa.invalid",
        full_name=None,
        phone=None,
        personal_data_deleted_at=datetime.now(timezone.utc),
    )
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    await create_location(db_session, brand_id=brand.id, status="active")
    await db_session.commit()

    as_user("admin")
    row = (await client.get("/admin/owners")).json()["results"][0]
    assert row["personal_data_deleted"] is True
    assert row["email"] is None
    assert row["full_name"] is None
    assert row["phone"] is None
    assert row["location_count"] == 1


@pytest.mark.asyncio
async def test_no_billing_fields_in_response(client, db_session, as_user):
    await create_owner(
        db_session, stripe_customer_id="cus_secret", stripe_sub_id="sub_secret"
    )
    await db_session.commit()

    as_user("admin")
    resp = await client.get("/admin/owners")
    assert "cus_secret" not in resp.text
    assert "sub_secret" not in resp.text
    row = resp.json()["results"][0]
    assert not any("stripe" in k or "paid" in k or "billing" in k for k in row)
