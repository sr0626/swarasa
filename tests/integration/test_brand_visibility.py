"""Integration tests: a brand is publicly readable only while it has at least
one `active` location (docs/API_CONTRACTS.md "GET /restaurants/{id}").

Found in the UAT run: imported, unreviewed listings (hidden `import_review`
locations) were still readable by anyone who guessed the name.
"""
from __future__ import annotations

import uuid

import pytest

import app.main as app_main
from app.dependencies.auth import get_current_user_optional
from factories import create_brand, create_location, create_location_manager, create_owner

HIDDEN_STATUSES = ["import_review", "coming_soon", "owner_deactivated", "closed_pending_reopen"]


def _signed_in(as_user, role, *, sub=None):
    user = as_user(role, sub=sub)

    async def _override():
        return user

    app_main.app.dependency_overrides[get_current_user_optional] = _override


async def _status_codes(client, brand) -> list[int]:
    return [
        (await client.get(path)).status_code
        for path in (
            f"/restaurants/{brand.id}",
            f"/restaurants/{brand.slug}",
            f"/restaurants/by-slug/{brand.slug}",
        )
    ]


async def _hidden_brand(db_session, status="import_review", **brand_fields):
    brand = await create_brand(db_session, **brand_fields)
    location = await create_location(db_session, brand_id=brand.id, status=status)
    await db_session.commit()
    return brand, location


@pytest.mark.asyncio
@pytest.mark.parametrize("status", HIDDEN_STATUSES)
@pytest.mark.parametrize("claimed", [True, False])
async def test_hidden_brand_is_404_for_the_public(client, db_session, status, claimed):
    owner = await create_owner(db_session) if claimed else None
    brand, _ = await _hidden_brand(
        db_session, status, owner_id=owner.id if owner else None, is_claimed=claimed
    )

    assert await _status_codes(client, brand) == [404, 404, 404]


@pytest.mark.asyncio
async def test_brand_without_any_location_is_404_for_the_public(client, db_session):
    brand = await create_brand(db_session)
    await db_session.commit()

    assert await _status_codes(client, brand) == [404, 404, 404]


@pytest.mark.asyncio
async def test_one_active_location_makes_the_brand_public(client, db_session):
    brand, _ = await _hidden_brand(db_session)
    await create_location(db_session, brand_id=brand.id, status="active")
    await db_session.commit()

    assert await _status_codes(client, brand) == [200, 200, 200]


@pytest.mark.asyncio
async def test_admin_and_owner_can_still_read_a_hidden_brand(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand, _ = await _hidden_brand(db_session, owner_id=owner.id, is_claimed=True)

    for role, sub in (("admin", None), ("owner", owner.cognito_sub)):
        _signed_in(as_user, role, sub=sub)
        assert await _status_codes(client, brand) == [200, 200, 200], role

    body = (await client.get(f"/restaurants/by-slug/{brand.slug}")).json()
    assert body["locations"] == []
    assert body["follower_count"] is None


@pytest.mark.asyncio
async def test_only_an_active_manager_of_the_brand_can_read_it(client, db_session, as_user):
    brand, location = await _hidden_brand(db_session)
    assigned, removed = str(uuid.uuid4()), str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location.id, user_id=assigned, is_active=True)
    await create_location_manager(db_session, location_id=location.id, user_id=removed, is_active=False)
    await db_session.commit()

    _signed_in(as_user, "manager", sub=assigned)
    assert await _status_codes(client, brand) == [200, 200, 200]
    _signed_in(as_user, "manager", sub=removed)
    assert await _status_codes(client, brand) == [404, 404, 404]


@pytest.mark.asyncio
async def test_other_owners_and_diners_cannot_read_a_hidden_brand(client, db_session, as_user):
    owner = await create_owner(db_session)
    other = await create_owner(db_session)
    brand, _ = await _hidden_brand(db_session, owner_id=owner.id, is_claimed=True)

    for role, sub in (("owner", other.cognito_sub), ("registered_user", None), ("manager", None)):
        _signed_in(as_user, role, sub=sub)
        assert await _status_codes(client, brand) == [404, 404, 404], role
