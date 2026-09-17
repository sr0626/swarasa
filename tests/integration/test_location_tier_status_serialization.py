"""Integration tests for `docs/PROJECT_PLAN.csv` "Serialize paid_until/
is_active on location endpoints + let owner see own deactivated
locations" — a real gap found during PR #77's review: `paid_until` and
`is_active` are stored `restaurant_location` columns that neither
`GET /restaurants/{id}/locations` nor `GET /locations/{id}` serialized,
and the (only) locations-list endpoint filtered to `is_active=true`
unconditionally, so an owner could never see their own deactivated
location.

Covers:
  - both fields now appear in both responses' JSON.
  - a deactivated location is excluded from an anonymous/public caller's
    list (the regression this suite must never allow — public/search-style
    listing must keep hiding a deactivated location).
  - a deactivated location IS included when the caller is the owning
    owner, or an admin.
  - a deactivated location stays excluded for an authenticated caller who
    is NOT this brand's owner (a different owner) — proves the new
    include-inactive branch is scoped to ownership, not "any owner role".

`GET /restaurants/{id}/locations` uses a separate optional-auth dependency
(`get_current_user_optional`, `app/dependencies/auth.py`) rather than the
shared `get_current_user` the `as_user` fixture overrides (conftest.py) —
so this file overrides `get_current_user_optional` directly instead of
using that fixture, same in-process ASGI + SQLite pattern as every other
file in this directory.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

import app.main as app_main
from app.dependencies.auth import CurrentUser, get_current_user_optional
from factories import create_brand, create_location, create_owner


def _as_optional_user(role: str, *, sub: str | None = None) -> CurrentUser:
    """Local equivalent of conftest.py's `as_user` fixture, but for
    `get_current_user_optional` (see module docstring for why a separate
    one is needed)."""
    user = CurrentUser(
        cognito_sub=sub or str(uuid.uuid4()),
        email=f"{uuid.uuid4().hex[:10]}@example.com",
        role=role,
    )

    async def _override():
        return user

    app_main.app.dependency_overrides[get_current_user_optional] = _override
    return user


def _future() -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=30)


@pytest.mark.asyncio
async def test_get_location_serializes_paid_until_and_is_active(client, db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    paid_until = _future()
    location = await create_location(
        db_session, brand_id=brand.id, is_paid=True, paid_until=paid_until, is_active=True
    )
    await db_session.commit()

    response = await client.get(f"/locations/{location.id}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["is_active"] is True
    assert body["paid_until"] is not None
    assert body["paid_until"].startswith(paid_until.date().isoformat())


@pytest.mark.asyncio
async def test_get_location_serializes_null_paid_until_on_free_tier(client, db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(
        db_session, brand_id=brand.id, is_paid=False, paid_until=None, is_active=True
    )
    await db_session.commit()

    response = await client.get(f"/locations/{location.id}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["is_paid"] is False
    assert body["paid_until"] is None
    assert body["is_active"] is True


@pytest.mark.asyncio
async def test_list_locations_serializes_paid_until_and_is_active(client, db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    paid_until = _future()
    await create_location(
        db_session, brand_id=brand.id, is_paid=True, paid_until=paid_until, is_active=True
    )
    await db_session.commit()

    response = await client.get(f"/restaurants/{brand.id}/locations")
    assert response.status_code == 200, response.text
    results = response.json()["results"]
    assert len(results) == 1
    assert results[0]["is_active"] is True
    assert results[0]["paid_until"] is not None


@pytest.mark.asyncio
async def test_public_list_excludes_deactivated_location(client, db_session):
    """The regression this whole file guards against: a public/anonymous
    caller must keep NOT seeing a deactivated location, same as before
    this change — this is the one thing that must not regress.
    """
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    active = await create_location(db_session, brand_id=brand.id, is_active=True)
    inactive = await create_location(db_session, brand_id=brand.id, is_active=False)
    await db_session.commit()

    response = await client.get(f"/restaurants/{brand.id}/locations")
    assert response.status_code == 200, response.text
    ids = [row["id"] for row in response.json()["results"]]
    assert active.id in ids
    assert inactive.id not in ids
    assert response.json()["total"] == 1


@pytest.mark.asyncio
async def test_owning_owner_sees_own_deactivated_location_in_list(client, db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    active = await create_location(db_session, brand_id=brand.id, is_active=True)
    inactive = await create_location(db_session, brand_id=brand.id, is_active=False)
    await db_session.commit()

    _as_optional_user("owner", sub=owner.cognito_sub)

    response = await client.get(f"/restaurants/{brand.id}/locations")
    assert response.status_code == 200, response.text
    body = response.json()
    ids = {row["id"]: row["is_active"] for row in body["results"]}
    assert ids == {active.id: True, inactive.id: False}
    assert body["total"] == 2


@pytest.mark.asyncio
async def test_admin_sees_deactivated_location_in_list(client, db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    active = await create_location(db_session, brand_id=brand.id, is_active=True)
    inactive = await create_location(db_session, brand_id=brand.id, is_active=False)
    await db_session.commit()

    _as_optional_user("admin")

    response = await client.get(f"/restaurants/{brand.id}/locations")
    assert response.status_code == 200, response.text
    ids = {row["id"] for row in response.json()["results"]}
    assert ids == {active.id, inactive.id}


@pytest.mark.asyncio
async def test_non_owning_owner_still_only_sees_active_locations(client, db_session):
    """A different owner's brand's deactivated location must NOT leak to
    an authenticated owner who doesn't own it — the include-inactive
    branch is scoped by actual brand ownership, not just role=="owner".
    """
    brand_owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=brand_owner.id, is_claimed=True)
    active = await create_location(db_session, brand_id=brand.id, is_active=True)
    inactive = await create_location(db_session, brand_id=brand.id, is_active=False)

    other_owner = await create_owner(db_session)
    await db_session.commit()

    _as_optional_user("owner", sub=other_owner.cognito_sub)

    response = await client.get(f"/restaurants/{brand.id}/locations")
    assert response.status_code == 200, response.text
    ids = [row["id"] for row in response.json()["results"]]
    assert active.id in ids
    assert inactive.id not in ids


@pytest.mark.asyncio
async def test_registered_user_still_only_sees_active_locations(client, db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    active = await create_location(db_session, brand_id=brand.id, is_active=True)
    inactive = await create_location(db_session, brand_id=brand.id, is_active=False)
    await db_session.commit()

    _as_optional_user("registered_user")

    response = await client.get(f"/restaurants/{brand.id}/locations")
    assert response.status_code == 200, response.text
    ids = [row["id"] for row in response.json()["results"]]
    assert active.id in ids
    assert inactive.id not in ids
