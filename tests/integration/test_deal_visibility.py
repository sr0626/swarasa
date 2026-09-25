"""Integration tests: public deal visibility gating on `GET
/locations/{id}` — `has_deal_today` (the boolean "fact," always public) vs.
`deals_today` (the gated content array). See
`app/services/deal_service.py::caller_may_view_deal_content_for_location`
and docs/DECISIONS.md "Deals engine: free-tier, public-signal +
registered-user-content visibility" (2026-09-25 amendment).

RULE (user decision 2026-09-25): ANY signed-in caller — registered_user,
the owning owner, an owner of ANOTHER brand, an assigned or unassigned
manager, admin — gets deal content; only an anonymous caller gets `null`
(boolean signal only). `deals_hidden` and inactive deals still suppress
content for everyone. (The two tests that used to assert "unassigned
manager" / "different owner" get `null` were changed deliberately.)
"""
from __future__ import annotations

import uuid

import pytest

import app.main as app_main
from app.dependencies.auth import CurrentUser, get_current_user_optional
from factories import create_brand, create_deal, create_location, create_location_manager, create_owner


def _as_optional_user(role: str, *, sub: str | None = None, email: str | None = None) -> CurrentUser:
    """`GET /locations/{id}` depends on `get_current_user_optional` (public
    by default), not the shared `get_current_user` the `as_user` fixture
    overrides (tests/integration/conftest.py) — same pattern already
    established in test_location_status_visibility.py /
    test_location_tier_status_serialization.py, duplicated here per those
    files' own "keep this PR's diff scoped to its own test files" note
    rather than promoted to conftest.py."""
    user = CurrentUser(
        cognito_sub=sub or str(uuid.uuid4()),
        email=email if email is not None else f"{uuid.uuid4().hex[:10]}@example.com",
        role=role,
    )

    async def _override():
        return user

    app_main.app.dependency_overrides[get_current_user_optional] = _override
    return user


@pytest.mark.asyncio
async def test_anonymous_sees_boolean_only_when_deal_exists(client, db_session, as_anonymous):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    await create_deal(db_session, location_id=location.id, title="Secret Sauce", is_active=True)
    await db_session.commit()

    response = await client.get(f"/locations/{location.id}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["has_deal_today"] is True
    assert body["deals_today"] is None
    assert "Secret Sauce" not in response.text


@pytest.mark.asyncio
async def test_anonymous_sees_false_and_null_when_no_deal(client, db_session, as_anonymous):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    response = await client.get(f"/locations/{location.id}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["has_deal_today"] is False
    assert body["deals_today"] is None


@pytest.mark.asyncio
async def test_registered_user_sees_real_content(client, db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    await create_deal(
        db_session,
        location_id=location.id,
        title="Buy 1 Get 1 Biryani",
        description="Dine-in only",
        is_active=True,
    )
    await db_session.commit()

    _as_optional_user("registered_user")
    response = await client.get(f"/locations/{location.id}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["has_deal_today"] is True
    assert body["deals_today"] is not None
    assert len(body["deals_today"]) == 1
    assert body["deals_today"][0]["title"] == "Buy 1 Get 1 Biryani"
    assert body["deals_today"][0]["description"] == "Dine-in only"


@pytest.mark.asyncio
async def test_registered_user_gets_empty_array_not_null_when_no_deal(client, db_session):
    """Distinguishes "content withheld" (null) from "no deals today" ([])
    — a registered_user who CAN see content but there simply is none gets
    an empty array, not null."""
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    _as_optional_user("registered_user")
    response = await client.get(f"/locations/{location.id}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["has_deal_today"] is False
    assert body["deals_today"] == []


@pytest.mark.asyncio
async def test_owning_owner_sees_content_on_public_detail_page(client, db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    await create_deal(db_session, location_id=location.id, title="Owner's Own Deal", is_active=True)
    await db_session.commit()

    _as_optional_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.get(f"/locations/{location.id}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["deals_today"] is not None
    assert body["deals_today"][0]["title"] == "Owner's Own Deal"


@pytest.mark.asyncio
async def test_assigned_manager_sees_content(client, db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    await create_deal(db_session, location_id=location.id, title="Manager Visible Deal", is_active=True)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location.id, user_id=manager_sub, is_active=True)
    await db_session.commit()

    _as_optional_user("manager", sub=manager_sub)
    response = await client.get(f"/locations/{location.id}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["deals_today"] is not None
    assert body["deals_today"][0]["title"] == "Manager Visible Deal"


@pytest.mark.asyncio
async def test_unassigned_manager_now_sees_content(client, db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    await create_deal(db_session, location_id=location.id, title="Hidden From This Manager", is_active=True)
    await db_session.commit()

    _as_optional_user("manager", sub=str(uuid.uuid4()))  # not assigned to this location
    response = await client.get(f"/locations/{location.id}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["has_deal_today"] is True
    assert [d["title"] for d in body["deals_today"]] == ["Hidden From This Manager"]


@pytest.mark.asyncio
async def test_different_owner_now_sees_content(client, db_session):
    owner_a = await create_owner(db_session)
    owner_b = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner_a.id)
    location = await create_location(db_session, brand_id=brand.id)
    await create_deal(db_session, location_id=location.id, title="Not Owner B's", is_active=True)
    await db_session.commit()

    _as_optional_user("owner", sub=owner_b.cognito_sub, email=owner_b.email)
    response = await client.get(f"/locations/{location.id}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["has_deal_today"] is True
    assert [d["title"] for d in body["deals_today"]] == ["Not Owner B's"]


@pytest.mark.asyncio
async def test_admin_sees_content(client, db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    await create_deal(db_session, location_id=location.id, title="Admin Sees All", is_active=True)
    await db_session.commit()

    _as_optional_user("admin")
    response = await client.get(f"/locations/{location.id}")
    assert response.status_code == 200, response.text
    assert response.json()["deals_today"][0]["title"] == "Admin Sees All"


@pytest.mark.asyncio
async def test_inactive_deal_never_shows_even_to_registered_user(client, db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    await create_deal(db_session, location_id=location.id, title="Paused Deal", is_active=False)
    await db_session.commit()

    _as_optional_user("registered_user")
    response = await client.get(f"/locations/{location.id}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["has_deal_today"] is False
    assert body["deals_today"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["registered_user", "owner", "manager", "admin"])
async def test_every_signed_in_role_sees_deals_and_upcoming_unrelated_to_location(
    client, db_session, role
):
    """Matrix: a caller with NO relationship to the location (random sub, no
    owner account / manager row) still gets both content arrays."""
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    await create_deal(db_session, location_id=location.id, title="Everyday Special", is_active=True)
    await db_session.commit()

    _as_optional_user(role)
    body = (await client.get(f"/locations/{location.id}")).json()
    assert body["has_deal_today"] is True
    assert [d["title"] for d in body["deals_today"]] == ["Everyday Special"]
    assert body["upcoming_deals"] == []


@pytest.mark.asyncio
async def test_anonymous_gets_null_for_both_content_arrays(client, db_session, as_anonymous):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    await create_deal(db_session, location_id=location.id, title="Everyday Special", is_active=True)
    await db_session.commit()

    body = (await client.get(f"/locations/{location.id}")).json()
    assert body["has_deal_today"] is True
    assert body["deals_today"] is None
    assert body["upcoming_deals"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["registered_user", "owner", "manager", "admin"])
async def test_deals_hidden_suppresses_content_for_every_signed_in_role(client, db_session, role):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    await create_deal(db_session, location_id=location.id, title="Hidden By Switch", is_active=True)
    location.deals_hidden = True
    await db_session.commit()

    _as_optional_user(role)
    body = (await client.get(f"/locations/{location.id}")).json()
    assert body["has_deal_today"] is False
    assert body["deals_today"] == []
    assert body["upcoming_deals"] == []
    assert "Hidden By Switch" not in str(body)


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["owner", "manager", "admin"])
async def test_inactive_deal_suppressed_for_every_signed_in_role(client, db_session, role):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    await create_deal(db_session, location_id=location.id, title="Paused Deal", is_active=False)
    await db_session.commit()

    _as_optional_user(role)
    body = (await client.get(f"/locations/{location.id}")).json()
    assert body["has_deal_today"] is False
    assert body["deals_today"] == []
    assert body["upcoming_deals"] == []
