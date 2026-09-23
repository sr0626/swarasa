"""Unit test: `app/services/cognito_service.py`'s `list_registered_users` —
backs `GET /admin/registered-users` (docs/API_CONTRACTS.md). Sibling test to
`test_cognito_service_registered_user_count.py`, same mocking approach
(fake boto3 cognito-idp client, never a real AWS call — tests/CLAUDE.md
"ALWAYS mock AWS calls").
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from botocore.exceptions import ClientError

from app.services import cognito_service


class _FakeCognitoClient:
    def __init__(self, pages: list[list[dict]]):
        self._pages = pages
        self.calls: list[dict] = []

    def list_users_in_group(self, **kwargs):
        self.calls.append(kwargs)
        index = len(self.calls) - 1
        page = self._pages[index]
        response = {"Users": page}
        if index + 1 < len(self._pages):
            response["NextToken"] = f"token-{index + 1}"
        return response


def _user(*, sub: str, email: str | None, status: str = "CONFIRMED", created=None) -> dict:
    attrs = [{"Name": "sub", "Value": sub}]
    if email is not None:
        attrs.append({"Name": "email", "Value": email})
    return {
        "Username": sub,
        "UserStatus": status,
        "UserCreateDate": created,
        "Attributes": attrs,
    }


@pytest.fixture(autouse=True)
def _pool_id(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "us-east-1_testpool")


def test_list_registered_users_extracts_fields(monkeypatch: pytest.MonkeyPatch):
    created = datetime(2026, 9, 10, 12, 0, 0, tzinfo=timezone.utc)
    fake = _FakeCognitoClient(
        pages=[[_user(sub="sub-1", email="a@example.com", status="CONFIRMED", created=created)]]
    )
    monkeypatch.setattr(cognito_service, "_get_client", lambda: fake)

    records = cognito_service.list_registered_users()

    assert len(records) == 1
    record = records[0]
    assert record.cognito_sub == "sub-1"
    assert record.email == "a@example.com"
    assert record.status == "CONFIRMED"
    assert record.signup_at == created


def test_list_registered_users_paginates(monkeypatch: pytest.MonkeyPatch):
    fake = _FakeCognitoClient(
        pages=[
            [_user(sub=f"sub-{i}", email=f"{i}@example.com") for i in range(60)],
            [_user(sub=f"sub-{i}", email=f"{i}@example.com") for i in range(60, 65)],
        ]
    )
    monkeypatch.setattr(cognito_service, "_get_client", lambda: fake)

    records = cognito_service.list_registered_users()

    assert len(records) == 65
    assert len(fake.calls) == 2
    assert "NextToken" not in fake.calls[0]
    assert fake.calls[1]["NextToken"] == "token-1"
    assert fake.calls[1]["GroupName"] == "registered_user"


def test_list_registered_users_falls_back_to_username_without_sub_attribute(
    monkeypatch: pytest.MonkeyPatch,
):
    fake = _FakeCognitoClient(
        pages=[[{"Username": "fallback-username", "UserStatus": "CONFIRMED", "Attributes": []}]]
    )
    monkeypatch.setattr(cognito_service, "_get_client", lambda: fake)

    records = cognito_service.list_registered_users()

    assert records[0].cognito_sub == "fallback-username"
    assert records[0].email is None


def test_list_registered_users_empty_group(monkeypatch: pytest.MonkeyPatch):
    fake = _FakeCognitoClient(pages=[[]])
    monkeypatch.setattr(cognito_service, "_get_client", lambda: fake)

    assert cognito_service.list_registered_users() == []


def test_list_registered_users_raises_when_pool_id_unset(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("COGNITO_USER_POOL_ID", raising=False)
    fake = _FakeCognitoClient(pages=[[]])
    monkeypatch.setattr(cognito_service, "_get_client", lambda: fake)

    with pytest.raises(RuntimeError):
        cognito_service.list_registered_users()
    assert fake.calls == []


def test_list_registered_users_propagates_client_error(monkeypatch: pytest.MonkeyPatch):
    class _RaisingClient(_FakeCognitoClient):
        def list_users_in_group(self, **kwargs):
            raise ClientError(
                {"Error": {"Code": "AccessDeniedException", "Message": "nope"}},
                "ListUsersInGroup",
            )

    monkeypatch.setattr(cognito_service, "_get_client", lambda: _RaisingClient(pages=[[]]))

    with pytest.raises(ClientError):
        cognito_service.list_registered_users()
