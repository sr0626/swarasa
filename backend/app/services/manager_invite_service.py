"""Manager invite-by-email — business logic. See docs/API_CONTRACTS.md
"Manager invites" and docs/DECISIONS.md (proposed entry in the PR).

Flow: owner/admin creates an invite -> gets a single-use link once and shares
it (no email is sent: SES is deferred) -> the invitee signs up / signs in with
the invited address, opens the link and accepts -> a real `location_manager`
row is created through the SAME checks as `POST /locations/{id}/managers`.

Security posture:
- Token = 32 random bytes (`secrets.token_urlsafe(32)`); only its SHA-256 hash
  is stored; lookup is by hash and the stored hash is re-compared with
  `hmac.compare_digest`. Single use (`accepted_at`), expiring (14 days),
  revocable (`revoked_at`).
- The invitee must be signed in with an account whose (Cognito-verified) email
  equals the invited address, so a forwarded or leaked link is useless to
  anyone else.
- Creating an invite never looks the address up in Cognito and never checks
  cross-owner status, so the owner learns nothing about whether the address
  has an account or belongs to another owner's team. Those rules run at
  ACCEPT time, and failures there are reported to the invitee with one generic
  message (the precise reason is only logged).
- Every "bad token" outcome (unknown, expired, revoked, already used, wrong
  email, location gone) is the same 404 `invite_invalid`.
- Invite creation is rate limited per owner (INVITES_PER_OWNER_PER_DAY).
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.dependencies.pagination import Pagination
from app.models.location_manager import LocationManager
from app.models.manager_invite import REDACTED_EMAIL, ManagerInvite
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.schemas.manager_invite import (
    InviteAcceptedOut,
    InvitePreviewOut,
    ManagerInviteCreatedOut,
    ManagerInviteListResponse,
    ManagerInviteOut,
)
from app.schemas.utc import ensure_utc
from app.services import audit_service, cognito_service, location_manager_service

logger = logging.getLogger(__name__)

INVITE_TTL_DAYS = 14
INVITES_PER_OWNER_PER_DAY = 20
# Roles that may accept an invite. An owner/admin account cannot also be a
# location manager (the role comes from the Cognito group).
_ACCEPTING_ROLES = {"registered_user", "manager"}

_GENERIC_INVALID = "This invitation is invalid, has expired, or was sent to a different email address."
_GENERIC_CANNOT_ACCEPT = (
    "We couldn't complete this invitation. Please contact the person who invited you."
)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(32)


def mask_email(email: str) -> str:
    """`jane.doe@example.com` -> `j***@example.com`."""
    local, _, domain = email.partition("@")
    if not domain:
        return "***"
    return f"{local[:1]}***@{domain}"


def invite_status(invite: ManagerInvite, now: datetime) -> str:
    """accepted | revoked | expired | pending (derived, never stored)."""
    if invite.accepted_at is not None:
        return "accepted"
    if invite.revoked_at is not None:
        return "revoked"
    if ensure_utc(invite.expires_at) <= now:
        return "expired"
    return "pending"


def _to_out(invite: ManagerInvite, now: datetime) -> ManagerInviteOut:
    return ManagerInviteOut(
        id=invite.id,
        location_id=invite.location_id,
        email=invite.email,
        status=invite_status(invite, now),  # type: ignore[arg-type]
        created_at=invite.created_at,
        expires_at=invite.expires_at,
    )


async def _location_and_brand(
    db: AsyncSession, location_id: int
) -> tuple[RestaurantLocation, RestaurantBrand]:
    location = await db.get(RestaurantLocation, location_id)
    brand = await db.get(RestaurantBrand, location.brand_id) if location is not None else None
    if location is None or brand is None:
        raise AppError(404, "Location not found", "not_found")
    return location, brand


async def create_invite(
    db: AsyncSession, location_id: int, current_user, email: str
) -> ManagerInviteCreatedOut:
    """POST /locations/{id}/manager-invites (owner of the location, or admin)."""
    location, brand = await _location_and_brand(db, location_id)
    owner_id = brand.owner_id
    if owner_id is None:
        raise AppError(
            409,
            "This location has no owner yet, so it can't invite managers.",
            "owner_required",
        )

    now = datetime.now(timezone.utc)

    sent_today = (
        await db.execute(
            select(func.count())
            .select_from(ManagerInvite)
            .where(
                ManagerInvite.invited_by_owner_id == owner_id,
                ManagerInvite.created_at >= now - timedelta(days=1),
            )
        )
    ).scalar_one()
    if sent_today >= INVITES_PER_OWNER_PER_DAY:
        raise AppError(
            429,
            "You've sent too many invitations today. Please try again tomorrow.",
            "invite_rate_limited",
        )

    # The owner's own data (their location's manager count), so surfacing the
    # cap here discloses nothing about anyone else.
    await location_manager_service.assert_can_add_active_manager(db, location)

    # A fresh link supersedes any still-pending one for the same address and
    # location (the old raw token can't be re-shown).
    existing = (
        await db.execute(
            select(ManagerInvite).where(
                ManagerInvite.location_id == location_id,
                ManagerInvite.email == email,
                ManagerInvite.accepted_at.is_(None),
                ManagerInvite.revoked_at.is_(None),
            )
        )
    ).scalars().all()
    for old in existing:
        old.revoked_at = now
        old.email = REDACTED_EMAIL

    token = new_token()
    invite = ManagerInvite(
        email=email,
        location_id=location_id,
        invited_by_owner_id=owner_id,
        token_hash=hash_token(token),
        created_at=now,
        expires_at=now + timedelta(days=INVITE_TTL_DAYS),
    )
    db.add(invite)
    await db.flush()

    # No email in the audit row (third-party PII that audit_log retains).
    await audit_service.log(
        db,
        table_name="manager_invite",
        record_id=invite.id,
        action="create",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=None,
        new_val={"location_id": location_id, "expires_at": invite.expires_at.isoformat()},
    )
    await db.commit()

    out = _to_out(invite, now)
    return ManagerInviteCreatedOut(**out.model_dump(), token=token)


async def list_invites(
    db: AsyncSession, location_id: int, pagination: Pagination
) -> ManagerInviteListResponse:
    """GET /locations/{id}/manager-invites — outstanding invites only
    (pending + expired); accepted ones are real managers now, revoked ones
    are gone."""
    where = (
        ManagerInvite.location_id == location_id,
        ManagerInvite.accepted_at.is_(None),
        ManagerInvite.revoked_at.is_(None),
    )
    total = (
        await db.execute(select(func.count()).select_from(ManagerInvite).where(*where))
    ).scalar_one()
    rows = (
        (
            await db.execute(
                select(ManagerInvite)
                .where(*where)
                .order_by(ManagerInvite.created_at.desc(), ManagerInvite.id.desc())
                .offset(pagination.offset)
                .limit(pagination.page_size)
            )
        )
        .scalars()
        .all()
    )
    now = datetime.now(timezone.utc)
    return ManagerInviteListResponse(
        results=[_to_out(row, now) for row in rows],
        page=pagination.page,
        page_size=pagination.page_size,
        total=total,
    )


async def revoke_invite(db: AsyncSession, location_id: int, invite_id: int, current_user) -> None:
    """DELETE /locations/{id}/manager-invites/{invite_id}. Idempotent for an
    already-revoked invite; a used (accepted) invite can't be revoked — remove
    the manager instead."""
    invite = await db.get(ManagerInvite, invite_id)
    if invite is None or invite.location_id != location_id:
        raise AppError(404, "Invitation not found", "not_found")
    if invite.revoked_at is not None:
        return
    if invite.accepted_at is not None:
        raise AppError(
            409,
            "This invitation has already been accepted. Remove the manager instead.",
            "invite_already_accepted",
        )

    invite.revoked_at = datetime.now(timezone.utc)
    invite.email = REDACTED_EMAIL
    await audit_service.log(
        db,
        table_name="manager_invite",
        record_id=invite.id,
        action="delete",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val={"location_id": location_id},
        new_val={"revoked": True},
    )
    await db.commit()


async def _find_usable_invite(db: AsyncSession, token: str) -> ManagerInvite:
    """The invite for `token` iff it is pending (not used, revoked or
    expired); otherwise the one generic 404."""
    digest = hash_token(token)
    invite = (
        await db.execute(select(ManagerInvite).where(ManagerInvite.token_hash == digest))
    ).scalar_one_or_none()
    if (
        invite is None
        or not hmac.compare_digest(invite.token_hash, digest)
        or invite_status(invite, datetime.now(timezone.utc)) != "pending"
    ):
        raise AppError(404, _GENERIC_INVALID, "invite_invalid")
    return invite


async def preview_invite(db: AsyncSession, token: str) -> InvitePreviewOut:
    """POST /manager-invites/preview (public) — what the invitee sees before
    signing in. Same generic 404 for every unusable token."""
    invite = await _find_usable_invite(db, token)
    location = await db.get(RestaurantLocation, invite.location_id)
    brand = await db.get(RestaurantBrand, location.brand_id) if location is not None else None
    if location is None or brand is None or brand.deleted_at is not None:
        raise AppError(404, _GENERIC_INVALID, "invite_invalid")
    return InvitePreviewOut(
        brand_name=brand.name,
        location_name=location.location_name,
        city=location.city,
        email_hint=mask_email(invite.email),
        expires_at=invite.expires_at,
    )


async def accept_invite(db: AsyncSession, token: str, current_user) -> InviteAcceptedOut:
    """POST /manager-invites/accept (any signed-in account).

    Applies the invite as an active `location_manager` row with the same
    validation as a normal assignment. Order: token usable -> account email
    matches -> location/owner still consistent -> cross-owner -> location cap
    -> manager cap -> insert -> Cognito `manager` group -> commit. The group is
    added BEFORE the commit so a Cognito failure leaves nothing half-applied
    (the invitee can simply retry).
    """
    if current_user.role not in _ACCEPTING_ROLES:
        raise AppError(
            403,
            "Owner and admin accounts can't be used as a location manager. "
            "Sign in with the account you signed up with for this invitation.",
            "invite_wrong_account_type",
        )

    invite = await _find_usable_invite(db, token)

    invited_email = invite.email
    caller_email = (current_user.email or "").strip().lower()
    if not caller_email or not hmac.compare_digest(
        invited_email.encode("utf-8"), caller_email.encode("utf-8")
    ):
        raise AppError(404, _GENERIC_INVALID, "invite_invalid")

    location = await db.get(RestaurantLocation, invite.location_id)
    brand = await db.get(RestaurantBrand, location.brand_id) if location is not None else None
    if (
        location is None
        or brand is None
        or brand.deleted_at is not None
        or brand.owner_id is None
        or brand.owner_id != invite.invited_by_owner_id
    ):
        raise AppError(404, _GENERIC_INVALID, "invite_invalid")

    sub = current_user.cognito_sub
    already_active = (
        await db.execute(
            select(LocationManager.id).where(
                LocationManager.location_id == location.id,
                LocationManager.user_id == sub,
                LocationManager.is_active == True,  # noqa: E712
            )
        )
    ).scalar_one_or_none()

    if already_active is None:
        try:
            await location_manager_service.assert_manager_belongs_to_same_owner(
                db, sub, brand.owner_id
            )
            await location_manager_service.assert_can_add_active_manager(db, location)
            await location_manager_service.assert_manager_not_over_location_cap(db, sub, location)
        except AppError as exc:
            # The invitee must not learn another tenant's relationships or the
            # location's capacity details; log the precise reason server-side.
            logger.warning(
                "manager invite %s not acceptable (%s): %s", invite.id, exc.code, exc.detail
            )
            raise AppError(409, _GENERIC_CANNOT_ACCEPT, "invite_cannot_be_accepted") from exc

        manager = LocationManager(
            location_id=location.id,
            user_id=sub,
            assigned_by_owner_id=brand.owner_id,
            is_active=True,
        )
        db.add(manager)
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()
            raise AppError(409, _GENERIC_CANNOT_ACCEPT, "invite_cannot_be_accepted")

        await audit_service.log(
            db,
            table_name="location_manager",
            record_id=manager.id,
            action="create",
            actor_id=sub,
            actor_role="manager",
            old_val=None,
            new_val={
                "location_id": manager.location_id,
                "user_id": manager.user_id,
                "is_active": manager.is_active,
                "via_invite_id": invite.id,
            },
        )

    sign_in_again = current_user.role != "manager"
    if sign_in_again:
        try:
            cognito_service.add_user_to_group(sub, cognito_service.MANAGER_GROUP)
        except Exception:  # noqa: BLE001 - nothing committed yet; retryable
            invite_id = invite.id  # read before the rollback expires the instance
            await db.rollback()
            logger.exception("Failed adding %s to the manager group for invite %s", sub, invite_id)
            raise AppError(
                503,
                "We couldn't finish setting up your manager access. Please try again in a moment.",
                "invite_try_again",
            )

    invite.accepted_at = datetime.now(timezone.utc)
    invite.email = REDACTED_EMAIL
    await db.commit()

    return InviteAcceptedOut(
        location_id=location.id,
        brand_name=brand.name,
        location_name=location.location_name,
        sign_in_again=sign_in_again,
    )
