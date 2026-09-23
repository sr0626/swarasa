"""Integration test: GET /admin/registered-user-count.

docs/API_CONTRACTS.md "GET /admin/registered-user-count". Same
boto3-mocking approach as tests/integration/test_claim_owner_group.py:
`cognito_service._cognito_client` is replaced with a MagicMock so the real
`count_users_in_group` (env var handling, pagination, included) runs
without ever reaching AWS.
"""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError

from app.services import cognito_service


@pytest.fixture
def cognito_client(monkeypatch):
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "us-east-1_testpool")
    fake = MagicMock()
    monkeypatch.setattr(cognito_service, "_cognito_client", fake)
    return fake


def _user() -> dict:
    return {"Username": "u", "Attributes": []}


@pytest.mark.asyncio
async def test_requires_admin(client, db_session, as_user, cognito_client):
    as_user("owner")
    assert (await client.get("/admin/registered-user-count")).status_code == 403
    as_user("manager")
    assert (await client.get("/admin/registered-user-count")).status_code == 403
    as_user("registered_user")
    assert (await client.get("/admin/registered-user-count")).status_code == 403


@pytest.mark.asyncio
async def test_anonymous_rejected(client, as_anonymous, cognito_client):
    resp = await client.get("/admin/registered-user-count")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_returns_count_from_cognito_group(client, db_session, as_user, cognito_client):
    cognito_client.list_users_in_group.return_value = {
        "Users": [_user(), _user(), _user()]
    }
    as_user("admin")
    resp = await client.get("/admin/registered-user-count")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"count": 3, "group": "registered_user"}
    cognito_client.list_users_in_group.assert_called_once_with(
        UserPoolId="us-east-1_testpool", GroupName="registered_user", Limit=60
    )


@pytest.mark.asyncio
async def test_sums_across_pagination(client, db_session, as_user, cognito_client):
    cognito_client.list_users_in_group.side_effect = [
        {"Users": [_user() for _ in range(60)], "NextToken": "page-2"},
        {"Users": [_user() for _ in range(5)]},
    ]
    as_user("admin")
    resp = await client.get("/admin/registered-user-count")
    assert resp.status_code == 200, resp.text
    assert resp.json()["count"] == 65
    assert cognito_client.list_users_in_group.call_count == 2


@pytest.mark.asyncio
async def test_empty_group_returns_zero(client, db_session, as_user, cognito_client):
    cognito_client.list_users_in_group.return_value = {"Users": []}
    as_user("admin")
    resp = await client.get("/admin/registered-user-count")
    assert resp.status_code == 200
    assert resp.json() == {"count": 0, "group": "registered_user"}


@pytest.mark.asyncio
async def test_cognito_client_error_returns_502_generic_message(
    client, db_session, as_user, cognito_client
):
    cognito_client.list_users_in_group.side_effect = ClientError(
        {"Error": {"Code": "AccessDeniedException", "Message": "nope, internal detail"}},
        "ListUsersInGroup",
    )
    as_user("admin")
    resp = await client.get("/admin/registered-user-count")
    assert resp.status_code == 502
    body = resp.json()
    assert body["code"] == "upstream_error"
    # Never leak the underlying AWS error message/detail to the caller.
    assert "AccessDeniedException" not in body["detail"]
    assert "nope, internal detail" not in body["detail"]


@pytest.mark.asyncio
async def test_network_error_returns_502(client, db_session, as_user, cognito_client):
    cognito_client.list_users_in_group.side_effect = EndpointConnectionError(
        endpoint_url="https://cognito-idp.us-east-1.amazonaws.com"
    )
    as_user("admin")
    resp = await client.get("/admin/registered-user-count")
    assert resp.status_code == 502
    assert resp.json()["code"] == "upstream_error"


@pytest.mark.asyncio
async def test_missing_pool_env_var_returns_502(client, db_session, as_user, cognito_client, monkeypatch):
    monkeypatch.delenv("COGNITO_USER_POOL_ID")
    as_user("admin")
    resp = await client.get("/admin/registered-user-count")
    assert resp.status_code == 502
    assert resp.json()["code"] == "upstream_error"
    cognito_client.list_users_in_group.assert_not_called()
