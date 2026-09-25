"""Integration tests: `GET /auth/me/follows` items are search-result-shaped
(`nearest_location`, `location_count_nearby`, cuisine tags, cover photo) so
the favourites grid can reuse the `/search` tile.

Follows are brand-level but deals are per location (same-name restaurants at
different locations run different deals), so the tile's location is:
  - the first (lowest id) active location that has a deal today, else
  - the first (lowest id) active location — same as the detail page's first
    location.
Inactive locations and soft-deleted brands never surface. See
docs/API_CONTRACTS.md "GET /auth/me/follows".
"""
from __future__ import annotations

import uuid
from datetime import datetime, time, timezone

import pytest
from sqlalchemy import event

from app.models.location_cuisine import LocationCuisine
from app.models.restaurant_hours import RestaurantHours
from factories import (
    create_brand,
    create_cuisine_tag,
    create_deal,
    create_follow,
    create_location,
    create_photo,
)


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
async def test_item_is_search_tile_shaped(client, db_session, as_user):
    sub = str(uuid.uuid4())
    brand = await _follow(db_session, sub, name="Spice Garden")
    tag = await create_cuisine_tag(db_session, display_name="Hyderabadi")
    loc = await create_location(
        db_session,
        brand_id=brand.id,
        address_line1="123 Main St",
        city="Irving",
        state="TX",
        postal_code="75038",
        phone="9725550100",
        is_paid=True,
    )
    db_session.add(LocationCuisine(location_id=loc.id, cuisine_tag_id=tag.id))
    for day in range(7):  # open all day, every day: is_open_now is deterministic
        db_session.add(
            RestaurantHours(
                location_id=loc.id,
                day_of_week=day,
                open_time=time(0, 0),
                close_time=time(23, 59),
                is_closed=False,
            )
        )
    photo = await create_photo(db_session, location_id=loc.id, is_cover=True)
    await db_session.commit()

    row = (await _my_follows(client, as_user, sub))[brand.id]
    near = row["nearest_location"]
    assert near["location_id"] == loc.id
    assert near["distance_mi"] is None  # no viewer position
    assert (near["address_line1"], near["city"], near["state"], near["postal_code"]) == (
        "123 Main St",
        "Irving",
        "TX",
        "75038",
    )
    assert near["phone"] == "9725550100"
    assert near["is_paid"] is True
    assert near["open_time"] == "00:00:00" and near["close_time"] == "23:59:00"
    assert near["is_closed"] is False
    assert near["has_deal_today"] is False
    assert row["location_count_nearby"] == 1
    assert [t["display_name"] for t in row["cuisine_tags"]] == ["Hyderabadi"]
    assert row["cover_photo_url"] and photo.s3_key in row["cover_photo_url"]
    assert row["cover_photo_thumbnail_url"]
    assert row["followed_at"]


@pytest.mark.asyncio
async def test_no_deal_uses_first_active_location_and_counts_active_only(
    client, db_session, as_user
):
    sub = str(uuid.uuid4())
    brand = await _follow(db_session, sub)
    # Lowest id but hidden: neither the tile's location nor counted.
    await create_location(
        db_session, brand_id=brand.id, is_active=False, address_line1="1 Hidden Way"
    )
    first_active = await create_location(
        db_session, brand_id=brand.id, address_line1="2 First Active Rd"
    )
    await create_location(db_session, brand_id=brand.id, address_line1="3 Second Ave")
    await db_session.commit()

    row = (await _my_follows(client, as_user, sub))[brand.id]
    assert row["nearest_location"]["location_id"] == first_active.id
    assert row["nearest_location"]["address_line1"] == "2 First Active Rd"
    assert row["location_count_nearby"] == 2
    assert row["has_deal_today"] is False


@pytest.mark.asyncio
async def test_tile_location_is_the_one_with_the_deal(client, db_session, as_user):
    """Two locations of one brand, the deal only at the second: the tile shows
    the DEAL's location (address, badge), not the primary one."""
    sub = str(uuid.uuid4())
    brand = await _follow(db_session, sub, name="Twin Kitchen")
    await create_location(db_session, brand_id=brand.id, address_line1="1 No Deal Blvd")
    dealer = await create_location(db_session, brand_id=brand.id, address_line1="2 Deal Dr")
    await create_deal(db_session, location_id=dealer.id, title="Lunch buffet")
    await db_session.commit()

    row = (await _my_follows(client, as_user, sub))[brand.id]
    assert row["has_deal_today"] is True
    assert row["nearest_location"]["location_id"] == dealer.id
    assert row["nearest_location"]["address_line1"] == "2 Deal Dr"
    assert row["nearest_location"]["has_deal_today"] is True
    assert row["location_count_nearby"] == 2


@pytest.mark.asyncio
async def test_first_deal_location_wins_when_several_have_deals(client, db_session, as_user):
    sub = str(uuid.uuid4())
    brand = await _follow(db_session, sub)
    await create_location(db_session, brand_id=brand.id, address_line1="1 No Deal")
    first_deal = await create_location(db_session, brand_id=brand.id, address_line1="2 First Deal")
    second_deal = await create_location(db_session, brand_id=brand.id, address_line1="3 Second Deal")
    await create_deal(db_session, location_id=second_deal.id, title="B")
    await create_deal(db_session, location_id=first_deal.id, title="A")
    await db_session.commit()

    row = (await _my_follows(client, as_user, sub))[brand.id]
    assert row["nearest_location"]["location_id"] == first_deal.id


@pytest.mark.asyncio
async def test_same_name_brands_are_unaffected_by_each_others_deals(client, db_session, as_user):
    sub = str(uuid.uuid4())
    downtown = await _follow(db_session, sub, name="Curry House", slug=f"curry-house-{uuid.uuid4().hex[:6]}")
    uptown = await _follow(db_session, sub, name="Curry House", slug=f"curry-house-{uuid.uuid4().hex[:6]}")
    d_loc = await create_location(db_session, brand_id=downtown.id, address_line1="10 Downtown St")
    u_loc = await create_location(db_session, brand_id=uptown.id, address_line1="20 Uptown Ave")
    await create_deal(db_session, location_id=u_loc.id, title="Uptown special")
    await db_session.commit()

    rows = await _my_follows(client, as_user, sub)
    assert rows[downtown.id]["has_deal_today"] is False
    assert rows[downtown.id]["nearest_location"]["location_id"] == d_loc.id
    assert rows[uptown.id]["has_deal_today"] is True
    assert rows[uptown.id]["nearest_location"]["location_id"] == u_loc.id
    assert rows[uptown.id]["nearest_location"]["address_line1"] == "20 Uptown Ave"


@pytest.mark.asyncio
async def test_brand_without_active_location_has_no_location(client, db_session, as_user):
    sub = str(uuid.uuid4())
    no_locations = await _follow(db_session, sub, name="Nothing Yet")
    only_hidden = await _follow(db_session, sub, name="All Hidden")
    hidden = await create_location(db_session, brand_id=only_hidden.id, is_active=False)
    await create_deal(db_session, location_id=hidden.id, title="Hidden deal")
    await db_session.commit()

    rows = await _my_follows(client, as_user, sub)
    for brand in (no_locations, only_hidden):
        assert rows[brand.id]["nearest_location"] is None
        assert rows[brand.id]["location_count_nearby"] == 0
        assert rows[brand.id]["has_deal_today"] is False
        assert rows[brand.id]["cover_photo_url"] is None


@pytest.mark.asyncio
async def test_soft_deleted_brand_is_not_listed(client, db_session, as_user):
    sub = str(uuid.uuid4())
    dead = await _follow(db_session, sub, deleted_at=datetime.now(timezone.utc))
    await create_location(db_session, brand_id=dead.id, address_line1="9 Ghost St")
    await db_session.commit()

    assert dead.id not in await _my_follows(client, as_user, sub)


@pytest.mark.asyncio
async def test_only_callers_own_follows(client, db_session, as_user):
    me, other = str(uuid.uuid4()), str(uuid.uuid4())
    mine = await _follow(db_session, me, name="Mine")
    theirs = await _follow(db_session, other, name="Theirs")
    await create_location(db_session, brand_id=mine.id, address_line1="1 My St")
    await create_location(db_session, brand_id=theirs.id, address_line1="2 Their St")
    await db_session.commit()

    rows = await _my_follows(client, as_user, me)
    assert set(rows) == {mine.id}
    assert rows[mine.id]["nearest_location"]["address_line1"] == "1 My St"


@pytest.mark.asyncio
async def test_query_count_is_constant_regardless_of_page_size(client, db_session, as_user):
    """N+1 guard: the total number of SQL statements for the page does not
    grow with the number of followed brands/locations/deals/hours/covers."""
    sub = str(uuid.uuid4())

    async def add_brand(i: int) -> None:
        brand = await _follow(db_session, sub, name=f"Brand {i}")
        for _ in range(3):
            loc = await create_location(db_session, brand_id=brand.id)
            db_session.add(
                RestaurantHours(
                    location_id=loc.id,
                    day_of_week=0,
                    open_time=time(9, 0),
                    close_time=time(21, 0),
                    is_closed=False,
                )
            )
            await create_photo(db_session, location_id=loc.id, is_cover=True)
            await create_deal(db_session, location_id=loc.id, title=f"Deal {i}")

    async def statements_for_request() -> tuple[int, int]:
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
        return len(statements), len(response.json()["results"])

    for i in range(2):
        await add_brand(i)
    await db_session.commit()
    few_statements, few_rows = await statements_for_request()

    for i in range(2, 8):
        await add_brand(i)
    await db_session.commit()
    many_statements, many_rows = await statements_for_request()

    assert (few_rows, many_rows) == (2, 8)
    assert many_statements == few_statements, (few_statements, many_statements)
