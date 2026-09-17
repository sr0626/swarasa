"""Integration test: PATCH /auth/me — role scope (docs/PROJECT_PLAN.csv
"Broaden PATCH /auth/me beyond owner-only").

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

So the "correct, honest outcome" for the 3 non-owner roles is a `404` with
an explicit `no_editable_profile` code — NOT the old `403`. The
distinction matters: it's not a permissions problem (every authenticated
role may call this route now), there's just nothing local to PATCH yet.

Run against the real HTTP router + a real (SQLite) DB, same pattern as
test_admin_location_parity.py / test_managed_locations.py.
"""
from __future__ import annotations

import pytest

from factories import create_owner


@pytest.mark.asyncio
async def test_owner_can_update_their_own_profile(client, db_session, as_user):
    owner = await create_owner(db_session, full_name="Old Name")
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
@pytest.mark.parametrize("role", ["manager", "admin", "registered_user"])
async def test_non_owner_roles_get_honest_404_not_403(client, role, as_user):
    """The bug: these 3 roles used to get a blanket 403 purely from the
    role gate (require_owner), even though there's no permissions problem —
    they're just missing a local record to PATCH. Broadening the auth
    dependency must not turn that into a silent no-op 200 either (root
    CLAUDE.md posture: no fabricated data/success) — it must be an honest,
    explicit 404 with a distinct code, not the old 403.
    """
    as_user(role)
    response = await client.patch("/auth/me", json={"full_name": "Someone", "phone": "+14695550000"})
    assert response.status_code == 404, response.text
    body = response.json()
    assert body["code"] == "no_editable_profile"
    assert "detail" in body


@pytest.mark.asyncio
async def test_unauthenticated_caller_is_still_rejected(client, as_anonymous):
    """Regression: broadening past require_owner must not broaden past
    authentication itself — no bearer token still 401s.
    """
    response = await client.patch("/auth/me", json={"full_name": "Nobody"})
    assert response.status_code == 401
