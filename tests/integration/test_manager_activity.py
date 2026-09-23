"""Integration tests: `GET /auth/me/activity` for a `manager` caller —
docs/API_CONTRACTS.md "GET /auth/me/activity", broadened 2026-09-22 from
owner-only to also serve managers with their own, narrower row set (see
`app/services/audit_query_service.list_manager_activity` and its module
docstring for the full "Owner" vs. "Manager" table/action breakdown).

Focus of this suite (mirrors tests/integration/test_owner_activity.py's
structure for the owner side):

  1. A manager sees `restaurant_location`/`restaurant_brand` rows for
     their own CURRENTLY active assigned location(s) — including edits
     made by the owner on that location, not just their own.
  2. A manager never sees `location_manager` rows at all — not their own
     assignment, not another manager's assignment/removal on the SAME
     location they're assigned to.
  3. A manager never sees rows for a location they are not (or no longer,
     after revocation) actively assigned to, even under the same brand.
  4. A manager never sees another manager's assigned-location rows.
  5. A manager's set is the owner's set minus `location_manager` — same
     summary/actor-label rendering, just fewer tables in scope.

`cognito_service.find_email_by_sub` is mocked the same way
test_owner_activity.py does, for the same "never a real AWS call in a
test" reason (tests/CLAUDE.md).
"""
from __future__ import annotations

import uuid

import pytest

from app.models.audit_log import AuditLog
from app.services import audit_query_service
from factories import create_brand, create_location, create_location_manager, create_owner


def _add_audit_row(db_session, **overrides):
    defaults = dict(
        table_name="restaurant_location",
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
    monkeypatch.setattr(audit_query_service.cognito_service, "find_email_by_sub", lambda sub: None)


@pytest.mark.asyncio
async def test_manager_with_no_assignments_gets_empty_page(client, db_session, as_user):
    as_user("manager", sub=str(uuid.uuid4()))
    response = await client.get("/auth/me/activity")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["results"] == []
    assert body["total"] == 0


@pytest.mark.asyncio
async def test_manager_sees_location_and_brand_changes_on_their_assigned_location(
    client, db_session, as_user
):
    """A manager sees restaurant_location AND restaurant_brand rows for
    their assigned location's brand — brand-level content (name/
    description/website) shows on every location page under it, so it's
    still the manager's business even though they only manage the
    location, not the brand.
    """
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location.id, user_id=manager_sub, is_active=True)
    await db_session.commit()

    # Owner edits the location's hours/address -- must show up for the manager too.
    _add_audit_row(
        db_session,
        table_name="restaurant_location",
        record_id=location.id,
        action="update",
        actor_id=owner.cognito_sub,
        actor_role="owner",
        old_val={"phone": "111"},
        new_val={"phone": "222"},
    )
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

    as_user("manager", sub=manager_sub)
    response = await client.get("/auth/me/activity")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 2
    table_names = {r["table_name"] for r in body["results"]}
    assert table_names == {"restaurant_location", "restaurant_brand"}


@pytest.mark.asyncio
async def test_manager_never_sees_location_manager_rows(client, db_session, as_user):
    """No visibility into manager-assignment changes at all -- not their
    own assignment/creation row, and not another manager's assignment or
    revocation on the SAME location. That's the owner's business only
    (task brief: "no visibility into audit rows about OTHER managers
    being assigned/removed").
    """
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    manager_sub = str(uuid.uuid4())
    manager_row = await create_location_manager(
        db_session, location_id=location.id, user_id=manager_sub, is_active=True
    )
    other_manager_row = await create_location_manager(
        db_session, location_id=location.id, user_id=str(uuid.uuid4()), is_active=False
    )
    await db_session.commit()

    _add_audit_row(
        db_session,
        table_name="location_manager",
        record_id=manager_row.id,
        action="create",
        actor_id=owner.cognito_sub,
        actor_role="owner",
        old_val=None,
        new_val={"location_id": location.id, "user_id": manager_sub, "is_active": True},
    )
    _add_audit_row(
        db_session,
        table_name="location_manager",
        record_id=other_manager_row.id,
        action="update",
        actor_id=owner.cognito_sub,
        actor_role="owner",
        old_val={"is_active": True},
        new_val={"is_active": False},
    )
    await db_session.commit()

    as_user("manager", sub=manager_sub)
    response = await client.get("/auth/me/activity")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 0
    assert body["results"] == []


@pytest.mark.asyncio
async def test_manager_does_not_see_unassigned_or_revoked_locations(client, db_session, as_user):
    """A manager never sees rows for a location they aren't assigned to
    (even under the same brand as one they ARE assigned to), and stops
    seeing a location's activity once their assignment there is revoked
    (`is_active=False`) -- same "currently assigned only" posture as
    `GET /auth/me/managed-locations`.
    """
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    assigned_location = await create_location(db_session, brand_id=brand.id)
    unassigned_location = await create_location(db_session, brand_id=brand.id)
    revoked_location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    manager_sub = str(uuid.uuid4())
    await create_location_manager(
        db_session, location_id=assigned_location.id, user_id=manager_sub, is_active=True
    )
    await create_location_manager(
        db_session, location_id=revoked_location.id, user_id=manager_sub, is_active=False
    )
    await db_session.commit()

    _add_audit_row(
        db_session,
        table_name="restaurant_location",
        record_id=assigned_location.id,
        action="update",
        actor_id=owner.cognito_sub,
        actor_role="owner",
        old_val={"phone": "111"},
        new_val={"phone": "222"},
    )
    _add_audit_row(
        db_session,
        table_name="restaurant_location",
        record_id=unassigned_location.id,
        action="update",
        actor_id=owner.cognito_sub,
        actor_role="owner",
        old_val={"phone": "333"},
        new_val={"phone": "444"},
    )
    _add_audit_row(
        db_session,
        table_name="restaurant_location",
        record_id=revoked_location.id,
        action="update",
        actor_id=owner.cognito_sub,
        actor_role="owner",
        old_val={"phone": "555"},
        new_val={"phone": "666"},
    )
    await db_session.commit()

    as_user("manager", sub=manager_sub)
    response = await client.get("/auth/me/activity")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    assert body["results"][0]["table_name"] == "restaurant_location"


@pytest.mark.asyncio
async def test_manager_never_sees_another_managers_assigned_location(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location_a = await create_location(db_session, brand_id=brand.id)
    location_b = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    manager_a_sub = str(uuid.uuid4())
    manager_b_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location_a.id, user_id=manager_a_sub, is_active=True)
    await create_location_manager(db_session, location_id=location_b.id, user_id=manager_b_sub, is_active=True)
    await db_session.commit()

    _add_audit_row(
        db_session,
        table_name="restaurant_location",
        record_id=location_a.id,
        action="update",
        actor_id=owner.cognito_sub,
        actor_role="owner",
        old_val={"phone": "111"},
        new_val={"phone": "222"},
    )
    _add_audit_row(
        db_session,
        table_name="restaurant_location",
        record_id=location_b.id,
        action="update",
        actor_id=owner.cognito_sub,
        actor_role="owner",
        old_val={"phone": "333"},
        new_val={"phone": "444"},
    )
    await db_session.commit()

    as_user("manager", sub=manager_a_sub)
    response = await client.get("/auth/me/activity")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    assert body["results"][0]["summary"] == "Location phone number updated"

    from sqlalchemy import select

    all_rows = (await db_session.execute(select(AuditLog))).scalars().all()
    assert len(all_rows) == 2


@pytest.mark.asyncio
async def test_manager_activity_actor_labels_and_summaries_render_same_as_owner_feed(
    client, db_session, as_user
):
    """The manager feed reuses the exact same serialization path as the
    owner feed (`_list_activity`/`_summarize`/`_resolve_actor_label`) --
    spot-check that "You" attribution and summaries still work correctly
    for a manager caller, not just an owner one.
    """
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location.id, user_id=manager_sub, is_active=True)
    await db_session.commit()

    _add_audit_row(
        db_session,
        table_name="restaurant_location",
        record_id=location.id,
        action="update",
        actor_id=manager_sub,
        actor_role="manager",
        old_val={"hours_updated_days": []},
        new_val={"hours_updated_days": ["mon"]},
    )
    await db_session.commit()

    as_user("manager", sub=manager_sub)
    response = await client.get("/auth/me/activity")
    assert response.status_code == 200, response.text
    row = response.json()["results"][0]
    assert row["actor_label"] == "You"
    assert row["actor_resolved"] is True
    assert row["summary"] == "Hours updated"
