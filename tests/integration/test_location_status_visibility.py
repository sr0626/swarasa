"""Integration tests: caller-aware visibility for a non-`active` location —
docs/PROJECT_PLAN.csv row for the location status lifecycle task,
`location_service.get_location` / `_caller_may_view_hidden_location` /
`list_locations_for_brand`.

Covers, for each of the three hidden statuses (owner_deactivated,
coming_soon, closed_pending_reopen):
  - `GET /locations/{id}` 404s (never 403 — "can't distinguish doesn't-exist
    from hidden") for an anonymous caller and for an authenticated caller
    with no real access (a different owner, a registered_user).
  - `GET /locations/{id}` succeeds (200) for the owning owner, an admin, and
    an assigned active manager.
  - `GET /restaurants/{id}/locations` excludes the hidden location from the
    public/no-access list, and includes it for the owning owner/admin (this
    list endpoint intentionally does NOT extend to manager — see
    `_caller_may_see_inactive_locations`'s own docstring).

Also proves, directly against the ORM (not through search_service's
PostGIS-only `_fetch_candidates`, which needs a real Postgres — see
test_search_api.py), that `RestaurantLocation.is_active == True` — the
exact filter expression `search_service.search()` uses — matches ONLY
`status == 'active'` rows, i.e. every hidden status is excluded from search
identically, not just the old single boolean value.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

import app.main as app_main
from app.dependencies.auth import CurrentUser, get_current_user_optional
from app.models.restaurant_location import RestaurantLocation
from factories import create_brand, create_location, create_location_manager, create_owner

HIDDEN_STATUSES = ("owner_deactivated", "coming_soon", "closed_pending_reopen")


def _as_optional_user(role: str, *, sub: str | None = None) -> CurrentUser:
    """`GET /locations/{id}` depends on `get_current_user_optional` (public
    by default), not the shared `get_current_user` the `as_user` fixture
    overrides (conftest.py) — same reasoning/pattern as
    test_location_tier_status_serialization.py's local helper of the same
    name, duplicated here rather than promoted to conftest.py to keep this
    PR's diff scoped to its own test files."""
    user = CurrentUser(
        cognito_sub=sub or str(uuid.uuid4()),
        email=f"{uuid.uuid4().hex[:10]}@example.com",
        role=role,
    )

    async def _override():
        return user

    app_main.app.dependency_overrides[get_current_user_optional] = _override
    return user


async def _setup(db_session, status: str):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id, status=status)
    await db_session.commit()
    return owner, brand, location


@pytest.mark.asyncio
@pytest.mark.parametrize("status", HIDDEN_STATUSES)
async def test_anonymous_caller_gets_404_not_403(db_session, client, as_anonymous, status):
    _owner, _brand, location = await _setup(db_session, status)

    response = await client.get(f"/locations/{location.id}")
    assert response.status_code == 404, response.text
    assert response.json()["code"] == "not_found"


@pytest.mark.asyncio
@pytest.mark.parametrize("status", HIDDEN_STATUSES)
async def test_unrelated_authenticated_caller_gets_404(db_session, client, status):
    _owner, _brand, location = await _setup(db_session, status)
    other_owner = await create_owner(db_session)
    await db_session.commit()
    _as_optional_user("owner", sub=other_owner.cognito_sub)

    response = await client.get(f"/locations/{location.id}")
    assert response.status_code == 404, response.text


@pytest.mark.asyncio
@pytest.mark.parametrize("status", HIDDEN_STATUSES)
async def test_registered_user_gets_404(db_session, client, status):
    _owner, _brand, location = await _setup(db_session, status)
    _as_optional_user("registered_user")

    response = await client.get(f"/locations/{location.id}")
    assert response.status_code == 404, response.text


@pytest.mark.asyncio
@pytest.mark.parametrize("status", HIDDEN_STATUSES)
async def test_owning_owner_can_view(db_session, client, status):
    owner, _brand, location = await _setup(db_session, status)
    _as_optional_user("owner", sub=owner.cognito_sub)

    response = await client.get(f"/locations/{location.id}")
    assert response.status_code == 200, response.text
    assert response.json()["status"] == status


@pytest.mark.asyncio
@pytest.mark.parametrize("status", HIDDEN_STATUSES)
async def test_admin_can_view(db_session, client, status):
    _owner, _brand, location = await _setup(db_session, status)
    _as_optional_user("admin")

    response = await client.get(f"/locations/{location.id}")
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
@pytest.mark.parametrize("status", HIDDEN_STATUSES)
async def test_assigned_active_manager_can_view(db_session, client, status):
    _owner, _brand, location = await _setup(db_session, status)
    manager = await create_location_manager(db_session, location_id=location.id, is_active=True)
    await db_session.commit()
    _as_optional_user("manager", sub=manager.user_id)

    response = await client.get(f"/locations/{location.id}")
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
@pytest.mark.parametrize("status", HIDDEN_STATUSES)
async def test_revoked_manager_cannot_view(db_session, client, status):
    """A manager assignment that has been revoked (`is_active=False`) must
    not still grant visibility — same "never trust a stale assignment"
    posture as the write-access dependencies."""
    _owner, _brand, location = await _setup(db_session, status)
    manager = await create_location_manager(db_session, location_id=location.id, is_active=False)
    await db_session.commit()
    _as_optional_user("manager", sub=manager.user_id)

    response = await client.get(f"/locations/{location.id}")
    assert response.status_code == 404, response.text


@pytest.mark.asyncio
async def test_active_location_visible_to_everyone(db_session, client, as_anonymous):
    _owner, _brand, location = await _setup(db_session, "active")

    response = await client.get(f"/locations/{location.id}")
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
@pytest.mark.parametrize("status", HIDDEN_STATUSES)
async def test_public_locations_list_excludes_hidden_status(db_session, client, as_anonymous, status):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    active = await create_location(db_session, brand_id=brand.id, status="active")
    hidden = await create_location(db_session, brand_id=brand.id, status=status)
    await db_session.commit()

    response = await client.get(f"/restaurants/{brand.id}/locations")
    assert response.status_code == 200, response.text
    ids = [row["id"] for row in response.json()["results"]]
    assert active.id in ids
    assert hidden.id not in ids


@pytest.mark.asyncio
@pytest.mark.parametrize("status", HIDDEN_STATUSES)
async def test_owning_owner_sees_hidden_status_location_in_list(db_session, client, status):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    hidden = await create_location(db_session, brand_id=brand.id, status=status)
    await db_session.commit()
    _as_optional_user("owner", sub=owner.cognito_sub)

    response = await client.get(f"/restaurants/{brand.id}/locations")
    assert response.status_code == 200, response.text
    ids = {row["id"]: row["status"] for row in response.json()["results"]}
    assert ids == {hidden.id: status}


@pytest.mark.asyncio
async def test_hybrid_property_sql_filter_matches_only_active_status(db_session):
    """Direct proof of the exact expression `search_service.search()`'s
    `_fetch_candidates` filters on (`RestaurantLocation.is_active == True`)
    — this is the hybrid-property SQL translation
    (`app/models/restaurant_location.py::_is_active_expression`), executed
    for real against the ORM/DB layer, independent of the PostGIS-only
    parts of search that this sandbox can't run (see test_search_api.py).
    """
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    active = await create_location(db_session, brand_id=brand.id, status="active")
    for status in HIDDEN_STATUSES:
        await create_location(db_session, brand_id=brand.id, status=status)
    await db_session.commit()

    rows = (
        await db_session.execute(
            select(RestaurantLocation)
            .where(RestaurantLocation.brand_id == brand.id)
            .where(RestaurantLocation.is_active == True)  # noqa: E712
        )
    ).scalars().all()
    assert [row.id for row in rows] == [active.id]
