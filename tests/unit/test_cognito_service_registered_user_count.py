"""Unit test: `app/services/cognito_service.py`'s `count_users_in_group` —
backs `GET /admin/registered-user-count` (docs/API_CONTRACTS.md).

Mocks the boto3 cognito-idp client directly (same pattern
`tests/unit/test_cognito_post_confirmation_handler.py` uses for the
post-confirmation Lambda, and the module's own docstring points to for
`ListUsers`-based lookups) — never a real AWS call, per tests/CLAUDE.md
"ALWAYS mock AWS calls."
"""
from __future__ import annotations

import pytest
from botocore.exceptions import ClientError

from app.services import cognito_service


class _FakeCognitoClient:
    """Stub replacing the real boto3 cognito-idp client. Serves
    `list_users_in_group` from a pre-set list of pages (each page a list of
    fake user dicts), honoring `NextToken` pagination and recording every
    call's kwargs.
    """

    def __init__(self, pages: list[list[dict]], *, raise_error: ClientError | None = None):
        self._pages = pages
        self._raise_error = raise_error
        self.calls: list[dict] = []

    def list_users_in_group(self, **kwargs):
        self.calls.append(kwargs)
        if self._raise_error is not None:
            raise self._raise_error
        index = len(self.calls) - 1
        page = self._pages[index]
        response = {"Users": page}
        if index + 1 < len(self._pages):
            response["NextToken"] = f"token-{index + 1}"
        return response


def _user() -> dict:
    return {"Username": "u", "Attributes": []}


@pytest.fixture(autouse=True)
def _pool_id(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "us-east-1_testpool")


def test_count_users_in_group_sums_a_single_page(monkeypatch: pytest.MonkeyPatch):
    fake = _FakeCognitoClient(pages=[[_user(), _user(), _user()]])
    monkeypatch.setattr(cognito_service, "_get_client", lambda: fake)

    count = cognito_service.count_users_in_group("registered_user")

    assert count == 3
    assert fake.calls == [
        {"UserPoolId": "us-east-1_testpool", "GroupName": "registered_user", "Limit": 60}
    ]


def test_count_users_in_group_paginates_across_multiple_pages(monkeypatch: pytest.MonkeyPatch):
    fake = _FakeCognitoClient(pages=[[_user() for _ in range(60)], [_user() for _ in range(60)], [_user() for _ in range(7)]])
    monkeypatch.setattr(cognito_service, "_get_client", lambda: fake)

    count = cognito_service.count_users_in_group("registered_user")

    assert count == 127
    assert len(fake.calls) == 3
    # First call has no NextToken; subsequent calls carry the prior page's token.
    assert "NextToken" not in fake.calls[0]
    assert fake.calls[1]["NextToken"] == "token-1"
    assert fake.calls[2]["NextToken"] == "token-2"


def test_count_users_in_group_returns_zero_for_empty_group(monkeypatch: pytest.MonkeyPatch):
    fake = _FakeCognitoClient(pages=[[]])
    monkeypatch.setattr(cognito_service, "_get_client", lambda: fake)

    assert cognito_service.count_users_in_group("registered_user") == 0


def test_count_users_in_group_raises_when_pool_id_unset(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("COGNITO_USER_POOL_ID", raising=False)
    fake = _FakeCognitoClient(pages=[[]])
    monkeypatch.setattr(cognito_service, "_get_client", lambda: fake)

    with pytest.raises(RuntimeError):
        cognito_service.count_users_in_group("registered_user")

    assert fake.calls == []  # never reaches the AWS call


def test_count_users_in_group_propagates_client_error(monkeypatch: pytest.MonkeyPatch):
    error = ClientError({"Error": {"Code": "AccessDeniedException", "Message": "nope"}}, "ListUsersInGroup")
    fake = _FakeCognitoClient(pages=[[]], raise_error=error)
    monkeypatch.setattr(cognito_service, "_get_client", lambda: fake)

    with pytest.raises(ClientError):
        cognito_service.count_users_in_group("registered_user")
