"""Integration test: `user_profile.last_seen_at` gets touched on real
authenticated activity, throttled — docs/DECISIONS.md "Registered-user
last-seen tracking".

Deliberately does NOT use the `as_user` fixture (which overrides
`get_current_user` entirely with a fake `CurrentUser`, bypassing
`_resolve_current_user` — see tests/integration/conftest.py's own
docstring). The whole point of this test is to exercise the REAL
`get_current_user` -> `_resolve_current_user` -> `touch_last_seen` path, so
it signs a real JWT against a locally generated RSA keypair and monkeypatches
`app.dependencies.auth._get_jwk_client` the same way
tests/unit/test_auth_jwt.py does — never a real JWKS/network call.

`GET /auth/me` is used as the "any authenticated request" vehicle: it's
available to every role and its own behavior (returning `MeResponse`) is
already covered elsewhere, so this test only asserts on the `user_profile`
row, not the response body.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import select

from app.dependencies import auth as auth_deps
from app.models.user_profile import UserProfile


@pytest.fixture(scope="module")
def rsa_keypair():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private_key, private_key.public_key()


class _FakeSigningKey:
    def __init__(self, key):
        self.key = key


class _FakeJWKClient:
    def __init__(self, public_key):
        self._public_key = public_key

    def get_signing_key_from_jwt(self, token):
        return _FakeSigningKey(self._public_key)


@pytest.fixture(autouse=True)
def mock_jwks(monkeypatch: pytest.MonkeyPatch, rsa_keypair):
    _private, public_key = rsa_keypair
    monkeypatch.setattr(auth_deps, "_get_jwk_client", lambda: _FakeJWKClient(public_key))


def _issuer() -> str:
    return f"https://cognito-idp.{auth_deps._region()}.amazonaws.com/{auth_deps._user_pool_id()}"


def _issue_token(private_key, *, sub: str, groups: list[str], email: str = "diner@example.com") -> str:
    claims = {
        "sub": sub,
        "iss": _issuer(),
        "token_use": "id",
        "email": email,
        "cognito:groups": groups,
    }
    return jwt.encode(claims, private_key, algorithm="RS256")


async def _get_profile(db_session, sub: str) -> UserProfile | None:
    result = await db_session.execute(select(UserProfile).where(UserProfile.cognito_sub == sub))
    return result.scalar_one_or_none()


@pytest.mark.asyncio
async def test_registered_user_activity_creates_last_seen_row(client, db_session, rsa_keypair):
    private_key, _ = rsa_keypair
    sub = str(uuid.uuid4())
    token = _issue_token(private_key, sub=sub, groups=["registered_user"])

    resp = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text

    profile = await _get_profile(db_session, sub)
    assert profile is not None
    assert profile.last_seen_at is not None
    assert profile.full_name is None  # never set a display name -- row exists purely for last_seen


@pytest.mark.asyncio
async def test_manager_activity_also_tracked(client, db_session, rsa_keypair):
    private_key, _ = rsa_keypair
    sub = str(uuid.uuid4())
    token = _issue_token(private_key, sub=sub, groups=["manager"])

    resp = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text

    profile = await _get_profile(db_session, sub)
    assert profile is not None
    assert profile.last_seen_at is not None


@pytest.mark.asyncio
async def test_owner_activity_does_not_create_a_user_profile_row(client, db_session, rsa_keypair):
    """Owner deliberately excluded (docs/DECISIONS.md "Registered-user
    last-seen tracking") -- owner's own activity story lives on
    owner_account, not user_profile."""
    private_key, _ = rsa_keypair
    sub = str(uuid.uuid4())
    token = _issue_token(private_key, sub=sub, groups=["owner"], email="owner@example.com")

    resp = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text

    profile = await _get_profile(db_session, sub)
    assert profile is None


@pytest.mark.asyncio
async def test_two_quick_requests_only_write_once(client, db_session, rsa_keypair):
    """The throttle: two requests within the throttle window must not
    produce two writes -- asserted here by checking the SAME timestamp
    comes back both times, not just "a row exists"."""
    private_key, _ = rsa_keypair
    sub = str(uuid.uuid4())
    token = _issue_token(private_key, sub=sub, groups=["registered_user"])
    headers = {"Authorization": f"Bearer {token}"}

    resp1 = await client.get("/auth/me", headers=headers)
    assert resp1.status_code == 200
    profile_after_first = await _get_profile(db_session, sub)
    assert profile_after_first is not None
    first_seen_at = profile_after_first.last_seen_at

    resp2 = await client.get("/auth/me", headers=headers)
    assert resp2.status_code == 200
    profile_after_second = await _get_profile(db_session, sub)
    assert profile_after_second is not None

    # Throttled -- the second request landed well within the 5-minute
    # window, so it must not have overwritten last_seen_at with a new value.
    assert profile_after_second.last_seen_at == first_seen_at


@pytest.mark.asyncio
async def test_request_after_throttle_window_updates_last_seen(client, db_session, rsa_keypair):
    """Once the existing last_seen_at is stale (older than the throttle
    window), the next authenticated request DOES update it."""
    private_key, _ = rsa_keypair
    sub = str(uuid.uuid4())
    token = _issue_token(private_key, sub=sub, groups=["registered_user"])
    headers = {"Authorization": f"Bearer {token}"}

    resp1 = await client.get("/auth/me", headers=headers)
    assert resp1.status_code == 200
    profile = await _get_profile(db_session, sub)
    assert profile is not None
    stale_timestamp = datetime.now(timezone.utc) - timedelta(minutes=10)
    profile.last_seen_at = stale_timestamp
    await db_session.commit()

    resp2 = await client.get("/auth/me", headers=headers)
    assert resp2.status_code == 200

    profile_after = await _get_profile(db_session, sub)
    assert profile_after is not None
    assert profile_after.last_seen_at > stale_timestamp
