"""owner_account resolution + /auth endpoints business logic.

`get_or_create_owner_account` backs two flows:
1. `GET /auth/me` — lazy-provisions the local `owner_account` row the
   first time a Cognito "owner" group user is seen (docs/API_CONTRACTS.md
   "GET /auth/me").
2. `POST /claim` submission — see `app/services/claim_service.py` module
   docstring for why claim submission also eagerly resolves/creates the
   claimant's `owner_account` row (judgment call flagged there).

`get_user_profile_by_sub` / `_upsert_user_profile` back the generalized
`registered_user`/`manager` half of `GET`/`PATCH /auth/me`, added
alongside `app/models/user_profile.py` (see that model's docstring for the
full rationale — a small generic table, read-your-write, deliberately not
Cognito `updateUserAttributes`). `owner` never touches `user_profile`;
`admin` has no editable profile source at all yet (unchanged, still 404s).

`touch_last_seen` backs the admin "Registered users" report's
"last visited" column (docs/PROJECT_PLAN.csv, docs/DECISIONS.md
"Registered-user last-seen tracking"). Called from
`app/dependencies/auth.py::_resolve_current_user` on every authenticated
request for a `registered_user`/`manager` caller — see that module for why
only those two roles are wired up (same `_PROFILE_TABLE_ROLES` split as
above) and for the try/except that makes this fully best-effort from the
caller's point of view (a failure here must never fail the request it rode
in on).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.owner_account import OwnerAccount
from app.models.user_profile import UserProfile
from app.schemas.auth import MeResponse, MeUpdateRequest, OwnerAccountOut, ProfileOut
from app.services import audit_service

_PROFILE_TABLE_ROLES = {"registered_user", "manager"}

# How stale `last_seen_at` has to be before an authenticated request writes
# a fresh value. Not a precision requirement (this backs an admin "last
# visited" report, not billing or security) — it exists purely to bound
# write volume: without it, every single authenticated request from an
# active user would issue a DB write. See `touch_last_seen` below.
_LAST_SEEN_THROTTLE_MINUTES = 5


async def get_owner_account_by_sub(db: AsyncSession, cognito_sub: str) -> OwnerAccount | None:
    result = await db.execute(
        select(OwnerAccount).where(OwnerAccount.cognito_sub == cognito_sub)
    )
    return result.scalar_one_or_none()


async def get_or_create_owner_account(
    db: AsyncSession, cognito_sub: str, email: str | None
) -> OwnerAccount:
    owner = await get_owner_account_by_sub(db, cognito_sub)
    if owner is not None:
        return owner

    if not email:
        raise AppError(
            400,
            "An email claim is required to provision an owner account",
            "email_required",
        )

    owner = OwnerAccount(cognito_sub=cognito_sub, email=email)
    db.add(owner)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        # Race with a concurrent request, or the email already belongs to
        # a different cognito_sub.
        existing = await get_owner_account_by_sub(db, cognito_sub)
        if existing is not None:
            return existing
        raise AppError(
            409, "An owner account with this email already exists", "email_conflict"
        )
    return owner


async def get_user_profile_by_sub(db: AsyncSession, cognito_sub: str) -> UserProfile | None:
    """Read-only lookup — unlike `get_or_create_owner_account`, this never
    lazily provisions a row. `GET /auth/me` for a `registered_user`/
    `manager` caller who has never set a name simply gets `full_name: null`
    back; a row only gets created on the first successful `PATCH /auth/me`
    (see `update_me` below).
    """
    result = await db.execute(
        select(UserProfile).where(UserProfile.cognito_sub == cognito_sub)
    )
    return result.scalar_one_or_none()


async def touch_last_seen(db: AsyncSession, cognito_sub: str) -> None:
    """Upsert `user_profile.last_seen_at = now()` for `cognito_sub`,
    throttled to at most one write per `_LAST_SEEN_THROTTLE_MINUTES`.

    Unlike `get_user_profile_by_sub` (strictly read-only, per its own
    docstring), this DOES lazily create a row — most `registered_user`
    callers never set a display name, so waiting for one would mean most
    diners never get a "last seen" value at all, defeating the point of
    the admin report this backs.

    Read-then-write (a plain `SELECT` followed by an `INSERT`/`UPDATE`),
    not a single atomic `INSERT ... ON CONFLICT` — deliberately, so this
    runs unchanged against both the real Postgres backend and the SQLite
    engine `tests/integration/conftest.py` uses (a dialect-specific
    upsert would only compile against one of the two). A lost update under
    concurrent requests from the same user within the same instant is
    possible in theory but harmless here: the field is a best-effort "last
    visited" display value, not a source of truth anything else reads for
    a correctness decision (contrast with `get_or_create_owner_account`,
    which uses `IntegrityError` recovery because a *duplicate owner
    account* would be a real bug, not just an off-by-a-few-seconds
    timestamp).

    Commits on its own (same as `get_or_create_owner_account`) — the
    caller (`app/dependencies/auth.py`) invokes this from inside a
    dependency that runs before the route body, wraps it in a broad
    try/except, and rolls back on any failure so a problem here can never
    surface as, or block, the caller's actual response.
    """
    now = datetime.now(timezone.utc)
    threshold = now - timedelta(minutes=_LAST_SEEN_THROTTLE_MINUTES)

    profile = await get_user_profile_by_sub(db, cognito_sub)
    if profile is None:
        db.add(UserProfile(cognito_sub=cognito_sub, last_seen_at=now))
    elif profile.last_seen_at is None or profile.last_seen_at < threshold:
        profile.last_seen_at = now
    else:
        # Throttled — last write was recent enough, skip the DB write.
        return

    await db.commit()


def _owner_out(owner: OwnerAccount) -> OwnerAccountOut:
    return OwnerAccountOut(
        id=owner.id,
        full_name=owner.full_name,
        phone=owner.phone,
        stripe_customer_id=owner.stripe_customer_id,
    )


async def get_me(db: AsyncSession, current_user) -> MeResponse:
    owner_out = None
    full_name: str | None = None

    if current_user.role == "owner":
        owner = await get_or_create_owner_account(db, current_user.cognito_sub, current_user.email)
        await db.commit()
        owner_out = _owner_out(owner)
        full_name = owner.full_name
    elif current_user.role in _PROFILE_TABLE_ROLES:
        profile = await get_user_profile_by_sub(db, current_user.cognito_sub)
        full_name = profile.full_name if profile is not None else None
    # admin: no local profile source yet, full_name stays None.

    return MeResponse(
        cognito_sub=current_user.cognito_sub,
        role=current_user.role,
        email=current_user.email,
        full_name=full_name,
        owner_account=owner_out,
    )


def _reject_name_change_if_locked(current: str | None, requested: str | None) -> None:
    """Enforces "a display name is set once" (see `update_me`). `requested`
    is already trimmed by `MeUpdateRequest`; `current` is normalised the same
    way here so a stored value with stray whitespace still counts as set and
    an identical re-send still compares equal. No-op when nothing is being
    renamed, when no name is stored yet (first set), or when the request
    repeats the stored name.
    """
    if requested is None:
        return
    existing = (current or "").strip()
    if existing and requested != existing:
        raise AppError(
            409,
            "Your name is already set and can't be changed here. "
            "Contact an admin if it needs to be updated.",
            "name_locked",
        )


async def update_me(
    db: AsyncSession, current_user, body: MeUpdateRequest
) -> OwnerAccountOut | ProfileOut:
    """Self-scoped profile update — any authenticated role may call this
    (docs/PROJECT_PLAN.csv "Broaden PATCH /auth/me beyond owner-only"), but
    which local record it writes to depends on the caller's role:

    - `owner`: `owner_account.full_name`/`.phone`, exactly as before this
      change — lazily provisioned on first write, audit-logged (it's on
      root CLAUDE.md's audited-entity list).
    - `registered_user` / `manager`: `user_profile.full_name` (upserted —
      see `app/models/user_profile.py`). `phone` is silently ignored for
      these roles (`user_profile` has no phone column; there was never a
      contract promising it'd be persisted for a non-owner caller). NOT
      audit-logged — `user_profile` isn't on root CLAUDE.md's audited-
      entity list (restaurant_brand, restaurant_location, menu_item, deal,
      owner_account, location_manager) and `audit_log.record_id` is a
      `BigInteger`, which a Cognito `sub` string doesn't fit anyway.
    - **Name lock** (added 2026-09-23, user decision): `full_name` can be
      SET once but never CHANGED through this route — once a non-empty name
      is stored (owner_account or user_profile), a PATCH carrying a
      *different* `full_name` is rejected `409 name_locked` and nothing is
      written. Re-sending the identical stored name is a harmless no-op.
      The only way to change a locked name is an admin running the
      `set_user_name` management command (app/scripts/set_user_name.py).
      Enforced here, server-side — the account UI just hides the form.
    - `admin`: still no local record to write to — `404
      no_editable_profile`, unchanged from before this change. The
      distinction matters: it is not a permissions problem (every role may
      call this route), it's that there is nowhere yet to persist it for
      admin specifically.
    """
    if current_user.role == "owner":
        owner = await get_or_create_owner_account(db, current_user.cognito_sub, current_user.email)
        old_val = {"full_name": owner.full_name, "phone": owner.phone}

        # Checked BEFORE any field is touched so a rejected rename never
        # half-applies (e.g. a phone change riding in the same request).
        _reject_name_change_if_locked(owner.full_name, body.full_name)

        if body.full_name is not None:
            owner.full_name = body.full_name
        if body.phone is not None:
            owner.phone = body.phone

        new_val = {"full_name": owner.full_name, "phone": owner.phone}

        # ALWAYS write audit_log for owner_account writes (root CLAUDE.md
        # "ALWAYS — Quality"; docs/DECISIONS.md "Audit log on all core
        # entity writes" explicitly lists owner_account).
        await audit_service.log(
            db,
            table_name="owner_account",
            record_id=owner.id,
            action="update",
            actor_id=current_user.cognito_sub,
            actor_role=current_user.role,
            old_val=old_val,
            new_val=new_val,
        )

        await db.commit()
        return _owner_out(owner)

    if current_user.role in _PROFILE_TABLE_ROLES:
        if body.full_name is None:
            raise AppError(400, "full_name is required", "full_name_required")

        profile = await get_user_profile_by_sub(db, current_user.cognito_sub)
        if profile is None:
            profile = UserProfile(cognito_sub=current_user.cognito_sub, full_name=body.full_name)
            db.add(profile)
        else:
            _reject_name_change_if_locked(profile.full_name, body.full_name)
            profile.full_name = body.full_name

        await db.commit()
        return ProfileOut(full_name=profile.full_name)

    raise AppError(
        404,
        "This account has no editable profile record on this platform "
        "yet. Contact support if your name or phone needs to change.",
        "no_editable_profile",
    )
