"""Integration tests: a display name is set once and then locked
(2026-09-23 user decision: "once the name is set, only way to change it is
contacting an admin").

Covers PATCH /auth/me for owner (owner_account.full_name) and
registered_user/manager (user_profile.full_name), plus the admin path --
the `set_user_name` management command
(backend/app/scripts/set_user_name.py). Real HTTP router + SQLite DB, same
pattern as test_update_me_role_scope.py.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.owner_account import OwnerAccount
from app.models.user_profile import UserProfile
from app.scripts.set_user_name import SetUserNameError, set_user_name
from factories import create_owner, create_user_profile


# ---------------------------------------------------------------- owner


@pytest.mark.asyncio
async def test_owner_first_set_works(client, db_session, as_user):
    owner = await create_owner(db_session, full_name=None)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.patch("/auth/me", json={"full_name": "Priya Rao"})
    assert response.status_code == 200, response.text
    assert response.json()["full_name"] == "Priya Rao"


@pytest.mark.asyncio
async def test_owner_change_after_set_is_rejected_and_writes_nothing(client, db_session, as_user):
    owner = await create_owner(db_session, full_name="Priya Rao", phone="+14695550001")
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    # A phone change riding in the same request must NOT half-apply.
    response = await client.patch(
        "/auth/me", json={"full_name": "Someone Else", "phone": "+14695559999"}
    )
    assert response.status_code == 409, response.text
    body = response.json()
    assert body["code"] == "name_locked"
    assert "detail" in body

    await db_session.refresh(owner)
    assert owner.full_name == "Priya Rao"
    assert owner.phone == "+14695550001"

    audit_rows = (
        await db_session.execute(select(AuditLog).where(AuditLog.table_name == "owner_account"))
    ).scalars().all()
    assert audit_rows == []


@pytest.mark.asyncio
async def test_owner_same_name_is_a_noop_and_phone_still_editable(client, db_session, as_user):
    owner = await create_owner(db_session, full_name="Priya Rao", phone=None)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.patch(
        "/auth/me", json={"full_name": "  Priya Rao  ", "phone": "+14695559876"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["full_name"] == "Priya Rao"
    assert response.json()["phone"] == "+14695559876"

    await db_session.refresh(owner)
    assert owner.full_name == "Priya Rao"
    assert owner.phone == "+14695559876"


@pytest.mark.asyncio
async def test_owner_phone_only_patch_works_when_name_is_locked(client, db_session, as_user):
    owner = await create_owner(db_session, full_name="Priya Rao", phone=None)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.patch("/auth/me", json={"phone": "+14695559876"})
    assert response.status_code == 200, response.text

    await db_session.refresh(owner)
    assert owner.full_name == "Priya Rao"
    assert owner.phone == "+14695559876"


# ------------------------------------------------- registered_user / manager


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["registered_user", "manager"])
async def test_profile_role_first_set_then_change_is_rejected(client, db_session, role, as_user):
    user = as_user(role)

    first = await client.patch("/auth/me", json={"full_name": "Asha Verma"})
    assert first.status_code == 200, first.text
    assert first.json() == {"full_name": "Asha Verma"}

    second = await client.patch("/auth/me", json={"full_name": "Asha V."})
    assert second.status_code == 409, second.text
    assert second.json()["code"] == "name_locked"

    row = (
        await db_session.execute(select(UserProfile).where(UserProfile.cognito_sub == user.cognito_sub))
    ).scalar_one()
    assert row.full_name == "Asha Verma"


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["registered_user", "manager"])
async def test_profile_role_same_name_is_a_noop(client, role, as_user):
    as_user(role)
    assert (await client.patch("/auth/me", json={"full_name": "Asha Verma"})).status_code == 200

    again = await client.patch("/auth/me", json={"full_name": "Asha Verma"})
    assert again.status_code == 200, again.text
    assert again.json() == {"full_name": "Asha Verma"}


@pytest.mark.asyncio
async def test_profile_row_without_a_name_can_still_be_set(client, db_session, as_user):
    """A `user_profile` row that only exists for `last_seen_at` (no name)
    is not "locked" -- the first real name still goes through."""
    user = as_user("registered_user")
    await create_user_profile(db_session, cognito_sub=user.cognito_sub, full_name=None)
    await db_session.commit()

    response = await client.patch("/auth/me", json={"full_name": "Asha Verma"})
    assert response.status_code == 200, response.text
    assert response.json() == {"full_name": "Asha Verma"}


# ------------------------------------------------------ admin path (command)


@pytest.mark.asyncio
async def test_admin_command_changes_owner_name_and_audit_logs(db_session):
    owner = await create_owner(db_session, full_name="Old Name")
    await db_session.commit()

    result = await set_user_name("New Name", cognito_sub=owner.cognito_sub, db=db_session)
    assert result == {"ok": True, "changed": True, "target": "owner_account", "full_name": "New Name"}

    await db_session.refresh(owner)
    assert owner.full_name == "New Name"
    audit = (
        await db_session.execute(
            select(AuditLog).where(AuditLog.table_name == "owner_account", AuditLog.record_id == owner.id)
        )
    ).scalar_one()
    assert audit.actor_role == "admin"
    assert audit.actor_id == "system:set_user_name"
    assert audit.old_val == {"full_name": "Old Name"}
    assert audit.new_val == {"full_name": "New Name"}


@pytest.mark.asyncio
async def test_admin_command_changes_user_profile_name(db_session):
    profile = await create_user_profile(db_session, cognito_sub="sub-diner-1", full_name="Old Name")
    await db_session.commit()

    result = await set_user_name("  New Name ", cognito_sub="sub-diner-1", db=db_session)
    assert result == {"ok": True, "changed": True, "target": "user_profile", "full_name": "New Name"}
    await db_session.refresh(profile)
    assert profile.full_name == "New Name"


@pytest.mark.asyncio
async def test_admin_command_same_name_is_noop(db_session):
    owner = await create_owner(db_session, full_name="Same Name")
    await db_session.commit()
    result = await set_user_name("Same Name", cognito_sub=owner.cognito_sub, db=db_session)
    assert result["ok"] is True and result["changed"] is False
    rows = (await db_session.execute(select(AuditLog))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_admin_command_refuses_user_with_no_name_set(db_session):
    owner = await create_owner(db_session, full_name=None)
    await db_session.commit()
    with pytest.raises(SetUserNameError, match="no name set"):
        await set_user_name("Name", cognito_sub=owner.cognito_sub, db=db_session)
    with pytest.raises(SetUserNameError, match="no name set"):
        await set_user_name("Name", cognito_sub="unknown-sub", db=db_session)


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", [None, "", "   ", 5, "x" * 256])
async def test_admin_command_rejects_bad_name(db_session, bad):
    with pytest.raises(SetUserNameError):
        await set_user_name(bad, cognito_sub="whatever", db=db_session)


@pytest.mark.asyncio
async def test_admin_command_needs_a_target(db_session):
    with pytest.raises(SetUserNameError, match="email"):
        await set_user_name("Name", db=db_session)


@pytest.mark.asyncio
async def test_locked_name_unlocked_flow_end_to_end(client, db_session, as_user):
    """Admin renames, and the user's own PATCH is still locked to the NEW name."""
    owner = await create_owner(db_session, full_name="Old Name")
    await db_session.commit()
    await set_user_name("New Name", cognito_sub=owner.cognito_sub, db=db_session)

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    same = await client.patch("/auth/me", json={"full_name": "New Name"})
    assert same.status_code == 200, same.text
    old = await client.patch("/auth/me", json={"full_name": "Old Name"})
    assert old.status_code == 409 and old.json()["code"] == "name_locked"
    fresh = (await db_session.execute(select(OwnerAccount).where(OwnerAccount.id == owner.id))).scalar_one()
    assert fresh.full_name == "New Name"
