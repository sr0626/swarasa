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
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.owner_account import OwnerAccount
from app.models.user_profile import UserProfile
from app.schemas.auth import MeResponse, MeUpdateRequest, OwnerAccountOut, ProfileOut
from app.services import audit_service

_PROFILE_TABLE_ROLES = {"registered_user", "manager"}


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
    - `admin`: still no local record to write to — `404
      no_editable_profile`, unchanged from before this change. The
      distinction matters: it is not a permissions problem (every role may
      call this route), it's that there is nowhere yet to persist it for
      admin specifically.
    """
    if current_user.role == "owner":
        owner = await get_or_create_owner_account(db, current_user.cognito_sub, current_user.email)
        old_val = {"full_name": owner.full_name, "phone": owner.phone}

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
            profile.full_name = body.full_name

        await db.commit()
        return ProfileOut(full_name=profile.full_name)

    raise AppError(
        404,
        "This account has no editable profile record on this platform "
        "yet. Contact support if your name or phone needs to change.",
        "no_editable_profile",
    )
