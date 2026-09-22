"""Integration tests: `POST /locations/{id}/status` — owner/admin
self-service status change (docs/PROJECT_PLAN.csv row for the location
status lifecycle task; app/models/restaurant_location.py "Location status
lifecycle").

Covers:
  - every self-service transition (active <-> owner_deactivated,
    active <-> coming_soon, active -> closed_pending_reopen) succeeds.
  - the one asymmetric rule: closed_pending_reopen -> anything else via
    this endpoint 409s (must go through the reopen-request flow instead).
  - re-posting the same status is a harmless no-op (200, not 409).
  - manager is forbidden (403) — status control is owner/admin only.
  - a different owner (doesn't own this location) is forbidden (403).
  - an anonymous caller is unauthorized (401).
  - admin can change status on a location it doesn't own.
  - every successful transition writes an audit_log row with old/new status.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.restaurant_location import RestaurantLocation
from factories import create_brand, create_location, create_location_manager, create_owner


async def _setup_owned_location(db_session, **location_overrides):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id, **location_overrides)
    await db_session.commit()
    return owner, brand, location


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "from_status,to_status",
    [
        ("active", "owner_deactivated"),
        ("owner_deactivated", "active"),
        ("active", "coming_soon"),
        ("coming_soon", "active"),
        ("active", "closed_pending_reopen"),
    ],
)
async def test_owner_self_service_transition_succeeds(db_session, client, as_user, from_status, to_status):
    owner, _brand, location = await _setup_owned_location(db_session, status=from_status)
    as_user("owner", sub=owner.cognito_sub)

    response = await client.post(f"/locations/{location.id}/status", json={"status": to_status})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == to_status
    assert body["is_active"] == (to_status == "active")

    audit = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.table_name == "restaurant_location", AuditLog.record_id == location.id
            )
        )
    ).scalar_one()
    assert audit.old_val == {"status": from_status}
    assert audit.new_val == {"status": to_status}
    assert audit.actor_id == owner.cognito_sub
    assert audit.actor_role == "owner"


@pytest.mark.asyncio
async def test_cannot_self_exit_closed_pending_reopen(db_session, client, as_user):
    owner, _brand, location = await _setup_owned_location(db_session, status="closed_pending_reopen")
    as_user("owner", sub=owner.cognito_sub)

    response = await client.post(f"/locations/{location.id}/status", json={"status": "active"})
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "reopen_requires_admin"

    row = (
        await db_session.execute(select(RestaurantLocation).where(RestaurantLocation.id == location.id))
    ).scalar_one()
    assert row.status == "closed_pending_reopen"


@pytest.mark.asyncio
async def test_reposting_same_status_is_idempotent_no_op(db_session, client, as_user):
    owner, _brand, location = await _setup_owned_location(db_session, status="coming_soon")
    as_user("owner", sub=owner.cognito_sub)

    response = await client.post(f"/locations/{location.id}/status", json={"status": "coming_soon"})
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "coming_soon"

    # No new audit_log row from a no-op re-post.
    count = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.table_name == "restaurant_location", AuditLog.record_id == location.id
            )
        )
    ).scalars().all()
    assert count == []


@pytest.mark.asyncio
async def test_reposting_same_closed_pending_reopen_status_is_a_no_op_not_409(db_session, client, as_user):
    """Idempotent no-op check happens BEFORE the asymmetric-rule check in
    location_service.update_location_status — re-posting the current value
    must never 409, even for closed_pending_reopen."""
    owner, _brand, location = await _setup_owned_location(db_session, status="closed_pending_reopen")
    as_user("owner", sub=owner.cognito_sub)

    response = await client.post(
        f"/locations/{location.id}/status", json={"status": "closed_pending_reopen"}
    )
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_manager_cannot_change_status(db_session, client, as_user):
    owner, _brand, location = await _setup_owned_location(db_session, status="active")
    manager = await create_location_manager(db_session, location_id=location.id, is_active=True)
    await db_session.commit()
    as_user("manager", sub=manager.user_id)

    response = await client.post(f"/locations/{location.id}/status", json={"status": "owner_deactivated"})
    assert response.status_code == 403, response.text


@pytest.mark.asyncio
async def test_non_owning_owner_cannot_change_status(db_session, client, as_user):
    _owner, _brand, location = await _setup_owned_location(db_session, status="active")
    other_owner = await create_owner(db_session)
    await db_session.commit()
    as_user("owner", sub=other_owner.cognito_sub)

    response = await client.post(f"/locations/{location.id}/status", json={"status": "owner_deactivated"})
    assert response.status_code == 403, response.text


@pytest.mark.asyncio
async def test_anonymous_caller_unauthorized(db_session, client, as_anonymous):
    _owner, _brand, location = await _setup_owned_location(db_session, status="active")

    response = await client.post(f"/locations/{location.id}/status", json={"status": "owner_deactivated"})
    assert response.status_code == 401, response.text


@pytest.mark.asyncio
async def test_admin_can_change_status_on_unowned_location(db_session, client, as_user):
    _owner, _brand, location = await _setup_owned_location(db_session, status="active")
    as_user("admin")

    response = await client.post(f"/locations/{location.id}/status", json={"status": "coming_soon"})
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "coming_soon"


@pytest.mark.asyncio
async def test_invalid_status_value_rejected(db_session, client, as_user):
    owner, _brand, location = await _setup_owned_location(db_session, status="active")
    as_user("owner", sub=owner.cognito_sub)

    response = await client.post(f"/locations/{location.id}/status", json={"status": "not_a_real_status"})
    assert response.status_code == 422, response.text
