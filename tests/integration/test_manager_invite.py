"""Integration tests: manager invite-by-email — docs/API_CONTRACTS.md
"Manager invites".

Real HTTP router + real `manager_invite_service` + SQLite, same fixture
approach as `test_manager_assignment_rules.py`. `cognito_service.
add_user_to_group` is a no-op by default (conftest autouse); tests that care
re-patch it.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.location_manager import LocationManager
from app.models.manager_invite import REDACTED_EMAIL, ManagerInvite
from app.services import cognito_service, manager_invite_service
from factories import create_brand, create_location, create_location_manager, create_owner


async def _owner_with_location(db_session, **location_overrides):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id, **location_overrides)
    await db_session.commit()
    return owner, brand, location


async def _invite(client, as_user, owner, location, email="Sam.Cook@Example.com"):
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.post(
        f"/locations/{location.id}/manager-invites", json={"email": email}
    )
    return response


# --------------------------------------------------------------------------
# Creating invites (owner / admin)
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_owner_creates_invite_token_returned_once_and_only_hash_stored(
    client, db_session, as_user
):
    owner, _, location = await _owner_with_location(db_session)

    response = await _invite(client, as_user, owner, location)
    assert response.status_code == 201, response.text
    body = response.json()
    token = body["token"]
    assert len(token) >= 43  # 32 random bytes, urlsafe base64
    assert body["email"] == "sam.cook@example.com"  # lowercased
    assert body["status"] == "pending"
    assert body["location_id"] == location.id

    row = (await db_session.execute(select(ManagerInvite))).scalar_one()
    assert row.token_hash == manager_invite_service.hash_token(token)
    assert token not in (row.token_hash, row.email)
    assert row.invited_by_owner_id == owner.id
    assert row.accepted_at is None and row.revoked_at is None
    ttl = row.expires_at.replace(tzinfo=timezone.utc) - row.created_at.replace(tzinfo=timezone.utc)
    assert ttl == timedelta(days=manager_invite_service.INVITE_TTL_DAYS)

    # The list never carries the token.
    listing = await client.get(f"/locations/{location.id}/manager-invites")
    assert listing.status_code == 200
    items = listing.json()["results"]
    assert [i["email"] for i in items] == ["sam.cook@example.com"]
    assert "token" not in items[0]
    assert listing.json()["total"] == 1


@pytest.mark.asyncio
async def test_create_invite_is_audited_without_the_email(client, db_session, as_user):
    owner, _, location = await _owner_with_location(db_session)
    response = await _invite(client, as_user, owner, location)
    invite_id = response.json()["id"]

    audit = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.table_name == "manager_invite", AuditLog.record_id == invite_id
            )
        )
    ).scalar_one()
    assert audit.action == "create"
    assert audit.actor_id == owner.cognito_sub
    assert "sam.cook" not in str(audit.new_val).lower()


@pytest.mark.asyncio
async def test_other_owner_manager_and_diner_cannot_create_invites(client, db_session, as_user):
    owner, _, location = await _owner_with_location(db_session)
    other_owner = await create_owner(db_session)
    await db_session.commit()

    for role, sub, email in (
        ("owner", other_owner.cognito_sub, other_owner.email),
        ("manager", str(uuid.uuid4()), "m@example.com"),
        ("registered_user", str(uuid.uuid4()), "d@example.com"),
    ):
        as_user(role, sub=sub, email=email)
        response = await client.post(
            f"/locations/{location.id}/manager-invites", json={"email": "x@example.com"}
        )
        assert response.status_code == 403, role

    rows = (await db_session.execute(select(ManagerInvite))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_admin_can_invite_on_behalf_of_the_owner(client, db_session, as_user):
    owner, _, location = await _owner_with_location(db_session)
    admin = as_user("admin")

    response = await client.post(
        f"/locations/{location.id}/manager-invites", json={"email": "new@example.com"}
    )
    assert response.status_code == 201, response.text

    row = (await db_session.execute(select(ManagerInvite))).scalar_one()
    assert row.invited_by_owner_id == owner.id  # the owner, not the admin
    audit = (
        await db_session.execute(
            select(AuditLog).where(AuditLog.table_name == "manager_invite")
        )
    ).scalar_one()
    assert audit.actor_id == admin.cognito_sub
    assert audit.actor_role == "admin"


@pytest.mark.asyncio
async def test_invite_on_unclaimed_location_is_rejected(client, db_session, as_user):
    brand = await create_brand(db_session, owner_id=None)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()
    as_user("admin")

    response = await client.post(
        f"/locations/{location.id}/manager-invites", json={"email": "new@example.com"}
    )
    assert response.status_code == 409
    assert response.json()["code"] == "owner_required"


@pytest.mark.asyncio
async def test_invalid_email_is_a_422(client, db_session, as_user):
    owner, _, location = await _owner_with_location(db_session)
    response = await _invite(client, as_user, owner, location, email="not-an-email")
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_creating_never_reveals_whether_the_email_has_an_account_or_other_owner(
    client, db_session, as_user, monkeypatch
):
    """Invite creation does no Cognito lookup and no cross-owner check, so the
    response is identical for a brand-new address and for one that already
    manages another owner's location."""
    owner, _, location = await _owner_with_location(db_session)
    other_owner, _, other_location = await _owner_with_location(db_session)
    sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=other_location.id, user_id=sub)
    await db_session.commit()

    def _boom(*args, **kwargs):  # pragma: no cover - must never run
        raise AssertionError("invite creation must not query Cognito")

    monkeypatch.setattr(cognito_service, "find_sub_by_email", _boom)
    monkeypatch.setattr(cognito_service, "find_email_by_sub", _boom)

    fresh = await _invite(client, as_user, owner, location, email="brand-new@example.com")
    taken = await _invite(client, as_user, owner, location, email="already-elsewhere@example.com")
    assert fresh.status_code == taken.status_code == 201
    assert set(fresh.json()) == set(taken.json())


@pytest.mark.asyncio
async def test_new_invite_supersedes_a_pending_one_for_the_same_email(client, db_session, as_user):
    owner, _, location = await _owner_with_location(db_session)
    first = (await _invite(client, as_user, owner, location)).json()
    second = (await _invite(client, as_user, owner, location)).json()
    assert first["token"] != second["token"]

    as_user("registered_user", email="x@example.com")
    old = await client.post("/manager-invites/preview", json={"token": first["token"]})
    new = await client.post("/manager-invites/preview", json={"token": second["token"]})
    assert old.status_code == 404
    assert new.status_code == 200

    # (the preview calls above switched the user; re-auth as the owner)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    listing = await client.get(f"/locations/{location.id}/manager-invites")
    assert [i["id"] for i in listing.json()["results"]] == [second["id"]]


@pytest.mark.asyncio
async def test_invite_creation_is_rate_limited_per_owner(client, db_session, as_user):
    owner, _, location = await _owner_with_location(db_session)
    for i in range(manager_invite_service.INVITES_PER_OWNER_PER_DAY):
        response = await _invite(client, as_user, owner, location, email=f"p{i}@example.com")
        assert response.status_code == 201, (i, response.text)

    blocked = await _invite(client, as_user, owner, location, email="one-too-many@example.com")
    assert blocked.status_code == 429
    assert blocked.json()["code"] == "invite_rate_limited"

    # Another owner is unaffected.
    other_owner, _, other_location = await _owner_with_location(db_session)
    ok = await _invite(client, as_user, other_owner, other_location, email="fine@example.com")
    assert ok.status_code == 201


@pytest.mark.asyncio
async def test_rate_limit_window_is_24_hours(client, db_session, as_user):
    owner, _, location = await _owner_with_location(db_session)
    for i in range(manager_invite_service.INVITES_PER_OWNER_PER_DAY):
        response = await _invite(client, as_user, owner, location, email=f"p{i}@example.com")
        assert response.status_code == 201
    # Age every invite past the window.
    rows = (await db_session.execute(select(ManagerInvite))).scalars().all()
    for row in rows:
        row.created_at = datetime.now(timezone.utc) - timedelta(days=1, minutes=1)
    await db_session.commit()

    again = await _invite(client, as_user, owner, location, email="later@example.com")
    assert again.status_code == 201


@pytest.mark.asyncio
async def test_cannot_invite_when_location_is_at_the_paid_manager_cap(client, db_session, as_user):
    owner, _, location = await _owner_with_location(db_session, is_paid=True)
    for _ in range(2):
        await create_location_manager(db_session, location_id=location.id)
    await db_session.commit()

    response = await _invite(client, as_user, owner, location)
    assert response.status_code == 409
    assert response.json()["code"] == "manager_cap_reached"


# --------------------------------------------------------------------------
# Revoking
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_revoke_kills_the_link_redacts_email_and_is_idempotent(client, db_session, as_user):
    owner, _, location = await _owner_with_location(db_session)
    created = (await _invite(client, as_user, owner, location)).json()

    first = await client.delete(f"/locations/{location.id}/manager-invites/{created['id']}")
    again = await client.delete(f"/locations/{location.id}/manager-invites/{created['id']}")
    assert first.status_code == 204
    assert again.status_code == 204

    row = (await db_session.execute(select(ManagerInvite))).scalar_one()
    assert row.revoked_at is not None
    assert row.email == REDACTED_EMAIL

    preview = await client.post("/manager-invites/preview", json={"token": created["token"]})
    assert preview.status_code == 404
    assert preview.json()["code"] == "invite_invalid"

    listing = await client.get(f"/locations/{location.id}/manager-invites")
    assert listing.json()["results"] == []


@pytest.mark.asyncio
async def test_revoke_from_another_locations_path_is_404(client, db_session, as_user):
    owner, brand, location = await _owner_with_location(db_session)
    other_location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()
    created = (await _invite(client, as_user, owner, location)).json()

    response = await client.delete(
        f"/locations/{other_location.id}/manager-invites/{created['id']}"
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_other_owner_cannot_revoke_or_list(client, db_session, as_user):
    owner, _, location = await _owner_with_location(db_session)
    other_owner = await create_owner(db_session)
    await db_session.commit()
    created = (await _invite(client, as_user, owner, location)).json()

    as_user("owner", sub=other_owner.cognito_sub, email=other_owner.email)
    assert (
        await client.delete(f"/locations/{location.id}/manager-invites/{created['id']}")
    ).status_code == 403
    assert (await client.get(f"/locations/{location.id}/manager-invites")).status_code == 403


@pytest.mark.asyncio
async def test_expired_invites_stay_listed_as_expired(client, db_session, as_user):
    owner, _, location = await _owner_with_location(db_session)
    await _invite(client, as_user, owner, location)
    row = (await db_session.execute(select(ManagerInvite))).scalar_one()
    row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    await db_session.commit()

    listing = await client.get(f"/locations/{location.id}/manager-invites")
    assert [i["status"] for i in listing.json()["results"]] == ["expired"]


# --------------------------------------------------------------------------
# Preview (public)
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_preview_is_public_masks_the_email_and_names_the_restaurant(
    client, db_session, as_user
):
    owner, brand, location = await _owner_with_location(db_session, city="Plano")
    created = (await _invite(client, as_user, owner, location, email="jane.doe@example.com")).json()

    from app.dependencies.auth import get_current_user
    from app.main import app as app_main

    app_main.dependency_overrides.pop(get_current_user, None)  # truly anonymous

    response = await client.post("/manager-invites/preview", json={"token": created["token"]})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["email_hint"] == "j***@example.com"
    assert "jane.doe" not in response.text
    assert body["brand_name"] == brand.name
    assert body["city"] == "Plano"


@pytest.mark.asyncio
async def test_preview_unknown_token_is_the_generic_404(client):
    response = await client.post("/manager-invites/preview", json={"token": "x" * 43})
    assert response.status_code == 404
    assert response.json()["code"] == "invite_invalid"


@pytest.mark.asyncio
async def test_preview_expired_token_is_the_same_generic_404(client, db_session, as_user):
    owner, _, location = await _owner_with_location(db_session)
    created = (await _invite(client, as_user, owner, location)).json()
    row = (await db_session.execute(select(ManagerInvite))).scalar_one()
    row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db_session.commit()

    response = await client.post("/manager-invites/preview", json={"token": created["token"]})
    unknown = await client.post("/manager-invites/preview", json={"token": "y" * 43})
    assert response.status_code == unknown.status_code == 404
    assert response.json() == unknown.json()


# --------------------------------------------------------------------------
# Accepting
# --------------------------------------------------------------------------


async def _created_token(client, as_user, owner, location, email="invitee@example.com"):
    return (await _invite(client, as_user, owner, location, email=email)).json()["token"]


@pytest.mark.asyncio
async def test_accept_creates_the_assignment_adds_manager_group_and_audits(
    client, db_session, as_user, monkeypatch
):
    owner, _, location = await _owner_with_location(db_session)
    token = await _created_token(client, as_user, owner, location)

    calls: list[tuple[str, str]] = []
    monkeypatch.setattr(
        cognito_service, "add_user_to_group", lambda username, group_name: calls.append((username, group_name))
    )

    sub = str(uuid.uuid4())
    as_user("registered_user", sub=sub, email="Invitee@Example.com")
    response = await client.post("/manager-invites/accept", json={"token": token})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["location_id"] == location.id
    assert body["sign_in_again"] is True
    assert calls == [(sub, "manager")]

    manager = (await db_session.execute(select(LocationManager))).scalar_one()
    assert manager.user_id == sub
    assert manager.location_id == location.id
    assert manager.is_active is True
    assert manager.assigned_by_owner_id == owner.id

    invite = (await db_session.execute(select(ManagerInvite))).scalar_one()
    assert invite.accepted_at is not None
    assert invite.email == REDACTED_EMAIL

    audit = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.table_name == "location_manager", AuditLog.record_id == manager.id
            )
        )
    ).scalar_one()
    assert audit.action == "create"
    assert audit.actor_id == sub
    assert audit.new_val["via_invite_id"] == invite.id


@pytest.mark.asyncio
async def test_token_is_single_use(client, db_session, as_user):
    owner, _, location = await _owner_with_location(db_session)
    token = await _created_token(client, as_user, owner, location)

    as_user("registered_user", email="invitee@example.com")
    assert (await client.post("/manager-invites/accept", json={"token": token})).status_code == 200

    # Even another account with the right email can't reuse it.
    as_user("registered_user", email="invitee@example.com")
    again = await client.post("/manager-invites/accept", json={"token": token})
    assert again.status_code == 404
    assert again.json()["code"] == "invite_invalid"
    managers = (await db_session.execute(select(LocationManager))).scalars().all()
    assert len(managers) == 1


@pytest.mark.asyncio
async def test_accept_for_an_account_already_in_the_manager_group_skips_the_group_call(
    client, db_session, as_user, monkeypatch
):
    owner, _, location = await _owner_with_location(db_session)
    token = await _created_token(client, as_user, owner, location)
    calls: list = []
    monkeypatch.setattr(cognito_service, "add_user_to_group", lambda u, g: calls.append((u, g)))

    as_user("manager", email="invitee@example.com")
    response = await client.post("/manager-invites/accept", json={"token": token})
    assert response.status_code == 200, response.text
    assert response.json()["sign_in_again"] is False
    assert calls == []


@pytest.mark.asyncio
async def test_accept_with_a_different_email_is_the_generic_404_and_changes_nothing(
    client, db_session, as_user
):
    owner, _, location = await _owner_with_location(db_session)
    token = await _created_token(client, as_user, owner, location, email="invitee@example.com")

    as_user("registered_user", email="someone-else@example.com")
    response = await client.post("/manager-invites/accept", json={"token": token})
    assert response.status_code == 404
    assert response.json()["code"] == "invite_invalid"

    assert (await db_session.execute(select(LocationManager))).scalars().all() == []
    invite = (await db_session.execute(select(ManagerInvite))).scalar_one()
    assert invite.accepted_at is None  # still usable by the real invitee


@pytest.mark.asyncio
async def test_accept_expired_and_revoked_tokens_fail_generically(client, db_session, as_user):
    owner, _, location = await _owner_with_location(db_session)
    expired = await _created_token(client, as_user, owner, location, email="a@example.com")
    revoked_created = (await _invite(client, as_user, owner, location, email="b@example.com")).json()

    rows = (await db_session.execute(select(ManagerInvite).order_by(ManagerInvite.id))).scalars().all()
    rows[0].expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    await client.delete(f"/locations/{location.id}/manager-invites/{revoked_created['id']}")

    for token, email in ((expired, "a@example.com"), (revoked_created["token"], "b@example.com")):
        as_user("registered_user", email=email)
        response = await client.post("/manager-invites/accept", json={"token": token})
        assert response.status_code == 404
        assert response.json()["code"] == "invite_invalid"
    assert (await db_session.execute(select(LocationManager))).scalars().all() == []


@pytest.mark.asyncio
async def test_owner_and_admin_accounts_cannot_accept(client, db_session, as_user):
    owner, _, location = await _owner_with_location(db_session)
    token = await _created_token(client, as_user, owner, location)

    for role in ("owner", "admin"):
        as_user(role, email="invitee@example.com")
        response = await client.post("/manager-invites/accept", json={"token": token})
        assert response.status_code == 403, role
        assert response.json()["code"] == "invite_wrong_account_type"
    invite = (await db_session.execute(select(ManagerInvite))).scalar_one()
    assert invite.accepted_at is None


@pytest.mark.asyncio
async def test_accept_requires_authentication(client, db_session, as_user):
    owner, _, location = await _owner_with_location(db_session)
    token = await _created_token(client, as_user, owner, location)
    from app.main import app as app_main
    from app.dependencies.auth import get_current_user

    app_main.dependency_overrides.pop(get_current_user, None)
    response = await client.post("/manager-invites/accept", json={"token": token})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_accept_enforces_the_cross_owner_rule_with_a_generic_message(
    client, db_session, as_user
):
    owner, _, location = await _owner_with_location(db_session)
    _, _, other_location = await _owner_with_location(db_session)
    sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=other_location.id, user_id=sub)
    await db_session.commit()
    token = await _created_token(client, as_user, owner, location)

    as_user("manager", sub=sub, email="invitee@example.com")
    response = await client.post("/manager-invites/accept", json={"token": token})
    assert response.status_code == 409
    body = response.json()
    assert body["code"] == "invite_cannot_be_accepted"
    # No tenant disclosure.
    assert "owner" not in body["detail"].lower()
    assert "another" not in body["detail"].lower()

    managers = (
        await db_session.execute(select(LocationManager).where(LocationManager.location_id == location.id))
    ).scalars().all()
    assert managers == []
    invite = (await db_session.execute(select(ManagerInvite))).scalar_one()
    assert invite.accepted_at is None


@pytest.mark.asyncio
async def test_accept_enforces_the_paid_location_manager_cap(client, db_session, as_user):
    owner, _, location = await _owner_with_location(db_session, is_paid=True)
    token = await _created_token(client, as_user, owner, location)
    # The location fills up AFTER the invite was issued.
    for _ in range(2):
        await create_location_manager(db_session, location_id=location.id)
    await db_session.commit()

    as_user("registered_user", email="invitee@example.com")
    response = await client.post("/manager-invites/accept", json={"token": token})
    assert response.status_code == 409
    assert response.json()["code"] == "invite_cannot_be_accepted"
    assert "maximum" not in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_accept_enforces_the_per_manager_paid_location_cap(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    target = await create_location(db_session, brand_id=brand.id, is_paid=True)
    busy_1 = await create_location(db_session, brand_id=brand.id, is_paid=True)
    busy_2 = await create_location(db_session, brand_id=brand.id, is_paid=True)
    sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=busy_1.id, user_id=sub)
    await create_location_manager(db_session, location_id=busy_2.id, user_id=sub)
    await db_session.commit()
    token = await _created_token(client, as_user, owner, target)

    as_user("manager", sub=sub, email="invitee@example.com")
    response = await client.post("/manager-invites/accept", json={"token": token})
    assert response.status_code == 409
    assert response.json()["code"] == "invite_cannot_be_accepted"


@pytest.mark.asyncio
async def test_same_owner_manager_of_another_location_can_accept_a_second_invite(
    client, db_session, as_user
):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    first = await create_location(db_session, brand_id=brand.id)
    second = await create_location(db_session, brand_id=brand.id)
    sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=first.id, user_id=sub)
    await db_session.commit()
    token = await _created_token(client, as_user, owner, second)

    as_user("manager", sub=sub, email="invitee@example.com")
    response = await client.post("/manager-invites/accept", json={"token": token})
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_accept_when_already_an_active_manager_here_adds_no_duplicate(
    client, db_session, as_user
):
    owner, _, location = await _owner_with_location(db_session)
    sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location.id, user_id=sub)
    await db_session.commit()
    token = await _created_token(client, as_user, owner, location)

    as_user("manager", sub=sub, email="invitee@example.com")
    response = await client.post("/manager-invites/accept", json={"token": token})
    assert response.status_code == 200
    managers = (await db_session.execute(select(LocationManager))).scalars().all()
    assert len(managers) == 1


@pytest.mark.asyncio
async def test_cognito_group_failure_leaves_nothing_half_applied_and_is_retryable(
    client, db_session, as_user, monkeypatch
):
    owner, _, location = await _owner_with_location(db_session)
    token = await _created_token(client, as_user, owner, location)

    def _fail(username, group_name):
        raise RuntimeError("cognito down")

    monkeypatch.setattr(cognito_service, "add_user_to_group", _fail)
    as_user("registered_user", email="invitee@example.com")
    response = await client.post("/manager-invites/accept", json={"token": token})
    assert response.status_code == 503
    assert response.json()["code"] == "invite_try_again"
    assert "cognito" not in response.text.lower()

    assert (await db_session.execute(select(LocationManager))).scalars().all() == []
    invite = (await db_session.execute(select(ManagerInvite))).scalar_one()
    assert invite.accepted_at is None

    # Retry once Cognito is back.
    monkeypatch.setattr(cognito_service, "add_user_to_group", lambda u, g: None)
    as_user("registered_user", email="invitee@example.com")
    assert (await client.post("/manager-invites/accept", json={"token": token})).status_code == 200


@pytest.mark.asyncio
async def test_accept_after_the_location_changed_hands_is_rejected(client, db_session, as_user):
    from app.models.restaurant_brand import RestaurantBrand

    owner, brand, location = await _owner_with_location(db_session)
    new_owner = await create_owner(db_session)
    token = await _created_token(client, as_user, owner, location)
    row = await db_session.get(RestaurantBrand, brand.id)
    row.owner_id = new_owner.id
    await db_session.commit()

    as_user("registered_user", email="invitee@example.com")
    response = await client.post("/manager-invites/accept", json={"token": token})
    assert response.status_code == 404
    assert response.json()["code"] == "invite_invalid"


# --------------------------------------------------------------------------
# CCPA export / deletion
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ccpa_export_lists_sent_and_received_invites(client, db_session, as_user):
    from app.dependencies.auth import CurrentUser
    from app.services import privacy_service

    owner, _, location = await _owner_with_location(db_session)
    await _invite(client, as_user, owner, location, email="friend@example.com")

    owner_user = CurrentUser(
        cognito_sub=owner.cognito_sub, email=owner.email, role="owner"
    )
    sent = (await privacy_service.export_my_data(db_session, owner_user)).manager_invites
    assert [(i.direction, i.email, i.status) for i in sent] == [
        ("sent", "friend@example.com", "pending")
    ]

    invitee = CurrentUser(
        cognito_sub=str(uuid.uuid4()), email="Friend@Example.com", role="registered_user"
    )
    received = (await privacy_service.export_my_data(db_session, invitee)).manager_invites
    assert [(i.direction, i.location_id) for i in received] == [("received", location.id)]

    stranger = CurrentUser(
        cognito_sub=str(uuid.uuid4()), email="stranger@example.com", role="registered_user"
    )
    assert (await privacy_service.export_my_data(db_session, stranger)).manager_invites == []


@pytest.mark.asyncio
async def test_ccpa_deletion_redacts_and_revokes_invites_for_both_sides(
    client, db_session, as_user, monkeypatch
):
    from app.services import privacy_service
    from factories import create_deletion_request

    owner, _, location = await _owner_with_location(db_session)
    await _invite(client, as_user, owner, location, email="friend@example.com")
    invitee_sub = str(uuid.uuid4())
    monkeypatch.setattr(
        cognito_service,
        "find_email_by_sub",
        lambda sub: "friend@example.com" if sub == invitee_sub else None,
    )

    # Invitee-side: matched through the identity's login email.
    request = await create_deletion_request(db_session, requester_user_id=invitee_sub)
    await db_session.commit()
    await privacy_service.approve_deletion_request(db_session, request.id, "admin-sub", None)

    row = (await db_session.execute(select(ManagerInvite))).scalar_one()
    assert row.email == REDACTED_EMAIL
    assert row.revoked_at is not None

    # Owner-side: a second invite sent by an owner whose data is deleted.
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    await client.post(f"/locations/{location.id}/manager-invites", json={"email": "other@example.com"})
    request = await create_deletion_request(db_session, requester_user_id=owner.cognito_sub)
    await db_session.commit()
    await privacy_service.approve_deletion_request(db_session, request.id, "admin-sub", None)

    rows = (await db_session.execute(select(ManagerInvite))).scalars().all()
    assert {r.email for r in rows} == {REDACTED_EMAIL}
    assert all(r.revoked_at is not None for r in rows)
