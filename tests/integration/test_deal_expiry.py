"""Integration test: `app/lambda_handlers/deal_expiry.py`'s real DB logic
— any deal whose `end_at` has passed and is still `is_active=true` gets
flipped to `is_active=false`, with an audit_log entry
(docs/DECISIONS.md "Single EventBridge cron rule for deal expiry" +
"System-initiated audit_log writes").

Calls `deal_expiry._expire_deals()` directly, NOT `deal_expiry.handler()` —
`handler()` wraps the coroutine in `asyncio.run(...)` for the real Lambda
runtime (a fresh top-level event loop per invocation), which cannot be
nested inside pytest-asyncio's own already-running loop
("asyncio.run() cannot be called from a running event loop"). `handler()`'s
own wiring (that it calls `_expire_deals` and shapes the return value) is
covered separately in tests/unit/test_deal_expiry_handler.py via
monkeypatching. `_expire_deals` is the entire real implementation either
way — `handler` itself is a two-line `asyncio.run` + logging wrapper.

Reuses the same in-memory SQLite engine as the `db_session` fixture
(`tests/integration/conftest.py`) by binding a second `async_sessionmaker`
to `db_session.bind` and monkeypatching
`app.db.session.get_session_factory` to return it — `_expire_deals` calls
`get_session_factory()` directly (not through the `get_db` FastAPI
dependency the `client`/`db_session` fixtures override), so this is the
one DB-touching module in this codebase that needs its OWN monkeypatch
rather than reusing `app_main.app.dependency_overrides`.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.lambda_handlers import deal_expiry
from app.models.audit_log import AuditLog
from app.models.deal import Deal

from factories import create_brand, create_deal, create_location, create_owner


@pytest.fixture
def patched_session_factory(db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch):
    """Points `app.db.session.get_session_factory()` at a sessionmaker
    bound to the SAME in-memory SQLite engine `db_session` uses (not a
    second, empty in-memory DB — `StaticPool` keeps one live connection,
    so both session makers see the same data)."""
    session_factory = async_sessionmaker(bind=db_session.bind, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr("app.db.session.get_session_factory", lambda: session_factory)
    return session_factory


@pytest.mark.asyncio
async def test_expires_deal_past_end_at_and_leaves_others_untouched(
    db_session, patched_session_factory
):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    now = datetime.now(timezone.utc)
    past = now - timedelta(minutes=1)
    future = now + timedelta(days=1)

    expired = await create_deal(db_session, location_id=location.id, title="Expired Deal", end_at=past, is_active=True)
    still_running = await create_deal(
        db_session, location_id=location.id, title="Still Running", end_at=future, is_active=True
    )
    permanent_special = await create_deal(
        db_session, location_id=location.id, title="Permanent Special", end_at=None, is_active=True
    )
    already_off = await create_deal(
        db_session, location_id=location.id, title="Already Off", end_at=past, is_active=False
    )
    await db_session.commit()

    count = await deal_expiry._expire_deals()
    assert count == 1

    for deal in (expired, still_running, permanent_special, already_off):
        await db_session.refresh(deal)

    assert expired.is_active is False
    assert still_running.is_active is True
    assert permanent_special.is_active is True
    assert already_off.is_active is False  # unchanged, was already inactive


@pytest.mark.asyncio
async def test_expiry_writes_system_actor_audit_log_entry(db_session, patched_session_factory):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    expired = await create_deal(db_session, location_id=location.id, end_at=past, is_active=True)
    await db_session.commit()

    await deal_expiry._expire_deals()

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.table_name == "deal", AuditLog.record_id == expired.id)
    )
    rows = result.scalars().all()
    assert len(rows) == 1
    entry = rows[0]
    assert entry.action == "update"
    assert entry.actor_role == deal_expiry.SYSTEM_ACTOR_ROLE
    assert entry.actor_id == deal_expiry.SYSTEM_ACTOR_ID
    assert entry.old_val == {"is_active": True}
    assert entry.new_val == {"is_active": False}


@pytest.mark.asyncio
async def test_no_expired_deals_is_a_safe_no_op(db_session, patched_session_factory):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    future = datetime.now(timezone.utc) + timedelta(days=1)
    await create_deal(db_session, location_id=location.id, end_at=future, is_active=True)
    await create_deal(db_session, location_id=location.id, end_at=None, is_active=True)
    await db_session.commit()

    count = await deal_expiry._expire_deals()
    assert count == 0
