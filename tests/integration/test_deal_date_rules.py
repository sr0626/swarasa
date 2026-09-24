"""Integration tests: required-dates rule on deal create/update (owner
feedback 2026-09-23 — an owner could previously submit a deal with no
start/end date).

Rule, enforced SERVER-side (the frontend form check is a convenience, never
the guarantee): `start_at` required; `end_at` required unless the request
explicitly says `ongoing: true`; `ongoing: true` together with an `end_at`
is contradictory (422); end must be after start. `ongoing` is request-only
(never persisted/returned) — an ongoing deal is simply `end_at IS NULL`.

Legacy rows (created before the rule, dates NULL) must stay editable for
anything that doesn't touch the dates — PATCH only validates the date
fields the caller actually sent.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from factories import create_brand, create_deal, create_location, create_owner


async def _owner_and_location(db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    return location


@pytest.mark.asyncio
async def test_create_rejects_missing_start_at(client, db_session, as_user):
    location = await _owner_and_location(db_session, as_user)
    response = await client.post(
        f"/locations/{location.id}/deals",
        json={"title": "No start", "end_at": "2027-02-01T00:00:00Z"},
    )
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_create_rejects_no_dates_at_all(client, db_session, as_user):
    location = await _owner_and_location(db_session, as_user)
    response = await client.post(f"/locations/{location.id}/deals", json={"title": "Nothing"})
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_create_rejects_missing_end_at_without_ongoing(client, db_session, as_user):
    location = await _owner_and_location(db_session, as_user)
    response = await client.post(
        f"/locations/{location.id}/deals",
        json={"title": "No end", "start_at": "2027-01-01T00:00:00Z"},
    )
    assert response.status_code == 422, response.text
    response = await client.post(
        f"/locations/{location.id}/deals",
        json={"title": "Null end", "start_at": "2027-01-01T00:00:00Z", "end_at": None},
    )
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_create_accepts_ongoing_with_no_end_at(client, db_session, as_user):
    location = await _owner_and_location(db_session, as_user)
    response = await client.post(
        f"/locations/{location.id}/deals",
        json={
            "title": "Every Tuesday",
            "applicable_days": [1],
            "start_at": "2027-01-01T00:00:00Z",
            "ongoing": True,
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["end_at"] is None
    assert body["start_at"] is not None
    assert "ongoing" not in body


@pytest.mark.asyncio
async def test_create_rejects_ongoing_together_with_end_at(client, db_session, as_user):
    location = await _owner_and_location(db_session, as_user)
    response = await client.post(
        f"/locations/{location.id}/deals",
        json={
            "title": "Contradiction",
            "start_at": "2027-01-01T00:00:00Z",
            "end_at": "2027-02-01T00:00:00Z",
            "ongoing": True,
        },
    )
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_create_rejects_end_before_start(client, db_session, as_user):
    location = await _owner_and_location(db_session, as_user)
    response = await client.post(
        f"/locations/{location.id}/deals",
        json={
            "title": "Backwards",
            "start_at": "2027-02-01T00:00:00Z",
            "end_at": "2027-01-01T00:00:00Z",
        },
    )
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_create_accepts_timezone_less_datetimes_as_utc(client, db_session, as_user):
    location = await _owner_and_location(db_session, as_user)
    response = await client.post(
        f"/locations/{location.id}/deals",
        json={"title": "Naive", "start_at": "2027-01-01T00:00:00", "end_at": "2027-02-01T00:00:00"},
    )
    assert response.status_code == 201, response.text


@pytest.mark.asyncio
async def test_legacy_null_date_deal_can_still_be_toggled_and_retitled(client, db_session, as_user):
    location = await _owner_and_location(db_session, as_user)
    deal = await create_deal(db_session, location_id=location.id, start_at=None, end_at=None)
    await db_session.commit()

    response = await client.patch(f"/locations/{location.id}/deals/{deal.id}", json={"is_active": False})
    assert response.status_code == 200, response.text
    response = await client.patch(f"/locations/{location.id}/deals/{deal.id}", json={"title": "Renamed"})
    assert response.status_code == 200, response.text
    assert response.json()["start_at"] is None
    assert response.json()["end_at"] is None


@pytest.mark.asyncio
async def test_patch_rejects_clearing_start_at(client, db_session, as_user):
    location = await _owner_and_location(db_session, as_user)
    deal = await create_deal(db_session, location_id=location.id)
    await db_session.commit()
    response = await client.patch(f"/locations/{location.id}/deals/{deal.id}", json={"start_at": None})
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_patch_rejects_clearing_end_at_without_ongoing(client, db_session, as_user):
    location = await _owner_and_location(db_session, as_user)
    deal = await create_deal(db_session, location_id=location.id)
    await db_session.commit()
    response = await client.patch(f"/locations/{location.id}/deals/{deal.id}", json={"end_at": None})
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_patch_ongoing_clears_end_at(client, db_session, as_user):
    location = await _owner_and_location(db_session, as_user)
    deal = await create_deal(
        db_session,
        location_id=location.id,
        start_at=datetime(2027, 1, 1, tzinfo=timezone.utc),
        end_at=datetime(2027, 2, 1, tzinfo=timezone.utc),
    )
    await db_session.commit()
    response = await client.patch(f"/locations/{location.id}/deals/{deal.id}", json={"ongoing": True})
    assert response.status_code == 200, response.text
    assert response.json()["end_at"] is None
    assert response.json()["start_at"] is not None


@pytest.mark.asyncio
async def test_patch_rejects_ongoing_together_with_end_at(client, db_session, as_user):
    location = await _owner_and_location(db_session, as_user)
    deal = await create_deal(db_session, location_id=location.id)
    await db_session.commit()
    response = await client.patch(
        f"/locations/{location.id}/deals/{deal.id}",
        json={"ongoing": True, "end_at": "2027-02-01T00:00:00Z"},
    )
    assert response.status_code == 422, response.text
