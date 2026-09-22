"""Integration tests: `location_reopen_request` lifecycle — the only path
that moves a `closed_pending_reopen` location back to `active`
(app/models/location_reopen_request.py, app/services/location_reopen_service.py).

Covers:
  - owner submits a request while the location IS closed_pending_reopen ->
    201, pending_review.
  - submitting while NOT closed_pending_reopen -> 409.
  - submitting a second request while one is already pending -> 409
    (partial unique index).
  - a non-owner cannot submit (403); manager cannot submit (403).
  - admin approve -> location flips to active, request becomes approved,
    audit_log row written for restaurant_location.
  - admin reject -> location stays closed_pending_reopen, request becomes
    rejected with reviewer_notes, no restaurant_location audit_log row.
  - a non-admin cannot approve/reject.
  - GET /location-reopen-requests/{id}: the requesting owner or admin can
    view; a different owner cannot (403).
  - GET /location-reopen-requests (admin queue) defaults to pending_review
    and lists the right queue item shape.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.restaurant_location import RestaurantLocation
from factories import create_brand, create_location, create_location_manager, create_owner


async def _setup_closed_location(db_session, **overrides):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(
        db_session, brand_id=brand.id, status="closed_pending_reopen", **overrides
    )
    await db_session.commit()
    return owner, brand, location


@pytest.mark.asyncio
async def test_owner_can_submit_reopen_request_for_closed_location(db_session, client, as_user):
    owner, _brand, location = await _setup_closed_location(db_session)
    as_user("owner", sub=owner.cognito_sub)

    response = await client.post(
        f"/locations/{location.id}/reopen-requests", json={"notes": "renovation finished"}
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["location_id"] == location.id
    assert body["status"] == "pending_review"
    assert body["notes"] == "renovation finished"


@pytest.mark.asyncio
async def test_submit_when_not_closed_pending_reopen_is_409(db_session, client, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id, status="active")
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)

    response = await client.post(f"/locations/{location.id}/reopen-requests", json={})
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "not_closed_pending_reopen"


@pytest.mark.asyncio
async def test_second_submission_while_one_pending_is_409(db_session, client, as_user):
    owner, _brand, location = await _setup_closed_location(db_session)
    as_user("owner", sub=owner.cognito_sub)

    first = await client.post(f"/locations/{location.id}/reopen-requests", json={})
    assert first.status_code == 201, first.text

    second = await client.post(f"/locations/{location.id}/reopen-requests", json={})
    assert second.status_code == 409, second.text
    assert second.json()["code"] == "reopen_request_already_pending"


@pytest.mark.asyncio
async def test_manager_cannot_submit_reopen_request(db_session, client, as_user):
    _owner, _brand, location = await _setup_closed_location(db_session)
    manager = await create_location_manager(db_session, location_id=location.id, is_active=True)
    await db_session.commit()
    as_user("manager", sub=manager.user_id)

    response = await client.post(f"/locations/{location.id}/reopen-requests", json={})
    assert response.status_code == 403, response.text


@pytest.mark.asyncio
async def test_non_owning_owner_cannot_submit_reopen_request(db_session, client, as_user):
    _owner, _brand, location = await _setup_closed_location(db_session)
    other_owner = await create_owner(db_session)
    await db_session.commit()
    as_user("owner", sub=other_owner.cognito_sub)

    response = await client.post(f"/locations/{location.id}/reopen-requests", json={})
    assert response.status_code == 403, response.text


@pytest.mark.asyncio
async def test_admin_approve_reopens_location_and_audits(db_session, client, as_user):
    owner, _brand, location = await _setup_closed_location(db_session)
    as_user("owner", sub=owner.cognito_sub)
    submit = await client.post(f"/locations/{location.id}/reopen-requests", json={})
    request_id = submit.json()["request_id"]

    as_user("admin")
    response = await client.post(
        f"/location-reopen-requests/{request_id}/approve", json={"reviewer_notes": "looks good"}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "approved"
    assert body["reviewer_notes"] == "looks good"

    row = (
        await db_session.execute(select(RestaurantLocation).where(RestaurantLocation.id == location.id))
    ).scalar_one()
    assert row.status == "active"

    audit = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.table_name == "restaurant_location", AuditLog.record_id == location.id
            )
        )
    ).scalar_one()
    assert audit.old_val == {"status": "closed_pending_reopen"}
    assert audit.new_val == {"status": "active"}
    assert audit.actor_role == "admin"


@pytest.mark.asyncio
async def test_admin_reject_keeps_location_closed_with_reviewer_notes(db_session, client, as_user):
    owner, _brand, location = await _setup_closed_location(db_session)
    as_user("owner", sub=owner.cognito_sub)
    submit = await client.post(f"/locations/{location.id}/reopen-requests", json={})
    request_id = submit.json()["request_id"]

    as_user("admin")
    response = await client.post(
        f"/location-reopen-requests/{request_id}/reject",
        json={"reviewer_notes": "insufficient proof of renovation"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "rejected"
    assert body["reviewer_notes"] == "insufficient proof of renovation"

    row = (
        await db_session.execute(select(RestaurantLocation).where(RestaurantLocation.id == location.id))
    ).scalar_one()
    assert row.status == "closed_pending_reopen"

    # No restaurant_location audit_log row from a rejection — it never
    # changes restaurant_location data.
    audits = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.table_name == "restaurant_location", AuditLog.record_id == location.id
            )
        )
    ).scalars().all()
    assert audits == []


@pytest.mark.asyncio
async def test_reject_requires_reviewer_notes(db_session, client, as_user):
    owner, _brand, location = await _setup_closed_location(db_session)
    as_user("owner", sub=owner.cognito_sub)
    submit = await client.post(f"/locations/{location.id}/reopen-requests", json={})
    request_id = submit.json()["request_id"]

    as_user("admin")
    response = await client.post(f"/location-reopen-requests/{request_id}/reject", json={})
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_non_admin_cannot_approve(db_session, client, as_user):
    owner, _brand, location = await _setup_closed_location(db_session)
    as_user("owner", sub=owner.cognito_sub)
    submit = await client.post(f"/locations/{location.id}/reopen-requests", json={})
    request_id = submit.json()["request_id"]

    # Still authenticated as the same owner -- not an admin.
    response = await client.post(f"/location-reopen-requests/{request_id}/approve", json={})
    assert response.status_code == 403, response.text


@pytest.mark.asyncio
async def test_requesting_owner_can_view_own_request(db_session, client, as_user):
    owner, _brand, location = await _setup_closed_location(db_session)
    as_user("owner", sub=owner.cognito_sub)
    submit = await client.post(f"/locations/{location.id}/reopen-requests", json={})
    request_id = submit.json()["request_id"]

    response = await client.get(f"/location-reopen-requests/{request_id}")
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_different_owner_cannot_view_someone_elses_request(db_session, client, as_user):
    owner, _brand, location = await _setup_closed_location(db_session)
    as_user("owner", sub=owner.cognito_sub)
    submit = await client.post(f"/locations/{location.id}/reopen-requests", json={})
    request_id = submit.json()["request_id"]

    other_owner = await create_owner(db_session)
    await db_session.commit()
    as_user("owner", sub=other_owner.cognito_sub)

    response = await client.get(f"/location-reopen-requests/{request_id}")
    assert response.status_code == 403, response.text


@pytest.mark.asyncio
async def test_admin_queue_lists_pending_by_default(db_session, client, as_user):
    owner, brand, location = await _setup_closed_location(db_session)
    as_user("owner", sub=owner.cognito_sub)
    submit = await client.post(f"/locations/{location.id}/reopen-requests", json={"notes": "please reopen"})
    assert submit.status_code == 201, submit.text

    as_user("admin")
    response = await client.get("/location-reopen-requests")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    item = body["results"][0]
    assert item["location_id"] == location.id
    assert item["brand_id"] == brand.id
    assert item["status"] == "pending_review"
    assert item["notes"] == "please reopen"


@pytest.mark.asyncio
async def test_non_admin_cannot_list_admin_queue(db_session, client, as_user):
    owner, _brand, _location = await _setup_closed_location(db_session)
    as_user("owner", sub=owner.cognito_sub)

    response = await client.get("/location-reopen-requests")
    assert response.status_code == 403, response.text
