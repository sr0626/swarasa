"""Integration test: GET /admin/registered-users.

docs/API_CONTRACTS.md "GET /admin/registered-users". Same boto3-mocking
approach as tests/integration/test_admin_registered_user_count.py:
`cognito_service._cognito_client` is replaced with a MagicMock so the real
`list_registered_users` (env var handling, pagination, attribute
extraction) runs without ever reaching AWS. The local half of the join
(`user_profile.last_seen_at`) uses the real `db_session` fixture.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError

from app.models.user_profile import UserProfile
from app.services import cognito_service


@pytest.fixture
def cognito_client(monkeypatch):
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "us-east-1_testpool")
    fake = MagicMock()
    monkeypatch.setattr(cognito_service, "_cognito_client", fake)
    return fake


def _cognito_user(*, sub: str, email: str, status: str = "CONFIRMED", created: datetime) -> dict:
    return {
        "Username": sub,
        "UserStatus": status,
        "UserCreateDate": created,
        "Attributes": [
            {"Name": "sub", "Value": sub},
            {"Name": "email", "Value": email},
        ],
    }


@pytest.mark.asyncio
async def test_requires_admin(client, db_session, as_user, cognito_client):
    as_user("owner")
    assert (await client.get("/admin/registered-users")).status_code == 403
    as_user("manager")
    assert (await client.get("/admin/registered-users")).status_code == 403
    as_user("registered_user")
    assert (await client.get("/admin/registered-users")).status_code == 403


@pytest.mark.asyncio
async def test_anonymous_rejected(client, as_anonymous, cognito_client):
    resp = await client.get("/admin/registered-users")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_combines_cognito_and_local_last_seen(client, db_session, as_user, cognito_client):
    now = datetime.now(timezone.utc)
    tracked_sub = str(uuid.uuid4())
    untracked_sub = str(uuid.uuid4())

    cognito_client.list_users_in_group.return_value = {
        "Users": [
            _cognito_user(sub=tracked_sub, email="tracked@example.com", created=now - timedelta(days=1)),
            _cognito_user(sub=untracked_sub, email="untracked@example.com", created=now - timedelta(days=2)),
        ]
    }

    seen_at = now - timedelta(hours=3)
    db_session.add(UserProfile(cognito_sub=tracked_sub, last_seen_at=seen_at))
    await db_session.commit()

    as_user("admin")
    resp = await client.get("/admin/registered-users")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 2

    by_sub = {row["cognito_sub"]: row for row in body["results"]}
    assert by_sub[tracked_sub]["email"] == "tracked@example.com"
    assert by_sub[tracked_sub]["status"] == "CONFIRMED"
    assert by_sub[tracked_sub]["last_seen_at"] is not None

    # Never had a tracked authenticated request -- no user_profile row at
    # all, must come back null (rendered "Never" by the frontend), not an
    # error and not a fabricated timestamp.
    assert by_sub[untracked_sub]["last_seen_at"] is None
    assert by_sub[untracked_sub]["email"] == "untracked@example.com"


@pytest.mark.asyncio
async def test_ordered_newest_signup_first(client, db_session, as_user, cognito_client):
    now = datetime.now(timezone.utc)
    older_sub, newer_sub = str(uuid.uuid4()), str(uuid.uuid4())
    cognito_client.list_users_in_group.return_value = {
        "Users": [
            _cognito_user(sub=older_sub, email="older@example.com", created=now - timedelta(days=10)),
            _cognito_user(sub=newer_sub, email="newer@example.com", created=now - timedelta(days=1)),
        ]
    }

    as_user("admin")
    resp = await client.get("/admin/registered-users")
    assert resp.status_code == 200
    subs_in_order = [row["cognito_sub"] for row in resp.json()["results"]]
    assert subs_in_order == [newer_sub, older_sub]


@pytest.mark.asyncio
async def test_pagination(client, db_session, as_user, cognito_client):
    now = datetime.now(timezone.utc)
    subs = [str(uuid.uuid4()) for _ in range(5)]
    cognito_client.list_users_in_group.return_value = {
        "Users": [
            _cognito_user(sub=s, email=f"{s}@example.com", created=now - timedelta(days=i))
            for i, s in enumerate(subs)
        ]
    }

    as_user("admin")
    resp = await client.get("/admin/registered-users?page=1&page_size=2")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 5
    assert body["page"] == 1
    assert body["page_size"] == 2
    assert len(body["results"]) == 2

    resp2 = await client.get("/admin/registered-users?page=3&page_size=2")
    body2 = resp2.json()
    assert len(body2["results"]) == 1  # 5 users, page_size 2 -> last page has 1


@pytest.mark.asyncio
async def test_empty_group_returns_empty_list(client, db_session, as_user, cognito_client):
    cognito_client.list_users_in_group.return_value = {"Users": []}
    as_user("admin")
    resp = await client.get("/admin/registered-users")
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"results": [], "page": 1, "page_size": 20, "total": 0}


@pytest.mark.asyncio
async def test_cognito_client_error_returns_502_generic_message(
    client, db_session, as_user, cognito_client
):
    cognito_client.list_users_in_group.side_effect = ClientError(
        {"Error": {"Code": "AccessDeniedException", "Message": "nope, internal detail"}},
        "ListUsersInGroup",
    )
    as_user("admin")
    resp = await client.get("/admin/registered-users")
    assert resp.status_code == 502
    body = resp.json()
    assert body["code"] == "upstream_error"
    assert "AccessDeniedException" not in body["detail"]
    assert "nope, internal detail" not in body["detail"]


@pytest.mark.asyncio
async def test_network_error_returns_502(client, db_session, as_user, cognito_client):
    cognito_client.list_users_in_group.side_effect = EndpointConnectionError(
        endpoint_url="https://cognito-idp.us-east-1.amazonaws.com"
    )
    as_user("admin")
    resp = await client.get("/admin/registered-users")
    assert resp.status_code == 502
    assert resp.json()["code"] == "upstream_error"
