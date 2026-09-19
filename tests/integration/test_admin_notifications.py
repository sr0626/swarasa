"""Integration test: GET /admin/notifications (admin-only bell aggregate).

docs/API_CONTRACTS.md "Admin notifications". Same harness as
test_listing_report.py / test_claim_flow.py (real app + SQLite).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from factories import create_brand, create_claim, create_listing_report, create_owner


@pytest.mark.asyncio
async def test_requires_admin(client, db_session, as_user):
    as_user("owner")
    assert (await client.get("/admin/notifications")).status_code == 403
    as_user("registered_user")
    assert (await client.get("/admin/notifications")).status_code == 403


@pytest.mark.asyncio
async def test_anonymous_rejected(client, as_anonymous):
    resp = await client.get("/admin/notifications")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_empty_state(client, db_session, as_user):
    as_user("admin")
    resp = await client.get("/admin/notifications")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 0
    for key in ("claims", "reports", "new_users"):
        assert body[key] == {"count": 0, "items": []}
    assert body["new_users_window_days"] == 7


@pytest.mark.asyncio
async def test_claims_only_pending_oldest_first_capped(client, db_session, as_user):
    now = datetime.now(timezone.utc)
    brands = [await create_brand(db_session, name=f"Brand {i}") for i in range(7)]
    for i, brand in enumerate(brands):
        await create_claim(
            db_session, brand_id=brand.id, submitted_at=now - timedelta(hours=10 - i)
        )
    resolved_brand = await create_brand(db_session, name="Resolved Brand")
    await create_claim(db_session, brand_id=resolved_brand.id, status="approved")
    await db_session.commit()

    as_user("admin")
    body = (await client.get("/admin/notifications")).json()

    assert body["claims"]["count"] == 7  # approved claim not counted
    items = body["claims"]["items"]
    assert len(items) == 5  # capped
    assert [i["brand_name"] for i in items] == [f"Brand {n}" for n in range(5)]  # oldest first
    assert set(items[0]) == {"claim_id", "brand_id", "brand_name", "submitted_at"}


@pytest.mark.asyncio
async def test_reports_only_new_counted(client, db_session, as_user):
    brand = await create_brand(db_session, name="Spice Route")
    await create_listing_report(db_session, brand_id=brand.id, category="hours_incorrect")
    await create_listing_report(db_session, brand_id=brand.id, status="resolved")
    await create_listing_report(db_session, brand_id=brand.id, status="dismissed")
    await db_session.commit()

    as_user("admin")
    body = (await client.get("/admin/notifications")).json()

    assert body["reports"]["count"] == 1
    item = body["reports"]["items"][0]
    assert item["brand_name"] == "Spice Route"
    assert item["category"] == "hours_incorrect"
    assert item["brand_id"] == brand.id


@pytest.mark.asyncio
async def test_new_users_window_newest_first_and_excludes_redacted(client, db_session, as_user):
    now = datetime.now(timezone.utc)
    await create_owner(db_session, email="old@example.com", created_at=now - timedelta(days=30))
    await create_owner(
        db_session, email="recent1@example.com", full_name="Recent One", created_at=now - timedelta(days=2)
    )
    await create_owner(
        db_session, email="recent2@example.com", full_name=None, created_at=now - timedelta(hours=1)
    )
    await create_owner(
        db_session,
        email="redacted@example.com",
        created_at=now - timedelta(days=1),
        personal_data_deleted_at=now,
    )
    await db_session.commit()

    as_user("admin")
    body = (await client.get("/admin/notifications")).json()

    assert body["new_users"]["count"] == 2
    items = body["new_users"]["items"]
    assert [i["display"] for i in items] == ["recent2@example.com", "Recent One"]
    assert items[1]["email"] == "recent1@example.com"
    assert all(i["role"] == "owner" for i in items)
    # New sign-ups are informational — not part of the badge total.
    assert body["total"] == 0


@pytest.mark.asyncio
async def test_total_is_claims_plus_reports(client, db_session, as_user):
    brand = await create_brand(db_session)
    await create_claim(db_session, brand_id=brand.id)
    await create_listing_report(db_session, brand_id=brand.id)
    await create_listing_report(db_session, brand_id=brand.id)
    await db_session.commit()

    as_user("admin")
    body = (await client.get("/admin/notifications")).json()
    assert body["total"] == 3
