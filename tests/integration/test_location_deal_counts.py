"""Integration tests: `active_deals_count` / `deals_hidden` on the owner-console
location lists (2026-09-24) — they drive the Deals button state on the owner
business page (`GET /restaurants/{id}/locations`) and the manager panel
(`GET /auth/me/managed-locations`).

Deal counts are deal CONTENT metadata, so:
  - `GET /restaurants/{id}/locations` returns them ONLY to the owning owner
    or an admin; anonymous / another owner / a manager / a registered user
    get null (public sees only the boolean `has_deal_today` elsewhere).
  - `GET /auth/me/managed-locations` is self-scoped to the manager's own
    assignments, so every row carries a real count.

"Live" = is_active and (end_at is NULL or end_at > now). Inactive and expired
deals never count; a future `start_at` / weekday-restricted deal still does
(the owner has set it up).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event

import app.main as app_main
from app.dependencies.auth import CurrentUser, get_current_user_optional
from factories import (
    create_brand,
    create_deal,
    create_location,
    create_location_manager,
    create_owner,
)


def _as_optional_user(role: str, *, sub: str | None = None) -> CurrentUser:
    user = CurrentUser(
        cognito_sub=sub or str(uuid.uuid4()), email=f"{uuid.uuid4().hex[:10]}@example.com", role=role
    )

    async def _override():
        return user

    app_main.app.dependency_overrides[get_current_user_optional] = _override
    return user


async def _seed(db_session):
    """One brand with three locations: `busy` (2 live + 4 non-counting
    deals), `quiet` (no deals), `hidden` (1 live deal, Hide-all ON)."""
    now = datetime.now(timezone.utc)
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    busy = await create_location(db_session, brand_id=brand.id)
    quiet = await create_location(db_session, brand_id=brand.id)
    hidden = await create_location(db_session, brand_id=brand.id, deals_hidden=True)

    # Live: indefinite special, and a deal ending in the future.
    await create_deal(db_session, location_id=busy.id, title="Special")
    await create_deal(db_session, location_id=busy.id, title="Ends soon", end_at=now + timedelta(days=2))
    # Non-counting: switched off, expired (still is_active until the cron runs),
    # and one on another location.
    await create_deal(db_session, location_id=busy.id, title="Off", is_active=False)
    await create_deal(db_session, location_id=busy.id, title="Expired", end_at=now - timedelta(hours=1))
    # Counting: scheduled for the future and weekday-restricted still count.
    await create_deal(
        db_session,
        location_id=busy.id,
        title="Starts next week",
        start_at=now + timedelta(days=7),
        end_at=now + timedelta(days=14),
    )
    await create_deal(db_session, location_id=hidden.id, title="Hidden but live")
    await db_session.commit()
    return owner, brand, busy, quiet, hidden


@pytest.mark.asyncio
async def test_owner_sees_live_counts_and_hidden_flag(client, db_session):
    owner, brand, busy, quiet, hidden = await _seed(db_session)
    _as_optional_user("owner", sub=owner.cognito_sub)

    response = await client.get(f"/restaurants/{brand.id}/locations")
    assert response.status_code == 200, response.text
    rows = {r["id"]: r for r in response.json()["results"]}
    # Special + Ends soon + Starts next week; Off and Expired excluded.
    assert rows[busy.id]["active_deals_count"] == 3
    assert rows[busy.id]["deals_hidden"] is False
    assert rows[quiet.id]["active_deals_count"] == 0
    assert rows[quiet.id]["deals_hidden"] is False
    # Hide-all is surfaced alongside the (still-counted) live deal.
    assert rows[hidden.id]["active_deals_count"] == 1
    assert rows[hidden.id]["deals_hidden"] is True


@pytest.mark.asyncio
async def test_admin_sees_counts(client, db_session):
    _, brand, busy, *_ = await _seed(db_session)
    _as_optional_user("admin")

    response = await client.get(f"/restaurants/{brand.id}/locations")
    rows = {r["id"]: r for r in response.json()["results"]}
    assert rows[busy.id]["active_deals_count"] == 3


@pytest.mark.asyncio
async def test_public_and_other_callers_never_get_counts(client, db_session):
    _, brand, busy, quiet, hidden = await _seed(db_session)
    other_owner = await create_owner(db_session)
    await db_session.commit()

    # Anonymous
    app_main.app.dependency_overrides.pop(get_current_user_optional, None)
    anon = await client.get(f"/restaurants/{brand.id}/locations")
    assert anon.status_code == 200, anon.text

    callers = [("anonymous", anon)]
    for role, sub in (
        ("owner", other_owner.cognito_sub),  # an owner who does NOT own this brand
        ("manager", None),
        ("registered_user", None),
    ):
        _as_optional_user(role, sub=sub)
        callers.append((role, await client.get(f"/restaurants/{brand.id}/locations")))

    for who, resp in callers:
        assert resp.status_code == 200, (who, resp.text)
        for row in resp.json()["results"]:
            assert row["active_deals_count"] is None, who
            assert row["deals_hidden"] is None, who


@pytest.mark.asyncio
async def test_manager_panel_rows_carry_counts_for_assigned_locations_only(
    client, db_session, as_user
):
    owner, brand, busy, quiet, hidden = await _seed(db_session)
    manager_sub = str(uuid.uuid4())
    # Assigned to `busy` and `hidden`; NOT to `quiet`.
    await create_location_manager(db_session, location_id=busy.id, user_id=manager_sub, is_active=True)
    await create_location_manager(db_session, location_id=hidden.id, user_id=manager_sub, is_active=True)
    await db_session.commit()

    as_user("manager", sub=manager_sub)
    response = await client.get("/auth/me/managed-locations")
    assert response.status_code == 200, response.text
    rows = {r["id"]: r for r in response.json()["results"]}
    assert set(rows) == {busy.id, hidden.id}
    assert rows[busy.id]["active_deals_count"] == 3
    assert rows[busy.id]["deals_hidden"] is False
    assert rows[hidden.id]["active_deals_count"] == 1
    assert rows[hidden.id]["deals_hidden"] is True


@pytest.mark.asyncio
async def test_deal_count_query_is_one_grouped_query_regardless_of_page_size(
    client, db_session, as_user
):
    """N+1 guard: the deal table is read exactly once per request, however
    many locations are listed (both endpoints)."""
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    manager_sub = str(uuid.uuid4())
    for _ in range(6):
        loc = await create_location(db_session, brand_id=brand.id)
        await create_deal(db_session, location_id=loc.id)
        await create_deal(db_session, location_id=loc.id)
        await create_location_manager(db_session, location_id=loc.id, user_id=manager_sub, is_active=True)
    await db_session.commit()

    statements: list[str] = []
    engine = db_session.bind.sync_engine

    def _capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", _capture)
    try:
        _as_optional_user("owner", sub=owner.cognito_sub)
        owner_resp = await client.get(f"/restaurants/{brand.id}/locations?page_size=100")
        owner_deal_reads = len([s for s in statements if "FROM deal" in s])
        statements.clear()
        as_user("manager", sub=manager_sub)
        mgr_resp = await client.get("/auth/me/managed-locations?page_size=100")
        mgr_deal_reads = len([s for s in statements if "FROM deal" in s])
    finally:
        event.remove(engine, "before_cursor_execute", _capture)

    assert len(owner_resp.json()["results"]) == 6
    assert all(r["active_deals_count"] == 2 for r in owner_resp.json()["results"])
    assert len(mgr_resp.json()["results"]) == 6
    assert all(r["active_deals_count"] == 2 for r in mgr_resp.json()["results"])
    assert owner_deal_reads == 1, statements
    assert mgr_deal_reads == 1, statements
