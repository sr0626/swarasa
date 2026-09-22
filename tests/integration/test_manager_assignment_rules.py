"""Integration tests: the new `POST /locations/{id}/managers` validation
paths added alongside the configurable `platform_config` caps —
docs/DECISIONS.md "Configurable manager/location caps via platform_config",
"Symmetric manager-location cap", "Manager scoped to one owner at a time".

Runs against the real HTTP router + real `location_manager_service` +
a real (SQLite) DB, same fixture approach as
`tests/integration/test_manager_reassignment.py`. `cognito_service.
find_sub_by_email`/`find_email_by_sub` are monkeypatched via the
`cognito_directory` fixture below (a plain email->sub dict) rather than
the single-identity `manager_identity` fixture in that sibling file,
since several of these tests need more than one manager identity.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.platform_config import PlatformConfig
from app.services import location_manager_service
from factories import create_brand, create_location, create_location_manager, create_owner


@pytest.fixture
def cognito_directory(monkeypatch):
    """email -> sub. Populate per-test; any email not in the dict resolves
    to `None` (real "no such Cognito user" behavior)."""
    directory: dict[str, str] = {}

    def _find_sub_by_email(email):
        return directory.get(email)

    def _find_email_by_sub(sub):
        for email, s in directory.items():
            if s == sub:
                return email
        return None

    monkeypatch.setattr(location_manager_service.cognito_service, "find_sub_by_email", _find_sub_by_email)
    monkeypatch.setattr(location_manager_service.cognito_service, "find_email_by_sub", _find_email_by_sub)
    return directory


@pytest.mark.asyncio
async def test_unknown_email_returns_404_no_such_user(client, db_session, as_user, cognito_directory):
    """Task requirement: assigning by an email with no matching Cognito
    user returns a clear, distinct error — no invite email is sent and no
    Cognito user is created (SES is Phase-2-deferred); nothing here does
    anything except return the 404."""
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    response = await client.post(
        f"/locations/{location.id}/managers",
        json={"manager_email": "nobody-registered@example.com"},
    )
    assert response.status_code == 404
    body = response.json()
    assert body["code"] == "manager_not_found"
    assert "No registered user" in body["detail"]


@pytest.mark.asyncio
async def test_cross_owner_manager_assignment_is_rejected(client, db_session, as_user, cognito_directory):
    """A manager already active on Owner A's location cannot be assigned
    to Owner B's location — docs/DECISIONS.md "Manager scoped to one
    owner at a time"."""
    owner_a = await create_owner(db_session)
    brand_a = await create_brand(db_session, owner_id=owner_a.id, is_claimed=True)
    location_a = await create_location(db_session, brand_id=brand_a.id)

    owner_b = await create_owner(db_session)
    brand_b = await create_brand(db_session, owner_id=owner_b.id, is_claimed=True)
    location_b = await create_location(db_session, brand_id=brand_b.id)

    manager_email = "shared-manager@example.com"
    manager_sub = str(uuid.uuid4())
    cognito_directory[manager_email] = manager_sub

    # Manager already active for owner_a, set up directly (not via the API
    # — this is pre-existing state the test wants to assert AGAINST).
    await create_location_manager(db_session, location_id=location_a.id, user_id=manager_sub, is_active=True)
    await db_session.commit()

    as_user("owner", sub=owner_b.cognito_sub, email=owner_b.email)
    response = await client.post(
        f"/locations/{location_b.id}/managers", json={"manager_email": manager_email}
    )
    assert response.status_code == 409
    body = response.json()
    assert body["code"] == "manager_different_owner"


@pytest.mark.asyncio
async def test_same_owner_manager_assignment_across_brands_is_allowed(
    client, db_session, as_user, cognito_directory
):
    """Sanity check the other direction: the SAME owner assigning the same
    manager across two different brands/locations they own must NOT trip
    the cross-owner guard."""
    owner = await create_owner(db_session)
    brand_1 = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    brand_2 = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location_1 = await create_location(db_session, brand_id=brand_1.id)
    location_2 = await create_location(db_session, brand_id=brand_2.id)

    manager_email = "cross-brand-manager@example.com"
    manager_sub = str(uuid.uuid4())
    cognito_directory[manager_email] = manager_sub

    await create_location_manager(db_session, location_id=location_1.id, user_id=manager_sub, is_active=True)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.post(
        f"/locations/{location_2.id}/managers", json={"manager_email": manager_email}
    )
    assert response.status_code == 201, response.text


@pytest.mark.asyncio
async def test_manager_location_cap_reached_names_the_locations(
    client, db_session, as_user, cognito_directory
):
    """Task requirement: the symmetric manager-side cap error must NAME
    the locations the manager already manages, not just report a count."""
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location_1 = await create_location(
        db_session, brand_id=brand.id, is_paid=True, location_name="Dera Grill", city="Irving"
    )
    location_2 = await create_location(
        db_session, brand_id=brand.id, is_paid=True, location_name="Taj Chaat House", city="Plano"
    )
    location_3 = await create_location(db_session, brand_id=brand.id, is_paid=True)

    manager_email = "busy-manager@example.com"
    manager_sub = str(uuid.uuid4())
    cognito_directory[manager_email] = manager_sub

    # Manager already active on 2 paid locations (the default cap).
    await create_location_manager(db_session, location_id=location_1.id, user_id=manager_sub, is_active=True)
    await create_location_manager(db_session, location_id=location_2.id, user_id=manager_sub, is_active=True)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.post(
        f"/locations/{location_3.id}/managers", json={"manager_email": manager_email}
    )
    assert response.status_code == 409
    body = response.json()
    assert body["code"] == "manager_location_cap_reached"
    assert "Dera Grill (Irving)" in body["detail"]
    assert "Taj Chaat House (Plano)" in body["detail"]


@pytest.mark.asyncio
async def test_manager_location_cap_not_triggered_by_free_tier_assignments(
    client, db_session, as_user, cognito_directory
):
    """SCOPING: a manager already on 2 FREE-tier locations must still be
    assignable to a paid one — the cap only counts paid assignments (see
    `assert_manager_not_over_location_cap`'s docstring)."""
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    free_1 = await create_location(db_session, brand_id=brand.id, is_paid=False)
    free_2 = await create_location(db_session, brand_id=brand.id, is_paid=False)
    paid = await create_location(db_session, brand_id=brand.id, is_paid=True)

    manager_email = "free-tier-manager@example.com"
    manager_sub = str(uuid.uuid4())
    cognito_directory[manager_email] = manager_sub

    await create_location_manager(db_session, location_id=free_1.id, user_id=manager_sub, is_active=True)
    await create_location_manager(db_session, location_id=free_2.id, user_id=manager_sub, is_active=True)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.post(
        f"/locations/{paid.id}/managers", json={"manager_email": manager_email}
    )
    assert response.status_code == 201, response.text


@pytest.mark.asyncio
async def test_platform_config_row_drives_real_enforcement(
    client, db_session, as_user, cognito_directory
):
    """End-to-end proof that the cap is actually read from the
    `platform_config` table through the real router, not a hardcoded
    constant: seed the config row to 1 (instead of the default 2) and
    confirm the location-side cap now rejects at 1 active manager."""
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id, is_paid=True)

    db_session.add(PlatformConfig(key="max_active_managers_per_location", value="1"))
    await db_session.commit()

    first_email = "first-manager@example.com"
    first_sub = str(uuid.uuid4())
    cognito_directory[first_email] = first_sub

    second_email = "second-manager@example.com"
    second_sub = str(uuid.uuid4())
    cognito_directory[second_email] = second_sub

    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    first = await client.post(
        f"/locations/{location.id}/managers", json={"manager_email": first_email}
    )
    assert first.status_code == 201, first.text

    second = await client.post(
        f"/locations/{location.id}/managers", json={"manager_email": second_email}
    )
    assert second.status_code == 409
    body = second.json()
    assert body["code"] == "manager_cap_reached"
    assert "maximum of 1 active managers" in body["detail"]

    # Confirm exactly one row was ever written for this config key (no
    # accidental duplicate insert from the read path).
    rows = (
        await db_session.execute(
            select(PlatformConfig).where(PlatformConfig.key == "max_active_managers_per_location")
        )
    ).scalars().all()
    assert len(rows) == 1
