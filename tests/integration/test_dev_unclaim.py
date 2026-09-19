"""Integration test: dev_unclaim -- un-assigns chosen brands, audits each,
reports missing slugs, and is idempotent."""
from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.models.audit_log import AuditLog
from app.scripts.dev_unclaim import unclaim_restaurants
from factories import create_brand, create_owner


@pytest.mark.asyncio
async def test_unclaims_named_brands_audits_and_is_idempotent(db_session):
    owner = await create_owner(db_session)
    a = await create_brand(db_session, owner_id=owner.id, slug="dera-grill", is_claimed=True)
    b = await create_brand(db_session, owner_id=owner.id, slug="keep-me", is_claimed=True)
    await db_session.flush()

    first = await unclaim_restaurants(db_session, ["dera-grill", "no-such-slug"])
    assert first == {"unclaimed": ["dera-grill"], "already_unclaimed": [], "not_found": ["no-such-slug"]}
    await db_session.refresh(a)
    await db_session.refresh(b)
    assert (a.owner_id, a.is_claimed, a.claimed_at) == (None, False, None)
    assert (b.owner_id, b.is_claimed) == (owner.id, True)  # untouched

    audits = (await db_session.execute(
        select(func.count()).select_from(AuditLog).where(AuditLog.table_name == "restaurant_brand", AuditLog.record_id == a.id)
    )).scalar_one()
    assert audits == 1

    second = await unclaim_restaurants(db_session, ["dera-grill"])
    assert second["already_unclaimed"] == ["dera-grill"] and second["unclaimed"] == []
