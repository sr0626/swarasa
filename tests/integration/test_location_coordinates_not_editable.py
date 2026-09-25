"""Integration test: `latitude`/`longitude` are auto-generated from the address
(user decision 2026-09-24). On `PATCH /locations/{id}` an owner/manager may
send coordinates ONLY alongside the full address block in the same request
(what the frontend server action sends after re-geocoding the changed
address); a bare lat/lng edit is rejected `422 coordinates_not_editable`.
Admin may still set coordinates directly. docs/API_CONTRACTS.md
"PATCH /locations/{id}".
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.models.restaurant_location import RestaurantLocation
from app.services import location_service
from factories import create_brand, create_location, create_owner

ADDRESS_BLOCK = {
    "address_line1": "500 Legacy Dr",
    "city": "Plano",
    "state": "TX",
    "postal_code": "75024",
}


@pytest.fixture(autouse=True)
def no_postgis(monkeypatch: pytest.MonkeyPatch):
    async def _noop(*args, **kwargs):
        return None

    monkeypatch.setattr(location_service, "_sync_geom", _noop)


async def _setup(db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id, phone="+14695550000")
    await db_session.commit()
    return owner, location


@pytest.mark.asyncio
async def test_owner_bare_coordinate_edit_is_rejected(client, db_session, as_user):
    owner, location = await _setup(db_session)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    before = (location.latitude, location.longitude)

    response = await client.patch(
        f"/locations/{location.id}", json={"latitude": 33.1, "longitude": -96.7}
    )
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "coordinates_not_editable"

    await db_session.refresh(location)
    assert (location.latitude, location.longitude) == before


@pytest.mark.asyncio
async def test_owner_coordinates_with_partial_address_are_rejected(client, db_session, as_user):
    owner, location = await _setup(db_session)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    response = await client.patch(
        f"/locations/{location.id}",
        json={"address_line1": "1 Main St", "latitude": 33.1, "longitude": -96.7},
    )
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_owner_coordinates_with_full_address_block_are_accepted(client, db_session, as_user):
    owner, location = await _setup(db_session)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    response = await client.patch(
        f"/locations/{location.id}",
        json={**ADDRESS_BLOCK, "latitude": 33.1, "longitude": -96.7},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["latitude"] == pytest.approx(33.1)
    assert body["longitude"] == pytest.approx(-96.7)
    assert body["city"] == "Plano"


@pytest.mark.asyncio
async def test_owner_address_only_edit_leaves_coordinates_untouched(client, db_session, as_user):
    """The geocoding-failed path: address saved, old coordinates kept."""
    owner, location = await _setup(db_session)
    location.latitude = Decimal("32.5")
    location.longitude = Decimal("-96.5")
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    response = await client.patch(f"/locations/{location.id}", json=ADDRESS_BLOCK)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["latitude"] == pytest.approx(32.5)
    assert body["longitude"] == pytest.approx(-96.5)


@pytest.mark.asyncio
async def test_admin_can_set_coordinates_directly(client, db_session, as_user):
    _, location = await _setup(db_session)
    as_user("admin")

    response = await client.patch(
        f"/locations/{location.id}", json={"latitude": 33.1, "longitude": -96.7}
    )
    assert response.status_code == 200, response.text
    assert response.json()["latitude"] == pytest.approx(33.1)

    fresh = await db_session.get(RestaurantLocation, location.id)
    await db_session.refresh(fresh)
    assert float(fresh.longitude) == pytest.approx(-96.7)
