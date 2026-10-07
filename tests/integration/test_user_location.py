"""Integration tests: a diner's home city + ZIP (user_profile.city /
.postal_code, migration 0018_user_profile_location) via GET/PATCH /auth/me,
the CCPA export and the admin Registered-users report.

City and ZIP are mandatory for registered_user accounts (user decision
2026-10-07). The DB columns stay nullable (existing diners have none); the
API enforces the rules on write: city 2-100 chars (trimmed), ZIP is a US
5-digit or ZIP+4, and the two are always sent together. Real HTTP router +
SQLite DB, same pattern as test_update_me_role_scope.py.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from app.models.user_profile import UserProfile
from app.services import cognito_service
from factories import create_owner, create_user_profile


@pytest.mark.asyncio
async def test_get_me_returns_null_location_for_existing_diner(client, as_user):
    as_user("registered_user")
    body = (await client.get("/auth/me")).json()
    assert body["city"] is None
    assert body["postal_code"] is None


@pytest.mark.asyncio
async def test_patch_location_only_then_get_me_reads_it_back(client, as_user):
    as_user("registered_user")
    response = await client.patch("/auth/me", json={"city": "  Plano ", "postal_code": "75093"})
    assert response.status_code == 200, response.text
    assert response.json() == {"full_name": None, "city": "Plano", "postal_code": "75093"}

    me = (await client.get("/auth/me")).json()
    assert me["city"] == "Plano"
    assert me["postal_code"] == "75093"


@pytest.mark.asyncio
async def test_location_is_freely_editable_and_accepts_zip_plus_4(client, as_user):
    as_user("registered_user")
    await client.patch("/auth/me", json={"city": "Plano", "postal_code": "75093"})
    response = await client.patch("/auth/me", json={"city": "Frisco", "postal_code": "75034-1234"})
    assert response.status_code == 200, response.text
    assert response.json()["city"] == "Frisco"
    assert response.json()["postal_code"] == "75034-1234"


@pytest.mark.asyncio
async def test_name_and_location_in_one_request(client, as_user):
    as_user("registered_user")
    response = await client.patch(
        "/auth/me",
        json={"full_name": "Asha Verma", "city": "Irving", "postal_code": "75038"},
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "full_name": "Asha Verma",
        "city": "Irving",
        "postal_code": "75038",
    }


@pytest.mark.asyncio
async def test_location_update_works_when_name_is_locked(client, db_session, as_user):
    user = as_user("registered_user")
    await create_user_profile(db_session, cognito_sub=user.cognito_sub, full_name="Asha Verma")
    await db_session.commit()

    response = await client.patch("/auth/me", json={"city": "Irving", "postal_code": "75038"})
    assert response.status_code == 200, response.text
    assert response.json()["full_name"] == "Asha Verma"


@pytest.mark.asyncio
async def test_rejected_rename_does_not_half_apply_location(client, db_session, as_user):
    user = as_user("registered_user")
    await create_user_profile(db_session, cognito_sub=user.cognito_sub, full_name="Asha Verma")
    await db_session.commit()

    response = await client.patch(
        "/auth/me",
        json={"full_name": "Someone Else", "city": "Irving", "postal_code": "75038"},
    )
    assert response.status_code == 409
    me = (await client.get("/auth/me")).json()
    assert me["city"] is None
    assert me["postal_code"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        {"city": "Plano"},  # ZIP missing
        {"postal_code": "75093"},  # city missing
        {"city": "P", "postal_code": "75093"},  # city too short
        {"city": "   ", "postal_code": "75093"},  # blank city
        {"city": "x" * 101, "postal_code": "75093"},  # city too long
        {"city": "Plano", "postal_code": "7509"},  # 4 digits
        {"city": "Plano", "postal_code": "750931"},  # 6 digits
        {"city": "Plano", "postal_code": "ABCDE"},
        {"city": "Plano", "postal_code": "75093-12"},
        {"city": "Plano", "postal_code": ""},
    ],
)
async def test_invalid_location_is_rejected_and_nothing_saved(client, as_user, payload):
    as_user("registered_user")
    response = await client.patch("/auth/me", json=payload)
    assert response.status_code == 422, response.text
    me = (await client.get("/auth/me")).json()
    assert me["city"] is None and me["postal_code"] is None


@pytest.mark.asyncio
async def test_manager_location_is_ignored(client, as_user):
    as_user("manager")
    # Location-only PATCH from a manager has nothing to write -> same 400 as before.
    response = await client.patch("/auth/me", json={"city": "Plano", "postal_code": "75093"})
    assert response.status_code == 400
    assert response.json()["code"] == "full_name_required"

    # With a name it saves the name only; location stays out of the response.
    response = await client.patch(
        "/auth/me", json={"full_name": "Ravi K", "city": "Plano", "postal_code": "75093"}
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"full_name": "Ravi K", "city": None, "postal_code": None}
    me = (await client.get("/auth/me")).json()
    assert me["city"] is None and me["postal_code"] is None


@pytest.mark.asyncio
async def test_owner_unaffected_by_location_fields(client, db_session, as_user):
    owner = await create_owner(db_session, full_name=None)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    response = await client.patch(
        "/auth/me", json={"full_name": "Priya Rao", "city": "Plano", "postal_code": "75093"}
    )
    assert response.status_code == 200, response.text
    assert "city" not in response.json()
    me = (await client.get("/auth/me")).json()
    assert me["city"] is None and me["postal_code"] is None


@pytest.mark.asyncio
async def test_data_export_includes_location(client, db_session, as_user):
    user = as_user("registered_user")
    db_session.add(UserProfile(cognito_sub=user.cognito_sub, city="Plano", postal_code="75093"))
    await db_session.commit()

    export = (await client.get("/auth/me/data-export")).json()
    assert export["user_profile"]["city"] == "Plano"
    assert export["user_profile"]["postal_code"] == "75093"


@pytest.mark.asyncio
async def test_admin_registered_users_report_shows_location(
    client, db_session, as_user, monkeypatch
):
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "us-east-1_testpool")
    fake = MagicMock()
    monkeypatch.setattr(cognito_service, "_cognito_client", fake)

    now = datetime.now(timezone.utc)
    with_loc, without_loc = str(uuid.uuid4()), str(uuid.uuid4())

    def _user(sub: str, email: str, created: datetime) -> dict:
        return {
            "Username": sub,
            "UserStatus": "CONFIRMED",
            "UserCreateDate": created,
            "Attributes": [{"Name": "sub", "Value": sub}, {"Name": "email", "Value": email}],
        }

    fake.list_users_in_group.return_value = {
        "Users": [
            _user(with_loc, "a@example.com", now - timedelta(days=1)),
            _user(without_loc, "b@example.com", now - timedelta(days=2)),
        ]
    }
    db_session.add(UserProfile(cognito_sub=with_loc, city="Plano", postal_code="75093"))
    await db_session.commit()

    as_user("admin")
    resp = await client.get("/admin/registered-users")
    assert resp.status_code == 200, resp.text
    rows = {r["cognito_sub"]: r for r in resp.json()["results"]}
    assert rows[with_loc]["city"] == "Plano"
    assert rows[with_loc]["postal_code"] == "75093"
    assert rows[without_loc]["city"] is None
    assert rows[without_loc]["postal_code"] is None
