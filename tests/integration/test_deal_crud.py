"""Integration tests: deal CRUD access control (`POST`/`GET`/`PATCH`/
`DELETE /locations/{id}/deals[...]`) — owner (any of their locations) or
an assigned manager (only their assigned locations) can write; a
different owner, an unassigned manager, and an anonymous caller cannot.
Same `require_location_write_access` dependency as photos/hours, so this
mirrors tests/integration/test_manager_permissions.py's role-boundary
shape (tests/CLAUDE.md "ALWAYS test role boundaries").

Also covers: deal creation is NOT gated on `restaurant_location.is_paid`
(docs/DATA_MODEL.md "deal" judgment-call note — a free-tier location may
have deals), the audit_log entry shape for create/update/delete, and that
DELETE is a real hard delete.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.deal import Deal

from factories import create_brand, create_deal, create_location, create_location_manager, create_owner


@pytest.mark.asyncio
async def test_owner_can_create_deal_on_own_location(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id, is_paid=False)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.post(
        f"/locations/{location.id}/deals",
        json={"title": "Buy 1 Get 1", "description": "Every Tuesday"},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["title"] == "Buy 1 Get 1"
    assert body["deal_type"] == "deal"
    assert body["is_active"] is True
    assert body["location_id"] == location.id


@pytest.mark.asyncio
async def test_deal_creation_not_gated_on_is_paid(client, db_session, as_user):
    """docs/DATA_MODEL.md "deal" judgment call: deal CREATION has no
    is_paid check at all — a free-tier location can have deals."""
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    free_location = await create_location(db_session, brand_id=brand.id, is_paid=False, paid_until=None)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.post(
        f"/locations/{free_location.id}/deals", json={"title": "Free Tier Deal"}
    )
    assert response.status_code == 201, response.text


@pytest.mark.asyncio
async def test_assigned_manager_can_create_deal(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location.id, user_id=manager_sub, is_active=True)
    await db_session.commit()

    as_user("manager", sub=manager_sub)
    response = await client.post(f"/locations/{location.id}/deals", json={"title": "Manager's Deal"})
    assert response.status_code == 201, response.text


@pytest.mark.asyncio
async def test_unassigned_manager_cannot_create_deal(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    # A manager assigned to a DIFFERENT location, not this one.
    other_location = await create_location(db_session, brand_id=brand.id)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=other_location.id, user_id=manager_sub, is_active=True)
    await db_session.commit()

    as_user("manager", sub=manager_sub)
    response = await client.post(f"/locations/{location.id}/deals", json={"title": "Not Allowed"})
    assert response.status_code == 403, response.text


@pytest.mark.asyncio
async def test_different_owner_cannot_create_deal(client, db_session, as_user):
    owner_a = await create_owner(db_session)
    owner_b = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner_a.id)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    as_user("owner", sub=owner_b.cognito_sub, email=owner_b.email)
    response = await client.post(f"/locations/{location.id}/deals", json={"title": "Not Yours"})
    assert response.status_code == 403, response.text


@pytest.mark.asyncio
async def test_anonymous_cannot_create_deal(client, db_session, as_anonymous):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    response = await client.post(f"/locations/{location.id}/deals", json={"title": "Anonymous"})
    assert response.status_code == 401, response.text


@pytest.mark.asyncio
async def test_registered_user_cannot_create_deal(client, db_session, as_user):
    """A registered_user can VIEW public deal content (see
    test_deal_visibility.py) but has no write access at all — same
    posture as every other owner/manager-only write endpoint."""
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    as_user("registered_user")
    response = await client.post(f"/locations/{location.id}/deals", json={"title": "Nope"})
    assert response.status_code == 403, response.text


@pytest.mark.asyncio
async def test_management_list_includes_inactive_deals(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    await create_deal(db_session, location_id=location.id, title="Active One", is_active=True)
    await create_deal(db_session, location_id=location.id, title="Inactive One", is_active=False)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.get(f"/locations/{location.id}/deals")
    assert response.status_code == 200, response.text
    titles = {row["title"] for row in response.json()["results"]}
    assert titles == {"Active One", "Inactive One"}


@pytest.mark.asyncio
async def test_update_deal_toggles_is_active_and_audits(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    deal = await create_deal(db_session, location_id=location.id, title="Toggle Me", is_active=True)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.patch(
        f"/locations/{location.id}/deals/{deal.id}", json={"is_active": False}
    )
    assert response.status_code == 200, response.text
    assert response.json()["is_active"] is False

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.table_name == "deal", AuditLog.record_id == deal.id, AuditLog.action == "update")
    )
    entries = result.scalars().all()
    assert len(entries) == 1
    assert entries[0].old_val["is_active"] is True
    assert entries[0].new_val["is_active"] is False
    assert entries[0].actor_id == owner.cognito_sub
    assert entries[0].actor_role == "owner"


@pytest.mark.asyncio
async def test_update_rejects_start_at_after_end_at(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    deal = await create_deal(db_session, location_id=location.id)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.patch(
        f"/locations/{location.id}/deals/{deal.id}",
        json={"start_at": "2027-01-10T00:00:00Z", "end_at": "2027-01-01T00:00:00Z"},
    )
    assert response.status_code == 400, response.text


@pytest.mark.asyncio
async def test_update_rejects_explicit_null_on_non_nullable_field(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    deal = await create_deal(db_session, location_id=location.id)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.patch(f"/locations/{location.id}/deals/{deal.id}", json={"title": None})
    assert response.status_code == 400, response.text


@pytest.mark.asyncio
async def test_delete_deal_is_a_real_hard_delete_and_audits(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    deal = await create_deal(db_session, location_id=location.id, title="Delete Me")
    await db_session.commit()
    deal_id = deal.id

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.delete(f"/locations/{location.id}/deals/{deal_id}")
    assert response.status_code == 204, response.text

    remaining = await db_session.get(Deal, deal_id)
    assert remaining is None

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.table_name == "deal", AuditLog.record_id == deal_id, AuditLog.action == "delete")
    )
    entries = result.scalars().all()
    assert len(entries) == 1
    assert entries[0].old_val["title"] == "Delete Me"
    assert entries[0].new_val is None


@pytest.mark.asyncio
async def test_manager_cannot_delete_unassigned_locations_deal(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    deal = await create_deal(db_session, location_id=location.id)
    await db_session.commit()

    as_user("manager", sub=str(uuid.uuid4()))
    response = await client.delete(f"/locations/{location.id}/deals/{deal.id}")
    assert response.status_code == 403, response.text

    still_there = await db_session.get(Deal, deal.id)
    assert still_there is not None


@pytest.mark.asyncio
async def test_deal_from_a_different_location_404s(client, db_session, as_user):
    """`get_deal_or_404` checks `deal.location_id == location_id` — a
    valid deal id under the WRONG location path segment must 404, not
    silently operate on it (prevents an owner of location A from
    mutating/reading a deal that actually belongs to location B just by
    guessing/reusing its id)."""
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location_a = await create_location(db_session, brand_id=brand.id)
    location_b = await create_location(db_session, brand_id=brand.id)
    deal = await create_deal(db_session, location_id=location_a.id)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.patch(
        f"/locations/{location_b.id}/deals/{deal.id}", json={"title": "Hijacked"}
    )
    assert response.status_code == 404, response.text
