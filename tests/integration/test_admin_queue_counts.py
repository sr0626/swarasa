"""Integration test: GET /admin/queue-counts (admin-only Work queue badge counts).

docs/API_CONTRACTS.md "Admin queue counts". Same harness as
test_admin_notifications.py (real app + SQLite).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.admin_message import AdminMessage
from app.models.location_reopen_request import LocationReopenRequest
from app.services.claim_service import _SLA_BUSINESS_DAYS, _add_business_days
from factories import create_brand, create_claim, create_listing_report, create_location


def _message(db, *, status: str) -> None:
    db.add(
        AdminMessage(
            sender_cognito_sub=str(uuid.uuid4()),
            sender_role="owner",
            sender_email=f"{uuid.uuid4().hex[:8]}@example.com",
            subject="Subject",
            body="A message body long enough.",
            status=status,
        )
    )


async def _reopen(db, *, status: str) -> None:
    brand = await create_brand(db)
    location = await create_location(db, brand_id=brand.id)
    db.add(
        LocationReopenRequest(
            location_id=location.id, requested_by_user_id=str(uuid.uuid4()), status=status
        )
    )


@pytest.mark.asyncio
async def test_requires_admin(client, db_session, as_user):
    for role in ("owner", "manager", "registered_user"):
        as_user(role)
        assert (await client.get("/admin/queue-counts")).status_code == 403


@pytest.mark.asyncio
async def test_anonymous_rejected(client, as_anonymous):
    assert (await client.get("/admin/queue-counts")).status_code in (401, 403)


@pytest.mark.asyncio
async def test_empty_state(client, db_session, as_user):
    as_user("admin")
    resp = await client.get("/admin/queue-counts")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "claims": {"pending": 0, "overdue": 0},
        "messages": {"open": 0},
        "reports": {"new": 0},
        "reopen_requests": {"pending": 0},
        "total": 0,
    }


@pytest.mark.asyncio
async def test_counts_only_items_needing_a_decision(client, db_session, as_user):
    # Claims: 2 pending, plus approved + rejected (not counted).
    for status in ("pending_review", "pending_review", "approved", "rejected"):
        brand = await create_brand(db_session)
        await create_claim(db_session, brand_id=brand.id, status=status)
    # Messages: 3 open, 2 resolved.
    for status in ("open", "open", "open", "resolved", "resolved"):
        _message(db_session, status=status)
    # Reports: 1 new, plus triaged states (not counted).
    brand = await create_brand(db_session)
    for status in ("new", "dismissed", "actioned"):
        await create_listing_report(db_session, brand_id=brand.id, status=status)
    # Reopen requests: 2 pending, 1 approved, 1 rejected.
    for status in ("pending_review", "pending_review", "approved", "rejected"):
        await _reopen(db_session, status=status)
    await db_session.commit()

    as_user("admin")
    body = (await client.get("/admin/queue-counts")).json()

    assert body["claims"]["pending"] == 2
    assert body["messages"] == {"open": 3}
    assert body["reports"] == {"new": 1}
    assert body["reopen_requests"] == {"pending": 2}
    assert body["total"] == 2 + 3 + 1 + 2


@pytest.mark.asyncio
async def test_overdue_counts_only_pending_claims_past_sla(client, db_session, as_user):
    now = datetime.now(timezone.utc)
    # More than 4 calendar days old is past any 2-business-day SLA (overdue);
    # under 2 days old never is. A resolved claim of the same age counts as
    # neither pending nor overdue.
    cases = [
        ("pending_review", now - timedelta(days=10)),
        ("pending_review", now - timedelta(days=5)),
        ("pending_review", now - timedelta(hours=3)),
        ("pending_review", now - timedelta(days=1)),
        ("approved", now - timedelta(days=10)),
    ]
    for status, submitted_at in cases:
        brand = await create_brand(db_session)
        await create_claim(db_session, brand_id=brand.id, status=status, submitted_at=submitted_at)
    await db_session.commit()

    as_user("admin")
    body = (await client.get("/admin/queue-counts")).json()

    assert body["claims"] == {"pending": 4, "overdue": 2}
    # `overdue` is a subset of pending and is not added to the total again.
    assert body["total"] == 4


@pytest.mark.asyncio
async def test_overdue_boundary_band_uses_business_day_sla(client, db_session, as_user):
    """Claims 2-4 calendar days old: overdue only if `submitted_at` + 2 business
    days has passed -- the same rule that produces the claims page's `sla_due_at`."""
    now = datetime.now(timezone.utc)
    expected_overdue = 0
    for submitted_at in (
        now - timedelta(days=2, hours=1),
        now - timedelta(days=3, hours=1),
        now - timedelta(days=3, hours=23),
    ):
        if _add_business_days(submitted_at, _SLA_BUSINESS_DAYS) < now:
            expected_overdue += 1
        brand = await create_brand(db_session)
        await create_claim(db_session, brand_id=brand.id, submitted_at=submitted_at)
    await db_session.commit()

    as_user("admin")
    body = (await client.get("/admin/queue-counts")).json()

    assert body["claims"]["pending"] == 3
    assert body["claims"]["overdue"] == expected_overdue
