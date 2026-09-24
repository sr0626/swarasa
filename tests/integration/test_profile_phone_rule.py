"""Integration tests: `PATCH /auth/me` `phone` follows the ONE shared US phone
rule (app/core/phone.py) — docs/API_CONTRACTS.md "PATCH /auth/me".

Before this rule the owner-profile phone accepted any 8-15 digit string, so an
11-digit number was stored as typed (user feedback 2026-09-24).
"""
from __future__ import annotations

import pytest

from factories import create_owner


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "raw,stored",
    [
        ("(469) 555-0142", "+14695550142"),
        ("469-555-0142", "+14695550142"),
        ("1 469 555 0142", "+14695550142"),
        ("+14695550142", "+14695550142"),
    ],
)
async def test_owner_phone_is_normalised_to_e164(client, db_session, as_user, raw, stored):
    owner = await create_owner(db_session, full_name=None, phone=None)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    response = await client.patch("/auth/me", json={"phone": raw})
    assert response.status_code == 200, response.text
    assert response.json()["phone"] == stored
    await db_session.refresh(owner)
    assert owner.phone == stored


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad", ["46955501420", "+44 20 7946 0958", "555-0142", "", "   ", "not a phone", "(469) 155-0142"]
)
async def test_owner_invalid_phone_is_rejected_and_stored_value_kept(
    client, db_session, as_user, bad
):
    owner = await create_owner(db_session, full_name=None, phone="+14695550001")
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    response = await client.patch("/auth/me", json={"phone": bad})
    assert response.status_code == 422, response.text
    await db_session.refresh(owner)
    assert owner.phone == "+14695550001"


@pytest.mark.asyncio
async def test_omitting_phone_leaves_it_untouched(client, db_session, as_user):
    owner = await create_owner(db_session, full_name=None, phone="+14695550001")
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    response = await client.patch("/auth/me", json={"full_name": "Priya Rao"})
    assert response.status_code == 200, response.text
    await db_session.refresh(owner)
    assert owner.phone == "+14695550001"
