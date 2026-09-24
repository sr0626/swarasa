"""Integration tests: `GET /auth/me/follows` -> `has_deal_today` /
`deal_titles_today` (added 2026-09-23 for the favourites tiles' "Deal(s)
available today" panel).

Follows are brand-level, deals are per location: a followed brand has a deal
today when ANY of its active locations (brand not soft-deleted) has an active
deal that applies today, using `deal_service.deal_matches_today` — the same
predicate `/search` uses. Dates are built relative to the real "now" in the
location's timezone (America/Chicago via the factory) so tests hold on any
weekday.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import event

from factories import create_brand, create_deal, create_follow, create_location

_TZ = ZoneInfo("America/Chicago")


def _today() -> int:
    return datetime.now(_TZ).weekday()


def _other_day(offset: int = 1) -> int:
    return (_today() + offset) % 7


async def _follow(db_session, user_sub: str, **brand_kwargs):
    brand = await create_brand(db_session, **brand_kwargs)
    await db_session.flush()
    await create_follow(db_session, user_id=user_sub, brand_id=brand.id)
    return brand


async def _my_follows(client, as_user, user_sub: str) -> dict[int, dict]:
    as_user("registered_user", sub=user_sub)
    response = await client.get("/auth/me/follows")
    assert response.status_code == 200, response.text
    return {row["brand_id"]: row for row in response.json()["results"]}


@pytest.mark.asyncio
async def test_brand_with_deal_today_is_flagged_and_others_are_not(client, db_session, as_user):
    sub = str(uuid.uuid4())
    with_deal = await _follow(db_session, sub, name="With Deal")
    without_deal = await _follow(db_session, sub, name="No Deal")
    loc = await create_location(db_session, brand_id=with_deal.id)
    await create_location(db_session, brand_id=without_deal.id)
    await create_deal(db_session, location_id=loc.id, title="Lunch buffet")
    await db_session.commit()

    rows = await _my_follows(client, as_user, sub)
    assert rows[with_deal.id]["has_deal_today"] is True
    assert rows[with_deal.id]["deal_titles_today"] == ["Lunch buffet"]
    assert rows[without_deal.id]["has_deal_today"] is False
    assert rows[without_deal.id]["deal_titles_today"] == []


@pytest.mark.asyncio
async def test_deal_at_any_location_of_the_brand_counts(client, db_session, as_user):
    sub = str(uuid.uuid4())
    brand = await _follow(db_session, sub)
    await create_location(db_session, brand_id=brand.id)  # no deals
    second = await create_location(db_session, brand_id=brand.id)
    await create_deal(db_session, location_id=second.id, title="Second location special")
    await db_session.commit()

    rows = await _my_follows(client, as_user, sub)
    assert rows[brand.id]["has_deal_today"] is True
    assert rows[brand.id]["deal_titles_today"] == ["Second location special"]


@pytest.mark.asyncio
async def test_inactive_expired_future_and_other_day_deals_are_excluded(client, db_session, as_user):
    sub = str(uuid.uuid4())
    brand = await _follow(db_session, sub)
    loc = await create_location(db_session, brand_id=brand.id)
    now = datetime.now(timezone.utc)
    await create_deal(db_session, location_id=loc.id, title="Inactive", is_active=False)
    await create_deal(db_session, location_id=loc.id, title="Expired", end_at=now - timedelta(days=1))
    await create_deal(db_session, location_id=loc.id, title="Not yet", start_at=now + timedelta(days=3))
    await create_deal(db_session, location_id=loc.id, title="Other day", applicable_days=[_other_day()])
    await db_session.commit()

    rows = await _my_follows(client, as_user, sub)
    assert rows[brand.id]["has_deal_today"] is False
    assert rows[brand.id]["deal_titles_today"] == []


@pytest.mark.asyncio
async def test_todays_weekday_deal_matches(client, db_session, as_user):
    sub = str(uuid.uuid4())
    brand = await _follow(db_session, sub)
    loc = await create_location(db_session, brand_id=brand.id)
    await create_deal(db_session, location_id=loc.id, title="Today only", applicable_days=[_today()])
    await db_session.commit()

    rows = await _my_follows(client, as_user, sub)
    assert rows[brand.id]["has_deal_today"] is True


@pytest.mark.asyncio
async def test_hidden_location_deal_is_excluded(client, db_session, as_user):
    """Deal on a non-`active` location (e.g. owner_deactivated) never counts."""
    sub = str(uuid.uuid4())
    brand = await _follow(db_session, sub)
    hidden = await create_location(db_session, brand_id=brand.id, is_active=False)
    await create_deal(db_session, location_id=hidden.id, title="Hidden location deal")
    await db_session.commit()

    rows = await _my_follows(client, as_user, sub)
    assert rows[brand.id]["has_deal_today"] is False


@pytest.mark.asyncio
async def test_soft_deleted_brand_is_not_listed_at_all(client, db_session, as_user):
    sub = str(uuid.uuid4())
    brand = await _follow(db_session, sub, deleted_at=datetime.now(timezone.utc))
    loc = await create_location(db_session, brand_id=brand.id)
    await create_deal(db_session, location_id=loc.id, title="Ghost deal")
    await db_session.commit()

    rows = await _my_follows(client, as_user, sub)
    assert brand.id not in rows


@pytest.mark.asyncio
async def test_titles_capped_at_two_in_stable_order(client, db_session, as_user):
    sub = str(uuid.uuid4())
    brand = await _follow(db_session, sub)
    loc = await create_location(db_session, brand_id=brand.id)
    for title in ("A", "B", "C"):
        await create_deal(db_session, location_id=loc.id, title=title)
    await db_session.commit()

    rows = await _my_follows(client, as_user, sub)
    assert rows[brand.id]["has_deal_today"] is True
    assert rows[brand.id]["deal_titles_today"] == ["A", "B"]


@pytest.mark.asyncio
async def test_only_callers_own_follows_are_returned(client, db_session, as_user):
    me = str(uuid.uuid4())
    other = str(uuid.uuid4())
    mine = await _follow(db_session, me, name="Mine")
    theirs = await _follow(db_session, other, name="Theirs")
    for brand in (mine, theirs):
        loc = await create_location(db_session, brand_id=brand.id)
        await create_deal(db_session, location_id=loc.id, title=f"Deal at {brand.name}")
    await db_session.commit()

    rows = await _my_follows(client, as_user, me)
    assert set(rows) == {mine.id}
    assert rows[mine.id]["deal_titles_today"] == ["Deal at Mine"]


@pytest.mark.asyncio
async def test_deal_lookup_query_count_is_independent_of_page_size(client, db_session, as_user):
    """N+1 guard: the location and deal tables are each read once per request
    no matter how many followed brands (or locations/deals) there are."""
    sub = str(uuid.uuid4())
    for i in range(6):
        brand = await _follow(db_session, sub, name=f"Brand {i}")
        for _ in range(2):
            loc = await create_location(db_session, brand_id=brand.id)
            await create_deal(db_session, location_id=loc.id, title=f"Deal {i}")
    await db_session.commit()

    statements: list[str] = []
    engine = db_session.bind.sync_engine

    def _capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", _capture)
    try:
        as_user("registered_user", sub=sub)
        response = await client.get("/auth/me/follows?page_size=100")
    finally:
        event.remove(engine, "before_cursor_execute", _capture)

    assert response.status_code == 200, response.text
    assert len(response.json()["results"]) == 6
    assert all(row["has_deal_today"] for row in response.json()["results"])
    assert len([s for s in statements if "FROM deal" in s]) == 1, statements
    assert len([s for s in statements if "FROM restaurant_location" in s]) == 1, statements
