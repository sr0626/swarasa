"""Integration tests: the location-level "Hide all deals" switch
(`restaurant_location.deals_hidden`, 2026-09-24) — `PUT
/locations/{id}/deals/visibility`.

The point of the design is that suppression lives in ONE place
(`deal_service.get_active_deals_map`), so every public deal surface follows.
One test per surface proves none is missed:

  - `GET /locations/{id}`: `has_deal_today`, `deals_today`, `upcoming_deals`
  - `GET /auth/me/follows`: `has_deal_today` / `deal_titles_today`
  - `GET /search` service: nearest-location badge AND the `has_deals_today`
    filter (real DB, only the PostGIS candidate query is stubbed — the real
    endpoint needs PostGIS, see test_search_api.py)
  - the shared map itself (tile badges and landing cards are all derived
    from search/follow results)

Plus: defaults visible, the per-deal `is_active` toggle stays independent,
nothing is deleted (management list still shows every deal), permissions
matrix, audit rows, and a sibling location of the same brand is unaffected.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import func, select

import app.main as app_main
from app.dependencies.auth import CurrentUser, get_current_user, get_current_user_optional
from app.dependencies.pagination import Pagination
from app.models.audit_log import AuditLog
from app.models.deal import Deal
from app.services import deal_service, search_service
from factories import (
    create_brand,
    create_deal,
    create_follow,
    create_location,
    create_location_manager,
    create_owner,
)

_TZ = ZoneInfo("America/Chicago")


def _today() -> int:
    return datetime.now(_TZ).weekday()


def _other_day() -> int:
    return (_today() + 1) % 7


def _as_optional_user(role: str, *, sub: str | None = None) -> CurrentUser:
    user = CurrentUser(
        cognito_sub=sub or str(uuid.uuid4()), email=f"{uuid.uuid4().hex[:10]}@example.com", role=role
    )

    async def _override():
        return user

    app_main.app.dependency_overrides[get_current_user_optional] = _override
    return user


async def _setup(db_session):
    """One owner/brand, one location with a deal live today and a deal that
    only runs on another weekday (-> `upcoming_deals`)."""
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id)
    today_deal = await create_deal(db_session, location_id=location.id, title="Lunch buffet")
    later_deal = await create_deal(
        db_session, location_id=location.id, title="Weekend brunch", applicable_days=[_other_day()]
    )
    await db_session.commit()
    return owner, brand, location, today_deal, later_deal


def _url(location_id: int) -> str:
    return f"/locations/{location_id}/deals/visibility"


async def _detail(client, location_id: int) -> dict:
    response = await client.get(f"/locations/{location_id}")
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------------------
# Defaults + the management view
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_default_is_visible_and_management_list_reports_the_flag(client, db_session, as_user):
    owner, _brand, location, _t, _l = await _setup(db_session)
    as_user("owner", sub=owner.cognito_sub)

    assert location.deals_hidden is False
    listing = await client.get(f"/locations/{location.id}/deals")
    assert listing.status_code == 200, listing.text
    assert listing.json()["deals_hidden"] is False
    assert len(listing.json()["results"]) == 2

    hidden = await client.put(_url(location.id), json={"is_hidden": True})
    assert hidden.status_code == 200, hidden.text
    assert hidden.json() == {"location_id": location.id, "is_hidden": True}

    listing = await client.get(f"/locations/{location.id}/deals")
    body = listing.json()
    assert body["deals_hidden"] is True
    # Hiding never deletes or touches a deal: the editor still sees them all,
    # with their own is_active untouched.
    assert sorted(d["title"] for d in body["results"]) == ["Lunch buffet", "Weekend brunch"]
    assert all(d["is_active"] is True for d in body["results"])
    assert (await db_session.execute(select(func.count()).select_from(Deal))).scalar_one() == 2


# ---------------------------------------------------------------------------
# One test per public surface
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_surface_location_detail(client, db_session, as_user):
    owner, _brand, location, _t, _l = await _setup(db_session)
    as_user("owner", sub=owner.cognito_sub)

    _as_optional_user("registered_user")
    before = await _detail(client, location.id)
    assert before["has_deal_today"] is True
    assert [d["title"] for d in before["deals_today"]] == ["Lunch buffet"]
    assert [d["title"] for d in before["upcoming_deals"]] == ["Weekend brunch"]

    assert (await client.put(_url(location.id), json={"is_hidden": True})).status_code == 200

    # Registered user (content viewer): no signal, no content, nothing upcoming.
    after = await _detail(client, location.id)
    assert after["has_deal_today"] is False
    assert after["deals_today"] == []
    assert after["upcoming_deals"] == []

    # Anonymous: the content-free signal is gone too.
    app_main.app.dependency_overrides.pop(get_current_user_optional, None)
    anon = await _detail(client, location.id)
    assert anon["has_deal_today"] is False
    assert "Lunch buffet" not in str(anon) and "Weekend brunch" not in str(anon)

    # The owner sees what diners see on the public page.
    _as_optional_user("owner", sub=owner.cognito_sub)
    own = await _detail(client, location.id)
    assert own["has_deal_today"] is False and own["deals_today"] == []

    # Show again: everything returns.
    assert (await client.put(_url(location.id), json={"is_hidden": False})).status_code == 200
    _as_optional_user("registered_user")
    restored = await _detail(client, location.id)
    assert restored["has_deal_today"] is True
    assert [d["title"] for d in restored["deals_today"]] == ["Lunch buffet"]
    assert [d["title"] for d in restored["upcoming_deals"]] == ["Weekend brunch"]


@pytest.mark.asyncio
async def test_surface_follow_list(client, db_session, as_user):
    owner, brand, location, _t, _l = await _setup(db_session)
    sub = str(uuid.uuid4())
    await create_follow(db_session, user_id=sub, brand_id=brand.id)
    await db_session.commit()

    async def follow_row():
        as_user("registered_user", sub=sub)
        response = await client.get("/auth/me/follows")
        assert response.status_code == 200, response.text
        return {r["brand_id"]: r for r in response.json()["results"]}[brand.id]

    row = await follow_row()
    assert row["has_deal_today"] is True and row["deal_titles_today"] == ["Lunch buffet"]

    as_user("owner", sub=owner.cognito_sub)
    assert (await client.put(_url(location.id), json={"is_hidden": True})).status_code == 200

    row = await follow_row()
    assert row["has_deal_today"] is False
    assert row["deal_titles_today"] == []
    assert row["nearest_location"]["has_deal_today"] is False

    as_user("owner", sub=owner.cognito_sub)
    assert (await client.put(_url(location.id), json={"is_hidden": False})).status_code == 200
    assert (await follow_row())["has_deal_today"] is True


async def _search(db_session, location, *, has_deals_today=None):
    """The real `search_service.search` against the real (SQLite) DB — only
    the PostGIS radius query is stubbed with this one location."""

    async def _fake_fetch(*args, **kwargs):
        return [
            search_service._CandidateRow(
                location_id=location.id,
                brand_id=location.brand_id,
                address_line1=location.address_line1,
                city=location.city,
                state=location.state,
                postal_code=location.postal_code,
                phone=location.phone,
                is_verified=False,
                is_paid=False,
                timezone=location.timezone,
                distance_mi=1.0,
            )
        ]

    original = search_service._fetch_candidates
    search_service._fetch_candidates = _fake_fetch
    try:
        results, total = await search_service.search(
            db_session,
            32.8,
            -96.9,
            15,
            None,
            None,
            None,
            Pagination(page=1, page_size=20),
            has_deals_today=has_deals_today,
        )
    finally:
        search_service._fetch_candidates = original
    return results, total


@pytest.mark.asyncio
async def test_surface_search_badge_and_has_deals_today_filter(client, db_session, as_user):
    owner, _brand, location, _t, _l = await _setup(db_session)

    results, total = await _search(db_session, location)
    assert results[0].nearest_location.has_deal_today is True
    _results, total = await _search(db_session, location, has_deals_today=True)
    assert total == 1

    as_user("owner", sub=owner.cognito_sub)
    assert (await client.put(_url(location.id), json={"is_hidden": True})).status_code == 200
    await db_session.commit()

    results, total = await _search(db_session, location)
    assert total == 1  # still listed…
    assert results[0].nearest_location.has_deal_today is False  # …but no badge
    filtered, filtered_total = await _search(db_session, location, has_deals_today=True)
    assert (filtered, filtered_total) == ([], 0)  # the filter drops it

    assert (await client.put(_url(location.id), json={"is_hidden": False})).status_code == 200
    await db_session.commit()
    _results, total = await _search(db_session, location, has_deals_today=True)
    assert total == 1


@pytest.mark.asyncio
async def test_surface_shared_active_deals_map_is_the_single_choke_point(client, db_session, as_user):
    """Tile badges / landing cards are derived from search + follow results,
    which are derived from this map."""
    owner, _brand, location, _t, _l = await _setup(db_session)
    assert len((await deal_service.get_active_deals_map(db_session, [location.id]))[location.id]) == 2

    as_user("owner", sub=owner.cognito_sub)
    await client.put(_url(location.id), json={"is_hidden": True})
    await db_session.commit()
    assert (await deal_service.get_active_deals_map(db_session, [location.id])) == {location.id: []}
    todays, upcoming = await deal_service.todays_and_upcoming_for_location(
        db_session, location.id, location.timezone
    )
    assert todays == [] and upcoming == []
    assert (await deal_service.deals_today_for_location(db_session, location.id, location.timezone)) == []


# ---------------------------------------------------------------------------
# Independence: per-deal toggle, sibling locations
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_per_deal_toggle_is_independent_of_hide_all(client, db_session, as_user):
    owner, _brand, location, today_deal, later_deal = await _setup(db_session)
    as_user("owner", sub=owner.cognito_sub)
    base = f"/locations/{location.id}/deals"

    # Per-deal deactivate works on its own (hide-all off).
    assert (await client.patch(f"{base}/{today_deal.id}", json={"is_active": False})).status_code == 200
    _as_optional_user("registered_user")
    assert (await _detail(client, location.id))["has_deal_today"] is False

    # Hide-all then show-all never resurrects the individually hidden deal…
    as_user("owner", sub=owner.cognito_sub)
    await client.put(_url(location.id), json={"is_hidden": True})
    await client.put(_url(location.id), json={"is_hidden": False})
    await db_session.refresh(today_deal)
    await db_session.refresh(later_deal)
    assert today_deal.is_active is False  # still individually hidden
    assert later_deal.is_active is True
    _as_optional_user("registered_user")
    body = await _detail(client, location.id)
    assert body["has_deal_today"] is False
    assert [d["title"] for d in body["upcoming_deals"]] == ["Weekend brunch"]

    # …and re-activating a deal while hide-all is on keeps it hidden publicly.
    as_user("owner", sub=owner.cognito_sub)
    await client.put(_url(location.id), json={"is_hidden": True})
    assert (await client.patch(f"{base}/{today_deal.id}", json={"is_active": True})).status_code == 200
    _as_optional_user("registered_user")
    assert (await _detail(client, location.id))["has_deal_today"] is False
    as_user("owner", sub=owner.cognito_sub)
    await client.put(_url(location.id), json={"is_hidden": False})
    _as_optional_user("registered_user")
    assert (await _detail(client, location.id))["has_deal_today"] is True


@pytest.mark.asyncio
async def test_sibling_location_of_the_same_brand_is_unaffected(client, db_session, as_user):
    owner, brand, location, _t, _l = await _setup(db_session)
    sibling = await create_location(db_session, brand_id=brand.id)
    await create_deal(db_session, location_id=sibling.id, title="Sibling deal")
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub)
    assert (await client.put(_url(location.id), json={"is_hidden": True})).status_code == 200

    _as_optional_user("registered_user")
    assert (await _detail(client, location.id))["has_deal_today"] is False
    assert (await _detail(client, sibling.id))["has_deal_today"] is True


# ---------------------------------------------------------------------------
# Permissions + audit + validation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_owner_manager_admin_can_toggle(client, db_session, as_user):
    owner, _brand, location, _t, _l = await _setup(db_session)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location.id, user_id=manager_sub, is_active=True)
    await db_session.commit()

    for role, sub in (("owner", owner.cognito_sub), ("manager", manager_sub), ("admin", None)):
        as_user(role, sub=sub)
        assert (await client.put(_url(location.id), json={"is_hidden": True})).status_code == 200, role
        assert (await client.put(_url(location.id), json={"is_hidden": False})).status_code == 200, role


@pytest.mark.asyncio
async def test_unauthorized_callers_cannot_toggle(client, db_session, as_user, as_anonymous):
    _owner, brand, location, _t, _l = await _setup(db_session)
    other_owner = await create_owner(db_session)
    other_location = await create_location(db_session, brand_id=brand.id)
    unassigned_sub = str(uuid.uuid4())
    await create_location_manager(
        db_session, location_id=other_location.id, user_id=unassigned_sub, is_active=True
    )
    await db_session.commit()

    for role, sub in (
        ("manager", unassigned_sub),
        ("owner", other_owner.cognito_sub),
        ("registered_user", None),
    ):
        as_user(role, sub=sub)
        response = await client.put(_url(location.id), json={"is_hidden": True})
        assert response.status_code == 403, (role, response.text)

    app_main.app.dependency_overrides.pop(get_current_user, None)
    assert (await client.put(_url(location.id), json={"is_hidden": True})).status_code == 401

    await db_session.refresh(location)
    assert location.deals_hidden is False


@pytest.mark.asyncio
async def test_toggle_is_audited_and_idempotent(client, db_session, as_user):
    owner, _brand, location, _t, _l = await _setup(db_session)
    as_user("owner", sub=owner.cognito_sub)

    await client.put(_url(location.id), json={"is_hidden": True})
    await client.put(_url(location.id), json={"is_hidden": True})  # no-op: no second row
    await client.put(_url(location.id), json={"is_hidden": False})

    rows = (
        (
            await db_session.execute(
                select(AuditLog)
                .where(AuditLog.table_name == "restaurant_location", AuditLog.record_id == location.id)
                .order_by(AuditLog.id)
            )
        )
        .scalars()
        .all()
    )
    assert [(r.action, r.old_val, r.new_val) for r in rows] == [
        ("update", {"deals_hidden": False}, {"deals_hidden": True}),
        ("update", {"deals_hidden": True}, {"deals_hidden": False}),
    ]
    assert rows[0].actor_id == owner.cognito_sub and rows[0].actor_role == "owner"


@pytest.mark.asyncio
async def test_validation_and_unknown_location(client, db_session, as_user):
    owner, _brand, location, _t, _l = await _setup(db_session)
    as_user("owner", sub=owner.cognito_sub)
    assert (await client.put(_url(location.id), json={})).status_code == 422
    assert (await client.put(_url(location.id), json={"is_hidden": None})).status_code == 422
    as_user("admin")
    assert (await client.put(_url(999999), json={"is_hidden": True})).status_code == 404


@pytest.mark.asyncio
async def test_expired_deals_still_excluded_when_shown_again(client, db_session, as_user):
    """Hide-all is orthogonal to the date rules: an expired deal stays gone."""
    owner, _brand, location, today_deal, _l = await _setup(db_session)
    today_deal.end_at = datetime.now(timezone.utc) - timedelta(days=1)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)
    await client.put(_url(location.id), json={"is_hidden": True})
    await client.put(_url(location.id), json={"is_hidden": False})
    _as_optional_user("registered_user")
    assert (await _detail(client, location.id))["has_deal_today"] is False
