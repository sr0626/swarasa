"""owner_account resolution + /auth endpoints business logic.

`get_or_create_owner_account` backs two flows:
1. `GET /auth/me` — lazy-provisions the local `owner_account` row the
   first time a Cognito "owner" group user is seen (docs/API_CONTRACTS.md
   "GET /auth/me").
2. `POST /claim` submission — see `app/services/claim_service.py` module
   docstring for why claim submission also eagerly resolves/creates the
   claimant's `owner_account` row (judgment call flagged there).
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.owner_account import OwnerAccount
from app.schemas.auth import MeResponse, MeUpdateRequest, OwnerAccountOut


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


def _owner_out(owner: OwnerAccount) -> OwnerAccountOut:
    return OwnerAccountOut(
        id=owner.id,
        full_name=owner.full_name,
        stripe_customer_id=owner.stripe_customer_id,
    )


async def get_me(db: AsyncSession, current_user) -> MeResponse:
    owner_out = None
    if current_user.role == "owner":
        owner = await get_or_create_owner_account(db, current_user.cognito_sub, current_user.email)
        await db.commit()
        owner_out = _owner_out(owner)
    return MeResponse(
        cognito_sub=current_user.cognito_sub,
        role=current_user.role,
        email=current_user.email,
        owner_account=owner_out,
    )


async def update_me(db: AsyncSession, current_user, body: MeUpdateRequest) -> OwnerAccountOut:
    """Self-scoped profile update — any authenticated role may call this
    (docs/PROJECT_PLAN.csv "Broaden PATCH /auth/me beyond owner-only"), but
    only an `owner`-role caller has anywhere in this schema to persist a
    name/phone: `owner_account` is the only local business record with
    those fields. `manager`/`admin`/`registered_user` identity data (if any
    — e.g. Cognito `given_name`/`family_name`/`phone_number` attributes)
    lives entirely in Cognito, which this backend never writes to (root
    CLAUDE.md "NEVER store passwords — Cognito handles all auth" — the same
    posture extends to not inventing a shadow copy of Cognito-owned profile
    attributes here). Editing those, if ever built, is a frontend
    Amplify/Cognito `updateUserAttributes` call, not a `PATCH /auth/me`
    write — out of scope for this fix (would need a real schema table,
    which is Architect's call, not Backend Dev's to invent unilaterally).

    So a non-owner caller gets `404 no_editable_profile`, not `403` — the
    distinction matters: it is not a permissions problem (every role may
    call this route), it's that there is no local record to PATCH.
    """
    if current_user.role != "owner":
        raise AppError(
            404,
            "This account has no editable profile record on this platform "
            "yet. Contact support if your name or phone needs to change.",
            "no_editable_profile",
        )

    owner = await get_or_create_owner_account(db, current_user.cognito_sub, current_user.email)
    if body.full_name is not None:
        owner.full_name = body.full_name
    if body.phone is not None:
        owner.phone = body.phone
    await db.commit()
    return _owner_out(owner)
