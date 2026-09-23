"""Integration test for the dev/test-only `delete_user_data` management
command — docs/PROJECT_PLAN.csv row (added alongside this test) for
"reuse the same email across manual sign-up tests."

Verifies against a real (SQLite) DB, not mocks, that every table keyed off
a Cognito `sub` gets cleaned up for the TARGET user and nothing else, and
that deleting the owner_account row unclaims (not destroys) any brand it
owned, per restaurant_brand.owner_id's ON DELETE SET NULL.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.restaurant_brand import RestaurantBrand
from app.scripts.delete_user_data import DeleteUserDataError, delete_user_data
from factories import (
    create_activity_event,
    create_user_profile,
    create_brand,
    create_claim,
    create_deletion_request,
    create_follow,
    create_location,
    create_location_manager,
    create_owner,
)


@pytest.mark.asyncio
async def test_delete_user_data_removes_every_table_and_unclaims_brands(db_session):
    target = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=target.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id)

    await create_location_manager(db_session, location_id=location.id, user_id=target.cognito_sub)
    await create_claim(db_session, brand_id=brand.id, claimant_user_id=target.cognito_sub)
    await create_follow(db_session, brand_id=brand.id, user_id=target.cognito_sub)
    await create_deletion_request(db_session, requester_user_id=target.cognito_sub)
    await create_activity_event(db_session, user_sub=target.cognito_sub)
    await create_user_profile(db_session, cognito_sub=target.cognito_sub)
    db_session.add(
        AuditLog(
            table_name="restaurant_brand",
            record_id=brand.id,
            action="update",
            actor_id=target.cognito_sub,
            actor_role="owner",
        )
    )
    await db_session.flush()

    # A second, unrelated owner/brand/manager — must survive untouched.
    other = await create_owner(db_session)
    other_brand = await create_brand(db_session, owner_id=other.id)
    other_location = await create_location(db_session, brand_id=other_brand.id)
    await create_location_manager(
        db_session, location_id=other_location.id, user_id="unrelated-sub-should-survive"
    )
    await db_session.commit()

    result = await delete_user_data(cognito_sub=target.cognito_sub, db=db_session)

    assert result["ok"] is True
    assert result["owner_account_deleted"] is True
    assert result["unclaimed_brand_count"] == 1
    assert result["rows_deleted"] == {
        "location_manager": 1,
        "claim_request": 1,
        "user_follow": 1,
        "user_activity_event": 1,
        "user_profile": 1,
        "data_deletion_request": 1,
        "audit_log": 1,
    }

    # The brand itself survives, just unclaimed (ON DELETE SET NULL).
    refreshed_brand = await db_session.get(RestaurantBrand, brand.id)
    assert refreshed_brand is not None
    assert refreshed_brand.owner_id is None

    # The unrelated owner/manager row is untouched.
    from app.models.location_manager import LocationManager

    survivors = await db_session.execute(
        select(LocationManager).where(LocationManager.user_id == "unrelated-sub-should-survive")
    )
    assert survivors.scalar_one_or_none() is not None


@pytest.mark.asyncio
async def test_delete_user_data_handles_a_user_with_no_owner_account(db_session):
    """A manager or registered_user has no owner_account row at all —
    deletion should still clean up their other rows without error."""
    brand = await create_brand(db_session)
    location = await create_location(db_session, brand_id=brand.id)
    manager = await create_location_manager(db_session, location_id=location.id)
    await db_session.commit()

    result = await delete_user_data(cognito_sub=manager.user_id, db=db_session)

    assert result["ok"] is True
    assert result["owner_account_deleted"] is False
    assert result["unclaimed_brand_count"] == 0
    assert result["rows_deleted"]["location_manager"] == 1


@pytest.mark.asyncio
async def test_delete_user_data_requires_email_or_sub():
    with pytest.raises(DeleteUserDataError):
        await delete_user_data()


@pytest.mark.asyncio
async def test_delete_user_data_by_email_raises_when_cognito_lookup_fails(monkeypatch, db_session):
    import app.scripts.delete_user_data as module

    monkeypatch.setattr(module, "find_sub_by_email", lambda email: None)

    with pytest.raises(DeleteUserDataError):
        await delete_user_data(email="nobody@example.com", db=db_session)
