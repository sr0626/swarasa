"""Integration test: `GET /locations/{id}` serializes the parent brand's
name — a real gap found live 2026-09-18 on the owner portal's location
editor page (frontend/src/app/portal/locations/[id]/page.tsx): the page
had no way to show the restaurant's actual name at all when
`location_name` (an optional per-location label) is unset, falling back
to the raw street address instead. Every CSV-imported restaurant hits
this, since the bulk import never sets `location_name`.

See app/services/location_service.py `_location_to_out`'s comment and
app/schemas/location.py `LocationOut.brand_name` for the fix.
"""
from __future__ import annotations

import pytest

from factories import create_brand, create_location, create_owner


@pytest.mark.asyncio
async def test_get_location_includes_parent_brand_name(client, db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, name="Katha Kitchen", is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id, location_name=None)
    await db_session.commit()

    response = await client.get(f"/locations/{location.id}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["brand_name"] == "Katha Kitchen"
    # The exact gap this closes: location_name unset must not lose the
    # restaurant's identity entirely.
    assert body["location_name"] is None


@pytest.mark.asyncio
async def test_brand_name_present_alongside_a_distinct_location_name(client, db_session):
    """Multi-location brand: brand_name is the restaurant, location_name
    (when set) is the specific branch — both should be present and
    distinct, not one overwriting the other."""
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, name="Spice Route", is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id, location_name="Downtown")
    await db_session.commit()

    response = await client.get(f"/locations/{location.id}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["brand_name"] == "Spice Route"
    assert body["location_name"] == "Downtown"
