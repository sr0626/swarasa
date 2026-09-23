"""Integration tests: `GET /auth/me/activity` — owner-scoped read of
`audit_log`, docs/API_CONTRACTS.md "GET /auth/me/activity".

The app already writes an `audit_log` row for every write on
`restaurant_brand`/`restaurant_location`/`location_manager` (root
CLAUDE.md "ALWAYS write an audit_log entry ..."), but nothing let an
owner see it before this endpoint. Focus of this suite:

  1. Auth/role gate: owner only.
  2. The core security property: owner A must NEVER see owner B's
     audit_log rows, even though `audit_log` has no real FK and is
     scoped entirely by tracing table_name/record_id back to
     restaurant_brand.owner_id (see app/services/audit_query_service.py).
  3. A manager-caused edit on the owner's location shows up, correctly
     attributed to the manager (not silently mislabeled as the owner).
  4. The owner's own actions are labeled "You".
  5. Pagination + most-recent-first ordering.

`cognito_service.find_email_by_sub` is monkeypatched (never a real AWS
call in a test — tests/CLAUDE.md "ALWAYS mock AWS calls instead of
hitting real AWS"), same pattern as
tests/integration/test_manager_reassignment.py.
"""
from __future__ import annotations

import uuid

import pytest

from app.models.audit_log import AuditLog
from app.services import audit_query_service
from factories import create_brand, create_location, create_location_manager, create_owner


def _add_audit_row(db_session, **overrides):
    defaults = dict(
        table_name="restaurant_brand",
        record_id=1,
        action="update",
        actor_id=str(uuid.uuid4()),
        actor_role="owner",
        old_val=None,
        new_val=None,
    )
    defaults.update(overrides)
    row = AuditLog(**defaults)
    db_session.add(row)
    return row


@pytest.fixture(autouse=True)
def mock_cognito_email_lookup(monkeypatch):
    """Default: no email resolvable for any actor unless a test overrides
    this (e.g. the manager-attribution test below). Keeps every other
    test from making a real boto3 call while still exercising the
    fallback-label path.
    """
    monkeypatch.setattr(audit_query_service.cognito_service, "find_email_by_sub", lambda sub: None)


# ---------------------------------------------------------------------------
# Auth / role gate
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_activity_requires_auth(client, db_session, as_anonymous):
    response = await client.get("/auth/me/activity")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_activity_requires_owner_or_manager_role(client, db_session, as_user):
    """`GET /auth/me/activity` is owner-or-manager only (broadened
    2026-09-22 — see test_manager_activity.py for the manager's own
    feed/scoping tests). `admin`/`registered_user` still have no
    "my own entities" concept this endpoint could scope to, so they
    remain 403.
    """
    as_user("manager")
    manager_resp = await client.get("/auth/me/activity")
    assert manager_resp.status_code == 200, manager_resp.text

    as_user("admin")
    admin_resp = await client.get("/auth/me/activity")
    assert admin_resp.status_code == 403

    as_user("registered_user")
    diner_resp = await client.get("/auth/me/activity")
    assert diner_resp.status_code == 403


@pytest.mark.asyncio
async def test_owner_with_no_owner_account_yet_gets_empty_page(client, db_session, as_user):
    """An owner-group caller who has never written anything (no local
    owner_account row) gets an empty page, not an error — same posture as
    `location_manager_service.list_managed_locations` for a caller with
    no rows.
    """
    as_user("owner", sub=str(uuid.uuid4()))
    response = await client.get("/auth/me/activity")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["results"] == []
    assert body["total"] == 0


# ---------------------------------------------------------------------------
# Core security property: owner A never sees owner B's rows
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_owner_cannot_see_another_owners_audit_rows(client, db_session, as_user):
    owner_a = await create_owner(db_session)
    owner_b = await create_owner(db_session)
    brand_a = await create_brand(db_session, owner_id=owner_a.id, is_claimed=True)
    brand_b = await create_brand(db_session, owner_id=owner_b.id, is_claimed=True)
    location_a = await create_location(db_session, brand_id=brand_a.id)
    location_b = await create_location(db_session, brand_id=brand_b.id)
    await db_session.commit()

    _add_audit_row(
        db_session,
        table_name="restaurant_brand",
        record_id=brand_a.id,
        action="update",
        actor_id=owner_a.cognito_sub,
        actor_role="owner",
        old_val={"name": "Old A"},
        new_val={"name": "New A"},
    )
    _add_audit_row(
        db_session,
        table_name="restaurant_brand",
        record_id=brand_b.id,
        action="update",
        actor_id=owner_b.cognito_sub,
        actor_role="owner",
        old_val={"name": "Old B"},
        new_val={"name": "New B"},
    )
    _add_audit_row(
        db_session,
        table_name="restaurant_location",
        record_id=location_a.id,
        action="update",
        actor_id=owner_a.cognito_sub,
        actor_role="owner",
        old_val={"phone": "111"},
        new_val={"phone": "222"},
    )
    _add_audit_row(
        db_session,
        table_name="restaurant_location",
        record_id=location_b.id,
        action="update",
        actor_id=owner_b.cognito_sub,
        actor_role="owner",
        old_val={"phone": "333"},
        new_val={"phone": "444"},
    )
    await db_session.commit()

    as_user("owner", sub=owner_a.cognito_sub, email=owner_a.email)
    response = await client.get("/auth/me/activity")
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["total"] == 2
    record_ids = {(r["table_name"], r["summary"]) for r in body["results"]}
    assert (
        "restaurant_brand",
        "Restaurant name updated",
    ) in record_ids or any(r["table_name"] == "restaurant_brand" for r in body["results"])
    # Never owner B's brand/location record ids.
    seen_brand_ids = [
        r for r in body["results"] if r["table_name"] == "restaurant_brand"
    ]
    seen_location_ids = [
        r for r in body["results"] if r["table_name"] == "restaurant_location"
    ]
    assert len(seen_brand_ids) == 1
    assert len(seen_location_ids) == 1

    # Cross-check directly against the DB that owner B's rows exist (proving
    # the filter is doing real work, not just an empty table coincidence).
    from sqlalchemy import select

    all_rows = (await db_session.execute(select(AuditLog))).scalars().all()
    assert len(all_rows) == 4


@pytest.mark.asyncio
async def test_owner_sees_own_location_manager_rows_not_unrelated_ones(client, db_session, as_user):
    owner_a = await create_owner(db_session)
    owner_b = await create_owner(db_session)
    brand_a = await create_brand(db_session, owner_id=owner_a.id, is_claimed=True)
    brand_b = await create_brand(db_session, owner_id=owner_b.id, is_claimed=True)
    location_a = await create_location(db_session, brand_id=brand_a.id)
    location_b = await create_location(db_session, brand_id=brand_b.id)
    await db_session.commit()

    manager_a = await create_location_manager(db_session, location_id=location_a.id)
    manager_b = await create_location_manager(db_session, location_id=location_b.id)
    await db_session.commit()

    _add_audit_row(
        db_session,
        table_name="location_manager",
        record_id=manager_a.id,
        action="create",
        actor_id=owner_a.cognito_sub,
        actor_role="owner",
        old_val=None,
        new_val={"location_id": location_a.id, "user_id": manager_a.user_id, "is_active": True},
    )
    _add_audit_row(
        db_session,
        table_name="location_manager",
        record_id=manager_b.id,
        action="create",
        actor_id=owner_b.cognito_sub,
        actor_role="owner",
        old_val=None,
        new_val={"location_id": location_b.id, "user_id": manager_b.user_id, "is_active": True},
    )
    await db_session.commit()

    as_user("owner", sub=owner_a.cognito_sub, email=owner_a.email)
    response = await client.get("/auth/me/activity")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    assert body["results"][0]["table_name"] == "location_manager"
    assert body["results"][0]["summary"] == "Manager assigned"


# ---------------------------------------------------------------------------
# Actor attribution
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_owners_own_action_is_labeled_you(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    await db_session.commit()

    _add_audit_row(
        db_session,
        table_name="restaurant_brand",
        record_id=brand.id,
        action="update",
        actor_id=owner.cognito_sub,
        actor_role="owner",
        old_val={"name": "Old"},
        new_val={"name": "New"},
    )
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.get("/auth/me/activity")
    assert response.status_code == 200, response.text
    row = response.json()["results"][0]
    assert row["actor_label"] == "You"
    assert row["actor_resolved"] is True
    assert row["actor_role"] == "owner"


@pytest.mark.asyncio
async def test_manager_caused_edit_is_attributed_to_the_manager(client, db_session, as_user, monkeypatch):
    """A manager-made edit on the owner's location must show up in the
    owner's activity feed, correctly attributed to the manager (email
    resolved via the mocked Cognito lookup) — not silently mislabeled as
    the owner and not dropped.
    """
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    manager_sub = str(uuid.uuid4())
    manager_email = "manager@example.com"
    monkeypatch.setattr(
        audit_query_service.cognito_service,
        "find_email_by_sub",
        lambda sub: manager_email if sub == manager_sub else None,
    )

    _add_audit_row(
        db_session,
        table_name="restaurant_location",
        record_id=location.id,
        action="update",
        actor_id=manager_sub,
        actor_role="manager",
        old_val={"phone": "111"},
        new_val={"phone": "222"},
    )
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.get("/auth/me/activity")
    assert response.status_code == 200, response.text
    row = response.json()["results"][0]
    assert row["actor_role"] == "manager"
    assert row["actor_label"] == manager_email
    assert row["actor_resolved"] is True
    assert row["summary"] == "Location phone number updated"


@pytest.mark.asyncio
async def test_unresolvable_actor_falls_back_to_role_and_truncated_id(client, db_session, as_user):
    """When the Cognito lookup can't resolve an email (mocked to return
    None by the autouse fixture), the row must still show up with an
    honest fallback label rather than a blank/misleading one.
    """
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    await db_session.commit()

    admin_sub = str(uuid.uuid4())
    _add_audit_row(
        db_session,
        table_name="restaurant_brand",
        record_id=brand.id,
        action="update",
        actor_id=admin_sub,
        actor_role="admin",
        old_val={"name": "Old"},
        new_val={"name": "New"},
    )
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.get("/auth/me/activity")
    assert response.status_code == 200, response.text
    row = response.json()["results"][0]
    assert row["actor_resolved"] is False
    assert "platform admin" in row["actor_label"]
    assert admin_sub[:8] in row["actor_label"]


# ---------------------------------------------------------------------------
# Ordering, pagination, and create/delete summaries
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_results_are_ordered_most_recent_first_and_paginated(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    await db_session.commit()

    for i in range(3):
        _add_audit_row(
            db_session,
            table_name="restaurant_brand",
            record_id=brand.id,
            action="update",
            actor_id=owner.cognito_sub,
            actor_role="owner",
            old_val={"name": f"v{i}"},
            new_val={"name": f"v{i + 1}"},
        )
        await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    page1 = await client.get("/auth/me/activity", params={"page": 1, "page_size": 2})
    assert page1.status_code == 200, page1.text
    body1 = page1.json()
    assert body1["total"] == 3
    assert len(body1["results"]) == 2
    assert body1["results"][0]["summary"] == "Restaurant name updated"
    # Most recent (last inserted, v2 -> v3) first.
    assert body1["results"][0]["id"] > body1["results"][1]["id"]

    page2 = await client.get("/auth/me/activity", params={"page": 2, "page_size": 2})
    assert page2.status_code == 200, page2.text
    body2 = page2.json()
    assert len(body2["results"]) == 1
    assert body2["results"][0]["id"] < body1["results"][-1]["id"]


@pytest.mark.asyncio
async def test_create_and_delete_actions_get_simple_summaries(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    await db_session.commit()

    _add_audit_row(
        db_session,
        table_name="restaurant_brand",
        record_id=brand.id,
        action="create",
        actor_id=owner.cognito_sub,
        actor_role="owner",
        old_val=None,
        new_val={"name": brand.name},
    )
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.get("/auth/me/activity")
    assert response.status_code == 200, response.text
    row = response.json()["results"][0]
    assert row["summary"] == "Restaurant added"
    assert row["action"] == "create"
