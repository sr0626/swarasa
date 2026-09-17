"""Unit test: app/lambda_handlers/cognito_post_confirmation.py — the Cognito
post-confirmation Lambda trigger that assigns a newly-confirmed user to a
pool group based on their `custom:role` attribute (see
docs/PROJECT_PLAN.csv row "Cognito post-confirmation Lambda -- assign
sign-up role to pool group").

Mocks the boto3 cognito-idp client directly (same pattern as
tests/unit/test_resize_photo_handler.py's fake S3 client) rather than using
moto — this repo's existing Lambda-handler unit tests stub the boto3 client
rather than pulling in moto, and this handler only calls one API
(AdminAddUserToGroup), which is trivial to fake.
"""
from __future__ import annotations

import pytest

from app.lambda_handlers import cognito_post_confirmation


class _FakeCognitoClient:
    def __init__(self, *, raise_on_call: bool = False):
        self.raise_on_call = raise_on_call
        self.calls: list[dict] = []

    def admin_add_user_to_group(self, UserPoolId, Username, GroupName):
        if self.raise_on_call:
            raise RuntimeError("cognito-idp is down")
        self.calls.append(
            {"user_pool_id": UserPoolId, "username": Username, "group_name": GroupName}
        )


def _event(*, user_pool_id: str = "us-east-1_w2387tOf6", username: str = "abc-123", role) -> dict:
    attributes = {}
    if role is not None:
        attributes["custom:role"] = role
    return {
        "userPoolId": user_pool_id,
        "userName": username,
        "request": {"userAttributes": attributes},
        "response": {},
    }


@pytest.mark.parametrize(
    "role, expected_group",
    [
        ("owner", "owner"),
        ("registered_user", "registered_user"),
        # Defensive mapping — see module docstring: no current sign-up flow
        # sends these, but the handler still honors them if it ever gets one.
        ("manager", "manager"),
        ("admin", "admin"),
        # Case-insensitive match on the attribute value.
        ("Owner", "owner"),
        (" owner ", "owner"),
    ],
)
def test_handler_assigns_recognized_role_to_matching_group(
    monkeypatch: pytest.MonkeyPatch, role, expected_group
):
    fake_client = _FakeCognitoClient()
    monkeypatch.setattr(cognito_post_confirmation, "_get_cognito_client", lambda: fake_client)

    event = _event(role=role)
    out = cognito_post_confirmation.handler(event, None)

    assert out is event  # returned unmodified
    assert fake_client.calls == [
        {
            "user_pool_id": "us-east-1_w2387tOf6",
            "username": "abc-123",
            "group_name": expected_group,
        }
    ]


def test_handler_no_ops_when_custom_role_missing(monkeypatch: pytest.MonkeyPatch):
    fake_client = _FakeCognitoClient()
    monkeypatch.setattr(cognito_post_confirmation, "_get_cognito_client", lambda: fake_client)

    event = _event(role=None)
    out = cognito_post_confirmation.handler(event, None)

    assert out is event
    assert fake_client.calls == []


def test_handler_no_ops_when_custom_role_empty_string(monkeypatch: pytest.MonkeyPatch):
    fake_client = _FakeCognitoClient()
    monkeypatch.setattr(cognito_post_confirmation, "_get_cognito_client", lambda: fake_client)

    event = _event(role="")
    out = cognito_post_confirmation.handler(event, None)

    assert out is event
    assert fake_client.calls == []


def test_handler_no_ops_on_unrecognized_role(monkeypatch: pytest.MonkeyPatch):
    fake_client = _FakeCognitoClient()
    monkeypatch.setattr(cognito_post_confirmation, "_get_cognito_client", lambda: fake_client)

    event = _event(role="superuser")
    out = cognito_post_confirmation.handler(event, None)

    assert out is event
    assert fake_client.calls == []


def test_handler_never_raises_when_admin_add_user_to_group_fails(monkeypatch: pytest.MonkeyPatch):
    """A Cognito post-confirmation trigger that raises can fail the user's
    sign-up confirmation entirely — this handler must swallow a boto3/API
    error, log it, and still let confirmation proceed (see module
    docstring)."""
    fake_client = _FakeCognitoClient(raise_on_call=True)
    monkeypatch.setattr(cognito_post_confirmation, "_get_cognito_client", lambda: fake_client)

    event = _event(role="owner")
    out = cognito_post_confirmation.handler(event, None)  # must not raise

    assert out is event
