"""Integration test: dev_set_location_status -- force-sets a location's
status directly for manual dev testing (scripts/dev_set_location_status.py
+ app/scripts/dev_set_location_status.py), audits, and is idempotent.
Same pattern as test_dev_unclaim.py."""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.restaurant_location import RestaurantLocation
from app.scripts.dev_set_location_status import DevSetLocationStatusError, set_location_status
from factories import create_brand, create_location, create_owner


@pytest.mark.asyncio
async def test_sets_status_audits_and_is_idempotent(db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id, status="active")
    await db_session.flush()

    first = await set_location_status(db_session, location.id, "coming_soon")
    assert first == {
        "location_id": location.id,
        "old_status": "active",
        "new_status": "coming_soon",
        "changed": True,
    }
    await db_session.refresh(location)
    assert location.status == "coming_soon"

    audits = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.table_name == "restaurant_location", AuditLog.record_id == location.id
            )
        )
    ).scalars().all()
    assert len(audits) == 1
    assert audits[0].old_val == {"status": "active"}
    assert audits[0].new_val == {"status": "coming_soon"}
    assert audits[0].actor_id == "system:dev_set_location_status"

    second = await set_location_status(db_session, location.id, "coming_soon")
    assert second["changed"] is False

    # No second audit row from the idempotent re-run.
    audits_after = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.table_name == "restaurant_location", AuditLog.record_id == location.id
            )
        )
    ).scalars().all()
    assert len(audits_after) == 1


@pytest.mark.asyncio
async def test_rejects_unknown_status(db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id, status="active")
    await db_session.flush()

    with pytest.raises(DevSetLocationStatusError):
        await set_location_status(db_session, location.id, "not_a_real_status")


@pytest.mark.asyncio
async def test_rejects_missing_location(db_session):
    with pytest.raises(DevSetLocationStatusError):
        await set_location_status(db_session, 999999, "active")
