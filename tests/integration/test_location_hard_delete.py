"""Integration tests: `DELETE /locations/{id}/permanent` — the real,
irreversible location delete added to close the dead end in `DELETE
/restaurants/{id}` (docs/DECISIONS.md "Hard-delete a location";
docs/API_CONTRACTS.md "DELETE /locations/{id}/permanent").

Covers:
  - refuses (409, `location_still_active`) while the location is `active`.
  - refuses (409, `location_has_active_manager`) with an active manager
    assignment; an inactive (already-removed) manager row does not block.
  - refuses (409, `location_has_pending_claim`) with a `claim_request` in
    `pending_review` referencing this location.
  - refuses (409, `location_has_pending_reopen_request`) with a pending
    reopen request for this location.
  - succeeds for owner (owns parent brand) and for admin: row is actually
    gone (not just hidden), audit_log row written (`action="delete"`),
    and the brand can now be hard-deleted once it has zero locations left.
  - a different owner (doesn't own this location) is forbidden (403); an
    anonymous caller is unauthorized (401); a manager is forbidden (403) —
    same auth shape as the existing soft-delete route.
  - 404 for a location that doesn't exist.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.claim_request import ClaimRequest
from app.models.location_manager import LocationManager
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from factories import (
    create_brand,
    create_claim,
    create_location,
    create_location_manager,
    create_owner,
)


async def _setup_hidden_location(db_session, status="owner_deactivated", **overrides):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id, status=status, **overrides)
    await db_session.commit()
    return owner, brand, location


@pytest.mark.asyncio
async def test_refuses_while_still_active(db_session, client, as_user):
    owner, _brand, location = await _setup_hidden_location(db_session, status="active")
    as_user("owner", sub=owner.cognito_sub)

    response = await client.delete(f"/locations/{location.id}/permanent")
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "location_still_active"

    row = (
        await db_session.execute(
            select(RestaurantLocation).where(RestaurantLocation.id == location.id)
        )
    ).scalar_one_or_none()
    assert row is not None


@pytest.mark.asyncio
async def test_refuses_with_active_manager_assignment(db_session, client, as_user):
    owner, _brand, location = await _setup_hidden_location(db_session)
    await create_location_manager(db_session, location_id=location.id, is_active=True)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)

    response = await client.delete(f"/locations/{location.id}/permanent")
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "location_has_active_manager"


@pytest.mark.asyncio
async def test_succeeds_with_only_inactive_manager_history(db_session, client, as_user):
    owner, _brand, location = await _setup_hidden_location(db_session)
    manager = await create_location_manager(
        db_session, location_id=location.id, is_active=False
    )
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)

    response = await client.delete(f"/locations/{location.id}/permanent")
    assert response.status_code == 204, response.text

    # Cascaded away with the parent location (docs/DECISIONS.md
    # "Hard-delete a location" — inactive manager history loss is accepted).
    row = (
        await db_session.execute(
            select(LocationManager).where(LocationManager.id == manager.id)
        )
    ).scalar_one_or_none()
    assert row is None


@pytest.mark.asyncio
async def test_refuses_with_pending_claim_on_this_location(db_session, client, as_user):
    owner, brand, location = await _setup_hidden_location(db_session)
    await create_claim(
        db_session,
        brand_id=brand.id,
        location_id=location.id,
        status="pending_review",
        proof_method="phone_verification",
    )
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)

    response = await client.delete(f"/locations/{location.id}/permanent")
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "location_has_pending_claim"


@pytest.mark.asyncio
async def test_succeeds_with_resolved_claim_on_this_location(db_session, client, as_user):
    owner, brand, location = await _setup_hidden_location(db_session)
    await create_claim(
        db_session,
        brand_id=brand.id,
        location_id=location.id,
        status="approved",
        proof_method="phone_verification",
    )
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)

    response = await client.delete(f"/locations/{location.id}/permanent")
    assert response.status_code == 204, response.text

    # SET NULL, not cascaded — the claim record survives with its location
    # pointer cleared (docs/API_CONTRACTS.md "DELETE /locations/{id}/permanent").
    claim = (
        await db_session.execute(
            select(ClaimRequest).where(ClaimRequest.brand_id == brand.id)
        )
    ).scalar_one()
    assert claim.location_id is None


@pytest.mark.asyncio
async def test_refuses_with_pending_reopen_request(db_session, client, as_user):
    owner, _brand, location = await _setup_hidden_location(
        db_session, status="closed_pending_reopen"
    )
    as_user("owner", sub=owner.cognito_sub)
    submit = await client.post(
        f"/locations/{location.id}/reopen-requests", json={"notes": "please reopen"}
    )
    assert submit.status_code == 201, submit.text

    response = await client.delete(f"/locations/{location.id}/permanent")
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "location_has_pending_reopen_request"


@pytest.mark.asyncio
async def test_owner_can_remove_own_location(db_session, client, as_user):
    owner, _brand, location = await _setup_hidden_location(db_session)
    as_user("owner", sub=owner.cognito_sub)

    response = await client.delete(f"/locations/{location.id}/permanent")
    assert response.status_code == 204, response.text

    row = (
        await db_session.execute(
            select(RestaurantLocation).where(RestaurantLocation.id == location.id)
        )
    ).scalar_one_or_none()
    assert row is None

    audit = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.table_name == "restaurant_location",
                AuditLog.record_id == location.id,
                AuditLog.action == "delete",
            )
        )
    ).scalar_one()
    assert audit.actor_id == owner.cognito_sub
    assert audit.actor_role == "owner"
    assert audit.old_val["status"] == "owner_deactivated"
    assert audit.new_val is None


@pytest.mark.asyncio
async def test_admin_can_remove_a_location_it_does_not_own(db_session, client, as_user):
    _owner, _brand, location = await _setup_hidden_location(db_session)
    as_user("admin")

    response = await client.delete(f"/locations/{location.id}/permanent")
    assert response.status_code == 204, response.text


@pytest.mark.asyncio
async def test_removing_the_last_location_unblocks_brand_delete(db_session, client, as_user):
    owner, brand, location = await _setup_hidden_location(db_session)
    as_user("owner", sub=owner.cognito_sub)

    response = await client.delete(f"/locations/{location.id}/permanent")
    assert response.status_code == 204, response.text

    as_user("admin")
    delete_brand = await client.delete(f"/restaurants/{brand.id}")
    assert delete_brand.status_code == 204, delete_brand.text

    row = (
        await db_session.execute(
            select(RestaurantBrand).where(RestaurantBrand.id == brand.id)
        )
    ).scalar_one_or_none()
    assert row is None


@pytest.mark.asyncio
async def test_different_owner_is_forbidden(db_session, client, as_user):
    _owner, _brand, location = await _setup_hidden_location(db_session)
    other_owner = await create_owner(db_session)
    await db_session.commit()
    as_user("owner", sub=other_owner.cognito_sub)

    response = await client.delete(f"/locations/{location.id}/permanent")
    assert response.status_code == 403, response.text


@pytest.mark.asyncio
async def test_manager_is_forbidden(db_session, client, as_user):
    owner, _brand, location = await _setup_hidden_location(db_session)
    manager_sub = "manager-sub-not-owner"
    await create_location_manager(
        db_session, location_id=location.id, user_id=manager_sub, is_active=True
    )
    await db_session.commit()
    as_user("manager", sub=manager_sub)

    response = await client.delete(f"/locations/{location.id}/permanent")
    assert response.status_code == 403, response.text


@pytest.mark.asyncio
async def test_anonymous_is_unauthorized(db_session, client, as_anonymous):
    _owner, _brand, location = await _setup_hidden_location(db_session)

    response = await client.delete(f"/locations/{location.id}/permanent")
    assert response.status_code == 401, response.text


@pytest.mark.asyncio
async def test_404_for_missing_location(client, as_user):
    as_user("admin")

    response = await client.delete("/locations/999999/permanent")
    assert response.status_code == 404, response.text
