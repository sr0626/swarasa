"""Claim approval -> Cognito `owner` group elevation (best-effort, after commit).

boto3 is never reached: `cognito_service._cognito_client` is replaced with a
MagicMock, so the real `add_user_to_group` (env var handling included) runs.
The approval's DB effects must survive every Cognito failure mode.
"""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.claim_request import ClaimRequest
from app.services import cognito_service
from factories import create_brand, create_location


@pytest.fixture
def cognito_client(monkeypatch):
    # Replace the autouse no-op with the real add_user_to_group, backed by a
    # fake boto3 client (never a real one).
    monkeypatch.setattr(cognito_service, "add_user_to_group", _REAL_ADD_USER_TO_GROUP)
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "us-east-1_testpool")
    fake = MagicMock()
    monkeypatch.setattr(cognito_service, "_cognito_client", fake)
    return fake


# Captured at import time, before the autouse fixture patches the module.
_REAL_ADD_USER_TO_GROUP = cognito_service.add_user_to_group


def _client_error(code: str) -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": "nope"}}, "AdminAddUserToGroup")


async def _submit(client, db_session, as_user, *, sub=None, email=None):
    brand = await create_brand(db_session, is_claimed=False, owner_id=None)
    await create_location(db_session, brand_id=brand.id)
    await db_session.commit()
    sub = sub or str(uuid.uuid4())
    email = email or f"{uuid.uuid4().hex[:8]}@example.com"
    as_user("registered_user", sub=sub, email=email)
    resp = await client.post(
        "/claim",
        json={
            "brand_id": brand.id,
            "proof_method": "google_business_profile",
            "google_business_profile_url": f"https://business.google.com/{uuid.uuid4().hex}",
        },
    )
    assert resp.status_code == 201, resp.text
    return brand, resp.json()["claim_id"], sub, email


async def _assert_approved_in_db(db_session, brand, claim_id):
    await db_session.refresh(brand)
    assert brand.is_claimed is True
    assert brand.owner_id is not None
    claim = await db_session.get(ClaimRequest, claim_id)
    await db_session.refresh(claim)
    assert claim.status == "approved"
    audit = (
        await db_session.execute(
            select(AuditLog).where(AuditLog.table_name == "restaurant_brand", AuditLog.record_id == brand.id)
        )
    ).scalars().all()
    assert audit


@pytest.mark.asyncio
async def test_approve_adds_claimant_to_owner_group(client, db_session, as_user, cognito_client):
    brand, claim_id, sub, _ = await _submit(client, db_session, as_user)
    as_user("admin")
    resp = await client.post(f"/claim/{claim_id}/approve", json={})
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "approved"
    assert resp.json()["owner_group_granted"] is True
    cognito_client.admin_add_user_to_group.assert_called_once_with(
        UserPoolId="us-east-1_testpool", Username=sub, GroupName="owner"
    )
    await _assert_approved_in_db(db_session, brand, claim_id)


@pytest.mark.asyncio
async def test_user_not_found_falls_back_to_email(client, db_session, as_user, cognito_client):
    brand, claim_id, sub, email = await _submit(client, db_session, as_user)
    cognito_client.admin_add_user_to_group.side_effect = [_client_error("UserNotFoundException"), None]
    as_user("admin")
    resp = await client.post(f"/claim/{claim_id}/approve", json={})
    assert resp.status_code == 200
    assert resp.json()["owner_group_granted"] is True
    usernames = [c.kwargs["Username"] for c in cognito_client.admin_add_user_to_group.call_args_list]
    assert usernames == [sub, email]


@pytest.mark.asyncio
async def test_client_error_does_not_break_approval(client, db_session, as_user, cognito_client):
    brand, claim_id, _, _ = await _submit(client, db_session, as_user)
    cognito_client.admin_add_user_to_group.side_effect = _client_error("AccessDeniedException")
    as_user("admin")
    resp = await client.post(f"/claim/{claim_id}/approve", json={"reviewer_notes": "ok"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "approved"
    assert body["owner_group_granted"] is False
    assert cognito_client.admin_add_user_to_group.call_count == 1  # no email retry on AccessDenied
    await _assert_approved_in_db(db_session, brand, claim_id)


@pytest.mark.asyncio
async def test_user_not_found_on_both_forms_reports_false(client, db_session, as_user, cognito_client):
    brand, claim_id, _, _ = await _submit(client, db_session, as_user)
    cognito_client.admin_add_user_to_group.side_effect = _client_error("UserNotFoundException")
    as_user("admin")
    resp = await client.post(f"/claim/{claim_id}/approve", json={})
    assert resp.status_code == 200
    assert resp.json()["owner_group_granted"] is False
    await _assert_approved_in_db(db_session, brand, claim_id)


@pytest.mark.asyncio
async def test_network_error_does_not_break_approval(client, db_session, as_user, cognito_client):
    brand, claim_id, _, _ = await _submit(client, db_session, as_user)
    cognito_client.admin_add_user_to_group.side_effect = EndpointConnectionError(endpoint_url="https://x")
    as_user("admin")
    resp = await client.post(f"/claim/{claim_id}/approve", json={})
    assert resp.status_code == 200
    assert resp.json()["owner_group_granted"] is False
    await _assert_approved_in_db(db_session, brand, claim_id)


@pytest.mark.asyncio
async def test_missing_pool_env_var_does_not_break_approval(client, db_session, as_user, cognito_client, monkeypatch):
    brand, claim_id, _, _ = await _submit(client, db_session, as_user)
    monkeypatch.delenv("COGNITO_USER_POOL_ID")
    as_user("admin")
    resp = await client.post(f"/claim/{claim_id}/approve", json={})
    assert resp.status_code == 200
    assert resp.json()["owner_group_granted"] is False
    cognito_client.admin_add_user_to_group.assert_not_called()
    await _assert_approved_in_db(db_session, brand, claim_id)


@pytest.mark.asyncio
async def test_reject_does_not_touch_cognito(client, db_session, as_user, cognito_client):
    brand, claim_id, _, _ = await _submit(client, db_session, as_user)
    as_user("admin")
    resp = await client.post(f"/claim/{claim_id}/reject", json={"reviewer_notes": "No match."})
    assert resp.status_code == 200
    assert resp.json()["status"] == "rejected"
    assert resp.json()["owner_group_granted"] is None
    cognito_client.admin_add_user_to_group.assert_not_called()


@pytest.mark.asyncio
async def test_already_in_group_is_idempotent(client, db_session, as_user, cognito_client):
    """AdminAddUserToGroup succeeds silently for an existing member; a
    claimant approved for a second brand is simply added again."""
    sub = str(uuid.uuid4())
    _, claim1, _, _ = await _submit(client, db_session, as_user, sub=sub)
    _, claim2, _, _ = await _submit(client, db_session, as_user, sub=sub)
    as_user("admin")
    for claim_id in (claim1, claim2):
        resp = await client.post(f"/claim/{claim_id}/approve", json={})
        assert resp.status_code == 200, resp.text
        assert resp.json()["owner_group_granted"] is True
    assert cognito_client.admin_add_user_to_group.call_count == 2
