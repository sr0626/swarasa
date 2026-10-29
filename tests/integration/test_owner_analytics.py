"""Integration tests: owner analytics -- `POST /track/location/{id}` (public
counter increment), `GET /locations/{id}/analytics`, `GET
/restaurants/{id}/analytics`. docs/API_CONTRACTS.md "Owner analytics".

Focus: counters only (no personal data), atomic upsert, self-views dropped,
hidden locations not counted, permission boundaries on the read endpoints
(owner / assigned manager / admin; everyone else refused), period math.
"""
from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select

import app.main as app_main
from app.dependencies.auth import CurrentUser, get_current_user_lenient
from app.models.location_daily_stat import LocationDailyStat
from app.models.restaurant_location import RestaurantLocation
from app.services.analytics_service import today_utc
from factories import (
    create_brand,
    create_deal,
    create_follow,
    create_location,
    create_location_manager,
    create_owner,
)


@pytest.fixture
def track_as(as_user):
    """Sign in for BOTH the strict dependency (read endpoints) and the
    lenient one the public track route uses (it is a separate callable, so
    `as_user` alone does not override it)."""

    def _track_as(role: str, *, sub: str | None = None, email: str | None = None) -> CurrentUser:
        user = as_user(role, sub=sub, email=email)

        async def _lenient():
            return user

        app_main.app.dependency_overrides[get_current_user_lenient] = _lenient
        return user

    return _track_as


async def _setup(db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()
    return owner, brand, location


async def _rows(db_session, location_id):
    return (
        (await db_session.execute(select(LocationDailyStat).where(LocationDailyStat.location_id == location_id)))
        .scalars()
        .all()
    )


# --- recording -------------------------------------------------------------


@pytest.mark.asyncio
async def test_anonymous_track_increments_one_row_atomically(client, db_session, as_anonymous):
    _, _, location = await _setup(db_session)
    for _ in range(3):
        r = await client.post(f"/track/location/{location.id}", json={"event": "page_view"})
        assert r.status_code == 204
    r = await client.post(f"/track/location/{location.id}", json={"event": "phone_click"})
    assert r.status_code == 204

    rows = await _rows(db_session, location.id)
    assert len(rows) == 1  # one row per location per day
    await db_session.refresh(rows[0])
    assert rows[0].stat_date == today_utc()
    assert rows[0].page_views == 3
    assert rows[0].phone_clicks == 1
    assert rows[0].tile_clicks == 0


@pytest.mark.asyncio
async def test_every_known_event_maps_to_its_counter(client, db_session, as_anonymous):
    _, _, location = await _setup(db_session)
    for event in ("page_view", "tile_click", "deal_view", "website_click", "directions_click", "phone_click"):
        assert (await client.post(f"/track/location/{location.id}", json={"event": event})).status_code == 204
    row = (await _rows(db_session, location.id))[0]
    await db_session.refresh(row)
    assert (row.page_views, row.tile_clicks, row.deal_views) == (1, 1, 1)
    assert (row.website_clicks, row.directions_clicks, row.phone_clicks) == (1, 1, 1)


@pytest.mark.asyncio
async def test_unknown_event_and_unknown_location_are_ignored_with_204(client, db_session, as_anonymous):
    _, _, location = await _setup(db_session)
    assert (await client.post(f"/track/location/{location.id}", json={"event": "bogus"})).status_code == 204
    assert (await client.post("/track/location/999999", json={"event": "page_view"})).status_code == 204
    assert await _rows(db_session, location.id) == []
    assert (await db_session.execute(select(LocationDailyStat))).scalars().all() == []


@pytest.mark.asyncio
async def test_hidden_location_is_not_counted(client, db_session, as_anonymous):
    _, _, location = await _setup(db_session)
    location.status = RestaurantLocation.STATUS_OWNER_DEACTIVATED
    await db_session.commit()
    assert (await client.post(f"/track/location/{location.id}", json={"event": "page_view"})).status_code == 204
    assert await _rows(db_session, location.id) == []


@pytest.mark.asyncio
async def test_own_owner_manager_and_admin_views_are_not_counted(client, db_session, track_as):
    owner, _, location = await _setup(db_session)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location.id, user_id=manager_sub, is_active=True)
    await db_session.commit()

    track_as("owner", sub=owner.cognito_sub, email=owner.email)
    assert (await client.post(f"/track/location/{location.id}", json={"event": "page_view"})).status_code == 204
    track_as("manager", sub=manager_sub)
    assert (await client.post(f"/track/location/{location.id}", json={"event": "page_view"})).status_code == 204
    track_as("admin")
    assert (await client.post(f"/track/location/{location.id}", json={"event": "page_view"})).status_code == 204
    assert await _rows(db_session, location.id) == []


@pytest.mark.asyncio
async def test_other_owner_and_unassigned_manager_and_diner_views_do_count(client, db_session, track_as):
    _, _, location = await _setup(db_session)
    other_owner = await create_owner(db_session)
    await db_session.commit()

    track_as("owner", sub=other_owner.cognito_sub, email=other_owner.email)
    await client.post(f"/track/location/{location.id}", json={"event": "page_view"})
    track_as("manager", sub=str(uuid.uuid4()))
    await client.post(f"/track/location/{location.id}", json={"event": "page_view"})
    track_as("registered_user", sub=str(uuid.uuid4()))
    await client.post(f"/track/location/{location.id}", json={"event": "page_view"})

    row = (await _rows(db_session, location.id))[0]
    await db_session.refresh(row)
    assert row.page_views == 3


@pytest.mark.asyncio
async def test_track_does_not_require_auth_or_fail_on_garbage_token(client, db_session, as_anonymous):
    _, _, location = await _setup(db_session)
    r = await client.post(
        f"/track/location/{location.id}",
        json={"event": "page_view"},
        headers={"Authorization": "Bearer not-a-real-token"},
    )
    assert r.status_code == 204
    row = (await _rows(db_session, location.id))[0]
    await db_session.refresh(row)
    assert row.page_views == 1


@pytest.mark.asyncio
async def test_counters_cascade_with_the_location(client, db_session, as_anonymous):
    _, _, location = await _setup(db_session)
    await client.post(f"/track/location/{location.id}", json={"event": "page_view"})
    assert len(await _rows(db_session, location.id)) == 1
    await db_session.delete(location)
    await db_session.commit()
    assert (await db_session.execute(select(LocationDailyStat))).scalars().all() == []


# --- reading ---------------------------------------------------------------


async def _seed_stats(db_session, location_id, by_offset: dict[int, int]):
    """`by_offset`: days ago -> page_views."""
    for days_ago, views in by_offset.items():
        db_session.add(
            LocationDailyStat(
                location_id=location_id,
                stat_date=today_utc() - timedelta(days=days_ago),
                page_views=views,
                deal_views=views,
            )
        )
    await db_session.commit()


@pytest.mark.asyncio
async def test_owner_reads_series_totals_and_period_change(client, db_session, as_user):
    owner, brand, location = await _setup(db_session)
    await _seed_stats(db_session, location.id, {0: 5, 3: 5, 8: 10, 20: 99})  # 7d: 10 now vs 10 before(8 days ago)
    await create_follow(db_session, brand_id=brand.id)
    await create_follow(db_session, brand_id=brand.id)
    await create_deal(db_session, location_id=location.id, is_active=True)
    await create_deal(db_session, location_id=location.id, is_active=False)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    r = await client.get(f"/locations/{location.id}/analytics?days=7")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["days"] == 7 and body["timezone"] == "UTC"
    assert len(body["series"]) == 7
    assert body["series"][-1]["date"] == today_utc().isoformat()
    assert body["series"][-1]["page_views"] == 5
    assert body["totals"]["page_views"] == 10
    assert body["previous_totals"]["page_views"] == 10
    assert body["change_pct"]["page_views"] == 0.0
    assert body["change_pct"]["phone_clicks"] is None
    assert body["follower_count"] == 2
    assert body["active_deal_count"] == 1
    assert body["data_since"] == (today_utc() - timedelta(days=20)).isoformat()

    r30 = (await client.get(f"/locations/{location.id}/analytics?days=30")).json()
    assert r30["totals"]["page_views"] == 119
    assert len(r30["series"]) == 30


@pytest.mark.asyncio
async def test_empty_location_returns_zero_filled_series_and_null_data_since(client, db_session, as_user):
    owner, _, location = await _setup(db_session)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    body = (await client.get(f"/locations/{location.id}/analytics")).json()
    assert body["days"] == 30
    assert body["data_since"] is None
    assert body["totals"]["page_views"] == 0
    assert all(p["page_views"] == 0 for p in body["series"])


@pytest.mark.asyncio
async def test_invalid_range_is_422(client, db_session, as_user):
    owner, _, location = await _setup(db_session)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    assert (await client.get(f"/locations/{location.id}/analytics?days=14")).status_code == 422


@pytest.mark.asyncio
async def test_assigned_manager_and_admin_can_read_others_cannot(client, db_session, as_user, as_anonymous):
    owner, _, location = await _setup(db_session)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location.id, user_id=manager_sub, is_active=True)
    other_owner = await create_owner(db_session)
    await db_session.commit()
    url = f"/locations/{location.id}/analytics?days=7"

    as_user("manager", sub=manager_sub)
    assert (await client.get(url)).status_code == 200
    as_user("admin")
    assert (await client.get(url)).status_code == 200

    as_user("manager", sub=str(uuid.uuid4()))  # not assigned
    assert (await client.get(url)).status_code == 403
    as_user("owner", sub=other_owner.cognito_sub, email=other_owner.email)
    assert (await client.get(url)).status_code == 403
    as_user("registered_user", sub=str(uuid.uuid4()))
    assert (await client.get(url)).status_code == 403


@pytest.mark.asyncio
async def test_revoked_manager_cannot_read(client, db_session, as_user):
    _, _, location = await _setup(db_session)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location.id, user_id=manager_sub, is_active=False)
    await db_session.commit()
    as_user("manager", sub=manager_sub)
    assert (await client.get(f"/locations/{location.id}/analytics")).status_code == 403


@pytest.mark.asyncio
async def test_anonymous_cannot_read(client, db_session, as_anonymous):
    _, _, location = await _setup(db_session)
    assert (await client.get(f"/locations/{location.id}/analytics")).status_code == 401


@pytest.mark.asyncio
async def test_brand_rollup_sums_locations_owner_and_admin_only(client, db_session, as_user):
    owner, brand, loc_a = await _setup(db_session)
    loc_b = await create_location(db_session, brand_id=brand.id)
    other_owner = await create_owner(db_session)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=loc_a.id, user_id=manager_sub, is_active=True)
    await db_session.commit()
    await _seed_stats(db_session, loc_a.id, {0: 4})
    await _seed_stats(db_session, loc_b.id, {1: 6})
    await create_follow(db_session, brand_id=brand.id)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    r = await client.get(f"/restaurants/{brand.id}/analytics?days=7")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["totals"]["page_views"] == 10
    assert body["location_count"] == 2
    assert body["follower_count"] == 1  # brand-level, counted once
    per = {row["location_id"]: row["totals"]["page_views"] for row in body["by_location"]}
    assert per == {loc_a.id: 4, loc_b.id: 6}

    as_user("admin")
    assert (await client.get(f"/restaurants/{brand.id}/analytics")).status_code == 200
    as_user("owner", sub=other_owner.cognito_sub, email=other_owner.email)
    assert (await client.get(f"/restaurants/{brand.id}/analytics")).status_code == 403
    as_user("manager", sub=manager_sub)
    assert (await client.get(f"/restaurants/{brand.id}/analytics")).status_code == 403
