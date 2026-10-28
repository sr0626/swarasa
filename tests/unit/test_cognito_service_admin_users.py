"""Unit test: `cognito_service.list_group_users`, `admin_get_user` and the four
admin account actions (backing `/admin/users`). Fake boto3 client only --
never a real AWS call (tests/CLAUDE.md "ALWAYS mock AWS calls").
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from botocore.exceptions import ClientError

from app.services import cognito_service


class _FakeClient:
    def __init__(self, pages: list[list[dict]] | None = None, get_user=None):
        self._pages = pages or []
        self._get_user = get_user
        self.calls: list[tuple[str, dict]] = []

    def list_users_in_group(self, **kwargs):
        self.calls.append(("list_users_in_group", kwargs))
        index = len([c for c in self.calls if c[0] == "list_users_in_group"]) - 1
        response = {"Users": self._pages[index]}
        if index + 1 < len(self._pages):
            response["NextToken"] = f"t{index + 1}"
        return response

    def admin_get_user(self, **kwargs):
        self.calls.append(("admin_get_user", kwargs))
        if isinstance(self._get_user, Exception):
            raise self._get_user
        return self._get_user

    def __getattr__(self, name):
        if name.startswith("admin_"):
            return lambda **kwargs: self.calls.append((name, kwargs))
        raise AttributeError(name)


@pytest.fixture(autouse=True)
def _pool(monkeypatch):
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "us-east-1_testpool")


def _install(monkeypatch, client):
    monkeypatch.setattr(cognito_service, "_get_client", lambda: client)


def _user(sub, email, *, enabled=True, status="CONFIRMED", key="Attributes"):
    return {
        "Username": sub,
        "Enabled": enabled,
        "UserStatus": status,
        "UserCreateDate": datetime(2026, 9, 1, tzinfo=timezone.utc),
        key: [
            {"Name": "sub", "Value": sub},
            {"Name": "email", "Value": email},
            {"Name": "name", "Value": "Pat"},
        ],
    }


def test_list_group_users_paginates_and_parses(monkeypatch):
    client = _FakeClient(pages=[[_user("a", "a@x.com")], [_user("b", "b@x.com", enabled=False)]])
    _install(monkeypatch, client)
    users, truncated = cognito_service.list_group_users("owner")
    assert truncated is False
    assert [u.username for u in users] == ["a", "b"]
    assert users[1].enabled is False and users[0].email == "a@x.com" and users[0].name == "Pat"
    assert client.calls[1][1]["NextToken"] == "t1"
    assert client.calls[0][1]["GroupName"] == "owner"


def test_list_group_users_is_capped(monkeypatch):
    pages = [[_user(f"u{i}", f"u{i}@x.com")] for i in range(cognito_service._MAX_PAGES_PER_GROUP + 5)]
    client = _FakeClient(pages=pages)
    _install(monkeypatch, client)
    users, truncated = cognito_service.list_group_users("registered_user")
    assert truncated is True
    assert len(users) == cognito_service._MAX_PAGES_PER_GROUP


def test_admin_get_user_parses_user_attributes_and_missing_is_none(monkeypatch):
    _install(monkeypatch, _FakeClient(get_user=_user("a", "a@x.com", status="UNCONFIRMED", key="UserAttributes")))
    rec = cognito_service.admin_get_user("a")
    assert rec is not None and rec.status == "UNCONFIRMED" and rec.cognito_sub == "a"

    missing = ClientError({"Error": {"Code": "UserNotFoundException", "Message": "x"}}, "AdminGetUser")
    _install(monkeypatch, _FakeClient(get_user=missing))
    assert cognito_service.admin_get_user("zzz") is None

    other = ClientError({"Error": {"Code": "InternalErrorException", "Message": "x"}}, "AdminGetUser")
    _install(monkeypatch, _FakeClient(get_user=other))
    with pytest.raises(ClientError):
        cognito_service.admin_get_user("zzz")


@pytest.mark.parametrize(
    "fn,api",
    [
        (cognito_service.admin_disable_user, "admin_disable_user"),
        (cognito_service.admin_enable_user, "admin_enable_user"),
        (cognito_service.admin_confirm_sign_up, "admin_confirm_sign_up"),
        (cognito_service.admin_reset_user_password, "admin_reset_user_password"),
    ],
)
def test_admin_actions_call_scoped_api(monkeypatch, fn, api):
    client = _FakeClient()
    _install(monkeypatch, client)
    fn("some-user")
    assert client.calls == [(api, {"UserPoolId": "us-east-1_testpool", "Username": "some-user"})]
