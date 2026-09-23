"""Integration test: PATCH /auth/me — role scope (docs/PROJECT_PLAN.csv
"Broaden PATCH /auth/me beyond owner-only", then further generalized by
"Generic user display name for registered_user/manager" — see
app/models/user_profile.py and app/services/auth_service.py::update_me).

Found during PR #80's ("User profile / account details page") review:
`update_me` was gated by `Depends(require_owner)` with no stated reason a
manager/admin/registered_user shouldn't also be able to edit their own
basic profile — `GET /auth/me` already works for every role. Fixed by
widening the route's dependency to `get_current_user` (any authenticated
role, same posture the read side already uses).

The auth *gate* is fixed, but the underlying data model isn't: only
`owner_account` (root CLAUDE.md ownership hierarchy) has a local
`full_name`/`phone` row to write to. `manager`/`admin`/`registered_user`
have no local profile table at all (checked `backend/app/models/` — there
is no manager/admin/registered_user model; `location_manager.user_id` is
just a bare Cognito `sub` string, not a FK to a profile row). Their
name/phone, if editable at all, lives in Cognito attributes
(`given_name`/`family_name`/`phone_number`) — a frontend Amplify/Cognito
concern, not a backend DB write, and out of scope for this fix (inventing
a new Postgres table is Architect's call, not Backend Dev's to make
unilaterally).

So the "correct, honest outcome" for the 3 non-owner roles WAS a `404`
with an explicit `no_editable_profile` code — NOT a `403`. That's still
true for `admin` (see `test_admin_still_gets_honest_404`), but
`registered_user`/`manager` now have a real place to write to: the new
`user_profile` table (one row per Cognito `sub`, `full_name` only — see
app/models/user_profile.py's docstring for why this exists instead of a
Cognito `updateUserAttributes` call). `owner` is completely unaffected —
still `owner_account`, still audit-logged, still lazily provisioned.

Run against the real HTTP router + a real (SQLite) DB, same pattern as
test_admin_location_parity.py / test_managed_locations.py.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.user_profile import UserProfile
from factories import create_owner, create_user_profile


@pytest.mark.asyncio
async def test_owner_can_update_their_own_profile(client, db_session, as_user):
    # No name yet: the first set is allowed (a set name is locked, see
    # tests/integration/test_display_name_lock.py).
    owner = await create_owner(db_session, full_name=None)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.patch(
        "/auth/me", json={"full_name": "Priya Rao", "phone": "+14695559876"}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["full_name"] == "Priya Rao"

    await db_session.refresh(owner)
    assert owner.full_name == "Priya Rao"
    assert owner.phone == "+14695559876"


@pytest.mark.asyncio
async def test_get_me_returns_phone(client, db_session, as_user):
    """Regression for a real gap: `PATCH /auth/me` accepted `phone` from
    the start, but `GET /auth/me`'s `OwnerAccountOut` never returned it
    back — the account page's edit form could never pre-fill a phone the
    owner had already set, only silently overwrite it blind."""
    owner = await create_owner(db_session, full_name="Priya Rao", phone="+14695559876")
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.get("/auth/me")
    assert response.status_code == 200, response.text
    assert response.json()["owner_account"]["phone"] == "+14695559876"


@pytest.mark.asyncio
async def test_owner_update_writes_audit_log(client, db_session, as_user):
    """Regression for a gap found during this fix's self-review: root
    CLAUDE.md / docs/DECISIONS.md "Audit log on all core entity writes"
    requires an audit_log entry on every owner_account write, but
    update_me previously wrote none at all.
    """
    owner = await create_owner(db_session, full_name=None, phone=None)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.patch(
        "/auth/me", json={"full_name": "Priya Rao", "phone": "+14695559876"}
    )
    assert response.status_code == 200, response.text

    audit_row = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.table_name == "owner_account", AuditLog.record_id == owner.id
            )
        )
    ).scalar_one()
    assert audit_row.action == "update"
    assert audit_row.actor_id == owner.cognito_sub
    assert audit_row.actor_role == "owner"
    assert audit_row.old_val == {"full_name": None, "phone": None}
    assert audit_row.new_val == {"full_name": "Priya Rao", "phone": "+14695559876"}


@pytest.mark.asyncio
async def test_first_time_owner_is_lazily_provisioned_on_patch(client, db_session, as_user):
    """An owner who has never hit GET /auth/me yet (so no owner_account row
    exists) must still succeed on PATCH — same lazy-provisioning GET /auth/me
    already does, now reproduced here since the dependency no longer does
    it via `require_owner`.
    """
    as_user("owner", email="brand-new-owner@example.com")
    response = await client.patch("/auth/me", json={"full_name": "New Owner"})
    assert response.status_code == 200, response.text
    assert response.json()["full_name"] == "New Owner"


@pytest.mark.asyncio
async def test_admin_still_gets_honest_404(client, as_user):
    """`admin` is the one role left with no local profile record to PATCH
    (registered_user/manager gained `user_profile` — see the tests below).
    Must stay a `404 no_editable_profile`, never a bare `403` (not a
    permissions problem) and never a silent no-op `200` (root CLAUDE.md
    posture: no fabricated success).
    """
    as_user("admin")
    response = await client.patch("/auth/me", json={"full_name": "Someone", "phone": "+14695550000"})
    assert response.status_code == 404, response.text
    body = response.json()
    assert body["code"] == "no_editable_profile"
    assert "detail" in body


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["registered_user", "manager"])
async def test_registered_user_and_manager_can_set_and_read_back_full_name(client, db_session, role, as_user):
    """The new generalized capability: registered_user/manager now have
    somewhere to persist a display name (app/models/user_profile.py),
    upserted via PATCH /auth/me and readable back via GET /auth/me's
    unified `full_name` field -- no more 404.
    """
    user = as_user(role)

    patch_response = await client.patch("/auth/me", json={"full_name": "Asha Verma"})
    assert patch_response.status_code == 200, patch_response.text
    assert patch_response.json() == {"full_name": "Asha Verma"}

    get_response = await client.get("/auth/me")
    assert get_response.status_code == 200, get_response.text
    body = get_response.json()
    assert body["full_name"] == "Asha Verma"
    # owner_account stays null for these roles -- they have no business
    # record, only the new generic profile row.
    assert body["owner_account"] is None

    row = (
        await db_session.execute(
            select(UserProfile).where(UserProfile.cognito_sub == user.cognito_sub)
        )
    ).scalar_one()
    assert row.full_name == "Asha Verma"


@pytest.mark.asyncio
async def test_registered_user_can_update_an_existing_profile_row(client, db_session, as_user):
    """PATCH onto an existing row that has no name yet (e.g. created by
    `touch_last_seen`) is an update, not a duplicate insert -- exercises the
    upsert's "existing row" branch (the test above only ever exercises
    first-time creation). Changing an already-set name is locked instead,
    see test_display_name_lock.py.
    """
    user = as_user("registered_user")
    await create_user_profile(db_session, cognito_sub=user.cognito_sub, full_name=None)
    await db_session.commit()

    response = await client.patch("/auth/me", json={"full_name": "New Name"})
    assert response.status_code == 200, response.text
    assert response.json()["full_name"] == "New Name"

    rows = (
        await db_session.execute(
            select(UserProfile).where(UserProfile.cognito_sub == user.cognito_sub)
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].full_name == "New Name"


@pytest.mark.asyncio
async def test_manager_get_me_before_ever_setting_a_name(client, as_user):
    """No user_profile row yet -- GET must return `full_name: null`, not
    404/500 (get_user_profile_by_sub is a plain read, never lazily
    provisioning, unlike the owner_account path)."""
    as_user("manager")
    response = await client.get("/auth/me")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["full_name"] is None
    assert body["owner_account"] is None


@pytest.mark.asyncio
async def test_registered_user_empty_full_name_is_rejected(client, as_user):
    as_user("registered_user")
    response = await client.patch("/auth/me", json={"full_name": "   "})
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_registered_user_missing_full_name_is_rejected(client, as_user):
    """user_profile has nothing else to write -- omitting full_name entirely
    is a 400, not a silent no-op 200."""
    as_user("registered_user")
    response = await client.patch("/auth/me", json={})
    assert response.status_code == 400, response.text
    assert response.json()["code"] == "full_name_required"


@pytest.mark.asyncio
async def test_full_name_over_max_length_is_rejected(client, as_user):
    as_user("registered_user")
    response = await client.patch("/auth/me", json={"full_name": "x" * 256})
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_registered_user_profile_write_is_not_audit_logged(client, db_session, as_user):
    """Deliberate: user_profile isn't on root CLAUDE.md's audited-entity
    list (restaurant_brand, restaurant_location, menu_item, deal,
    owner_account, location_manager), and audit_log.record_id is a
    BigInteger that a Cognito `sub` string doesn't fit anyway -- see
    app/models/user_profile.py and auth_service.update_me's docstrings.
    """
    as_user("registered_user")
    response = await client.patch("/auth/me", json={"full_name": "Asha Verma"})
    assert response.status_code == 200, response.text

    rows = (
        await db_session.execute(
            select(AuditLog).where(AuditLog.table_name == "user_profile")
        )
    ).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_owner_full_name_unaffected_by_generalization(client, db_session, as_user):
    """Regression: the owner path must still go through owner_account only
    -- no stray user_profile row created for an owner caller."""
    owner = await create_owner(db_session, full_name="Priya Rao")
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.get("/auth/me")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["full_name"] == "Priya Rao"
    assert body["owner_account"]["full_name"] == "Priya Rao"

    profile_row = (
        await db_session.execute(
            select(UserProfile).where(UserProfile.cognito_sub == owner.cognito_sub)
        )
    ).scalar_one_or_none()
    assert profile_row is None


@pytest.mark.asyncio
async def test_unauthenticated_caller_is_still_rejected(client, as_anonymous):
    """Regression: broadening past require_owner must not broaden past
    authentication itself — no bearer token still 401s.
    """
    response = await client.patch("/auth/me", json={"full_name": "Nobody"})
    assert response.status_code == 401
