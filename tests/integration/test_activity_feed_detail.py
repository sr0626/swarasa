"""Integration tests: the detailed activity feed — `GET /auth/me/activity`
rows now carry where (restaurant/location/timezone), who (email + role) and
what changed (friendly old -> new per field). docs/API_CONTRACTS.md
"GET /auth/me/activity". Role scoping is covered by test_owner_activity.py /
test_manager_activity.py and is unchanged; the last test here re-asserts the
manager boundary against the new payload.

Cognito lookups are monkeypatched (never a real AWS call).
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import event

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
def mock_cognito(monkeypatch):
    monkeypatch.setattr(audit_query_service.cognito_service, "find_email_by_sub", lambda sub: None)


async def _owner_with_location(db_session, **location_overrides):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Spice Route")
    location = await create_location(
        db_session,
        brand_id=brand.id,
        location_name="Plano",
        timezone="America/Chicago",
        **location_overrides,
    )
    await db_session.commit()
    return owner, brand, location


@pytest.mark.asyncio
async def test_status_change_row_has_where_who_and_friendly_diff(client, db_session, as_user):
    owner, brand, location = await _owner_with_location(db_session)
    _add_audit_row(
        db_session,
        record_id=location.id,
        actor_id=owner.cognito_sub,
        actor_role="owner",
        old_val={"status": "active"},
        new_val={"status": "owner_deactivated"},
    )
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.get("/auth/me/activity")
    assert response.status_code == 200, response.text
    row = response.json()["results"][0]

    assert row["restaurant_name"] == "Spice Route"
    assert row["location_name"] == "Plano"
    assert row["location_id"] == location.id and row["brand_id"] == brand.id
    assert row["timezone"] == "America/Chicago"
    assert row["actor_label"] == "You"
    assert row["actor_email"] == owner.email
    assert row["actor_role_label"] == "Owner"
    assert row["summary"] == "Location status updated"  # unchanged field
    assert row["changes"] == [
        {"field": "status", "label": "Status", "old": "Live", "new": "Hidden"}
    ]


@pytest.mark.asyncio
async def test_manager_actor_email_and_role_are_resolved(client, db_session, as_user, monkeypatch):
    owner, _, location = await _owner_with_location(db_session)
    manager_sub = str(uuid.uuid4())
    monkeypatch.setattr(
        audit_query_service.cognito_service,
        "find_email_by_sub",
        lambda sub: "mgr@example.com" if sub == manager_sub else None,
    )
    _add_audit_row(
        db_session,
        record_id=location.id,
        actor_id=manager_sub,
        actor_role="manager",
        old_val={"phone": "+19725550142"},
        new_val={"phone": "+19725550199"},
    )
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    row = (await client.get("/auth/me/activity")).json()["results"][0]
    assert row["actor_email"] == "mgr@example.com"
    assert row["actor_label"] == "mgr@example.com"
    assert row["actor_role_label"] == "Manager"
    assert row["changes"][0] == {
        "field": "phone",
        "label": "Phone",
        "old": "(972) 555-0142",
        "new": "(972) 555-0199",
    }


@pytest.mark.asyncio
async def test_owner_actor_resolved_from_owner_account_without_cognito(
    client, db_session, as_user, monkeypatch
):
    """An owner acting on their own brand (seen by a manager) resolves from
    `owner_account` — no Cognito call needed."""
    owner, _, location = await _owner_with_location(db_session)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location.id, user_id=manager_sub, is_active=True)
    _add_audit_row(
        db_session,
        record_id=location.id,
        actor_id=owner.cognito_sub,
        actor_role="owner",
        old_val={"about": None},
        new_val={"about": "Family recipes"},
    )
    await db_session.commit()

    def _boom(sub):
        raise AssertionError("owner emails must come from owner_account, not Cognito")

    monkeypatch.setattr(audit_query_service.cognito_service, "find_email_by_sub", _boom)
    as_user("manager", sub=manager_sub)
    row = (await client.get("/auth/me/activity")).json()["results"][0]
    assert row["actor_email"] == owner.email
    assert row["actor_role_label"] == "Owner"
    assert row["changes"][0]["label"] == "About text"


@pytest.mark.asyncio
async def test_manager_assignment_row_names_the_manager(client, db_session, as_user, monkeypatch):
    owner, _, location = await _owner_with_location(db_session)
    manager_sub = str(uuid.uuid4())
    manager_row = await create_location_manager(
        db_session, location_id=location.id, user_id=manager_sub, is_active=True
    )
    await db_session.commit()
    monkeypatch.setattr(
        audit_query_service.cognito_service,
        "find_email_by_sub",
        lambda sub: "jane@example.com" if sub == manager_sub else None,
    )
    _add_audit_row(
        db_session,
        table_name="location_manager",
        record_id=manager_row.id,
        action="create",
        actor_id=owner.cognito_sub,
        actor_role="owner",
        new_val={"location_id": location.id, "user_id": manager_sub, "is_active": True},
    )
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    row = (await client.get("/auth/me/activity")).json()["results"][0]
    assert row["summary"] == "Manager assigned"
    assert row["location_name"] == "Plano" and row["restaurant_name"] == "Spice Route"
    assert row["changes"] == [
        {
            "field": "manager",
            "label": "Manager access (jane@example.com)",
            "old": None,
            "new": "Assigned",
        }
    ]


@pytest.mark.asyncio
async def test_hours_put_is_audited_with_per_day_old_and_new(client, db_session, as_user):
    owner, _, location = await _owner_with_location(db_session)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    first = await client.put(
        f"/locations/{location.id}/hours",
        json={"hours": [{"day_of_week": 0, "open_time": "11:00:00", "close_time": "21:00:00", "is_closed": False}]},
    )
    assert first.status_code == 200, first.text
    second = await client.put(
        f"/locations/{location.id}/hours",
        json={"hours": [{"day_of_week": 0, "open_time": "10:00:00", "close_time": "22:00:00", "is_closed": False}]},
    )
    assert second.status_code == 200, second.text

    rows = (await client.get("/auth/me/activity")).json()["results"]
    latest, earlier = rows[0], rows[1]
    assert latest["summary"] == "Hours updated"
    assert latest["changes"] == [
        {"field": "hours.0", "label": "Hours (Monday)", "old": "11am–9pm", "new": "10am–10pm"}
    ]
    assert earlier["changes"] == [
        {"field": "hours.0", "label": "Hours (Monday)", "old": None, "new": "11am–9pm"}
    ]


@pytest.mark.asyncio
async def test_page_lookups_are_batched_not_per_row(client, db_session, as_user):
    """DB statements for a page must NOT grow with the number of rows (names
    and actors resolved in fixed batched queries)."""
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    locations = [await create_location(db_session, brand_id=brand.id) for _ in range(6)]
    await db_session.commit()

    statements: list[str] = []
    engine = db_session.bind.sync_engine

    def _count(conn, cursor, statement, params, context, executemany):
        statements.append(statement)

    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    async def _fetch_count() -> int:
        statements.clear()
        event.listen(engine, "before_cursor_execute", _count)
        try:
            response = await client.get("/auth/me/activity?page_size=50")
        finally:
            event.remove(engine, "before_cursor_execute", _count)
        assert response.status_code == 200, response.text
        return len([s for s in statements if "audit_log" in s or "restaurant_" in s or "owner_account" in s or "location_manager" in s])

    _add_audit_row(
        db_session, record_id=locations[0].id, actor_id=owner.cognito_sub,
        old_val={"phone": "111"}, new_val={"phone": "222"},
    )
    await db_session.commit()
    few = await _fetch_count()

    for loc in locations:
        for i in range(4):
            _add_audit_row(
                db_session, record_id=loc.id, actor_id=str(uuid.uuid4()), actor_role="manager",
                old_val={"phone": f"{i}"}, new_val={"phone": f"{i + 1}"},
            )
    await db_session.commit()
    many = await _fetch_count()

    # 25 rows vs 1: only the one extra owner_account email batch may appear.
    assert many <= few + 1, (few, many)
    body = (await client.get("/auth/me/activity?page_size=50")).json()
    assert body["total"] == 25


@pytest.mark.asyncio
async def test_manager_scoping_unchanged_no_manager_rows_and_no_foreign_locations(
    client, db_session, as_user
):
    owner, brand, location = await _owner_with_location(db_session)
    other = await create_location(db_session, brand_id=brand.id, location_name="Frisco")
    manager_sub = str(uuid.uuid4())
    mrow = await create_location_manager(db_session, location_id=location.id, user_id=manager_sub, is_active=True)
    await db_session.commit()

    _add_audit_row(db_session, record_id=location.id, actor_id=owner.cognito_sub,
                   old_val={"phone": "1"}, new_val={"phone": "2"})
    _add_audit_row(db_session, record_id=other.id, actor_id=owner.cognito_sub,
                   old_val={"phone": "3"}, new_val={"phone": "4"})
    _add_audit_row(db_session, table_name="location_manager", record_id=mrow.id, action="create",
                   actor_id=owner.cognito_sub, new_val={"location_id": location.id, "user_id": manager_sub})
    await db_session.commit()

    as_user("manager", sub=manager_sub)
    body = (await client.get("/auth/me/activity")).json()
    assert body["total"] == 1
    assert body["results"][0]["location_name"] == "Plano"
    assert all(r["table_name"] != "location_manager" for r in body["results"])
