"""Admin owner assignment: attach an UNCLAIMED listing to an owner, and
pre-create an `owner_account` for an existing Cognito `owner`-group user.
See docs/API_CONTRACTS.md "Admin: assign an owner to an unclaimed listing".

Reuses, does not parallel, the existing paths:
  - `owner_account` rows are created by
    `auth_service.get_or_create_owner_account` — the same function
    `GET /auth/me` (owner onboarding) and `POST /claim` call.
  - The brand is flipped exactly the way `claim_service.approve_claim`
    flips it: `owner_id`, `is_claimed=True`, `claimed_at`.
  - Cognito lookups are `cognito_service.list_group_emails("owner")` — one
    `ListUsersInGroup` sweep, the SAME IAM action/grant the admin
    registered-users / managers reports already use. No new permission.

NOT done here (by design): `is_paid` / `paid_until` on any location are
never read or written (assigning an owner is not a tier change); no
Cognito write (a user found in the `owner` group already has the group); no
invitation / email (separate backlog item).

Managers on the brand's locations — "Manager scoped to one owner at a time"
(DECISIONS.md, PR #229). An unclaimed brand normally has no active
`location_manager` rows, but orphaned ones can exist (an owner_account was
removed and `restaurant_brand.owner_id` was set NULL by the FK). Once the
brand has an owner, those managers would be under the NEW owner, so each is
checked with the same rule `assert_manager_belongs_to_same_owner` enforces:
a manager with an ACTIVE assignment under a DIFFERENT owner has this
brand's assignment revoked (`is_active=false`, `revoked_at`, audited);
managers with no conflict simply stay and now work for the new owner. The
precise reason is logged server-side only, never returned.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.claim_request import ClaimRequest
from app.models.location_manager import LocationManager
from app.models.owner_account import OwnerAccount
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.schemas.admin_owner_assignment import (
    AddOwnerResponse,
    AssignOwnerRequest,
    AssignOwnerResponse,
)
from app.services import audit_service, auth_service, cognito_service

logger = logging.getLogger(__name__)

_OWNER_NOT_FOUND = (
    "We couldn't find an owner account for that. Check the email or pick an existing owner."
)


async def _lookup_cognito_owner(email: str) -> tuple[str, str]:
    """`(sub, email)` of the `owner`-group Cognito user with this email, or
    404. Any Cognito failure becomes a generic 502."""
    try:
        by_sub = cognito_service.list_group_emails(cognito_service.OWNER_GROUP)
    except ClientError as exc:
        logger.warning(
            "admin owner lookup: Cognito ListUsersInGroup failed: %s",
            exc.response.get("Error", {}).get("Code", "ClientError"),
        )
        raise AppError(502, "Unable to look up that account right now", "upstream_error") from exc
    except (BotoCoreError, RuntimeError) as exc:
        logger.warning("admin owner lookup: Cognito lookup failed: %s", type(exc).__name__)
        raise AppError(502, "Unable to look up that account right now", "upstream_error") from exc
    for sub, found_email in by_sub.items():
        if found_email.strip().lower() == email:
            return sub, found_email
    raise AppError(404, _OWNER_NOT_FOUND, "owner_not_found")


async def _owner_by_email(db: AsyncSession, email: str) -> OwnerAccount | None:
    return (
        await db.execute(
            select(OwnerAccount).where(
                func.lower(OwnerAccount.email) == email,
                OwnerAccount.personal_data_deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()


async def _resolve_or_create_owner_by_email(
    db: AsyncSession, email: str, admin_sub: str
) -> tuple[OwnerAccount, bool]:
    """Existing local owner for `email`, else create one for the matching
    Cognito `owner`-group user (audited). Does NOT commit."""
    existing = await _owner_by_email(db, email)
    if existing is not None:
        return existing, False

    sub, cognito_email = await _lookup_cognito_owner(email)
    # A row may already exist under this sub with a different stored email.
    by_sub = await auth_service.get_owner_account_by_sub(db, sub)
    if by_sub is not None:
        if by_sub.personal_data_deleted_at is not None:
            raise AppError(404, _OWNER_NOT_FOUND, "owner_not_found")
        return by_sub, False

    owner = await auth_service.get_or_create_owner_account(db, sub, cognito_email)
    await audit_service.log(
        db,
        table_name="owner_account",
        record_id=owner.id,
        action="create",
        actor_id=admin_sub,
        actor_role="admin",
        old_val=None,
        new_val={"email": owner.email, "source": "admin_pre_create"},
    )
    return owner, True


async def add_owner(db: AsyncSession, email: str, admin_sub: str) -> AddOwnerResponse:
    """`POST /admin/owners` — pre-create the owner_account for an existing
    Cognito owner-group user. 409 if an account already exists."""
    if await _owner_by_email(db, email) is not None:
        raise AppError(409, "An owner account already exists for that email", "owner_exists")
    owner, created = await _resolve_or_create_owner_by_email(db, email, admin_sub)
    if not created:
        raise AppError(409, "An owner account already exists for that email", "owner_exists")
    await db.commit()
    await db.refresh(owner)
    return AddOwnerResponse(id=owner.id, email=owner.email, joined_at=owner.created_at)


async def _revoke_conflicting_managers(
    db: AsyncSession, brand: RestaurantBrand, new_owner_id: int, admin_sub: str
) -> int:
    rows = (
        (
            await db.execute(
                select(LocationManager)
                .join(RestaurantLocation, RestaurantLocation.id == LocationManager.location_id)
                .where(
                    RestaurantLocation.brand_id == brand.id,
                    LocationManager.is_active == True,  # noqa: E712
                )
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        return 0

    conflicting_subs: set[str] = set()
    for user_id in {row.user_id for row in rows}:
        conflict = (
            await db.execute(
                select(RestaurantBrand.id)
                .select_from(LocationManager)
                .join(RestaurantLocation, RestaurantLocation.id == LocationManager.location_id)
                .join(RestaurantBrand, RestaurantBrand.id == RestaurantLocation.brand_id)
                .where(
                    LocationManager.user_id == user_id,
                    LocationManager.is_active == True,  # noqa: E712
                    RestaurantBrand.id != brand.id,
                    RestaurantBrand.owner_id.is_not(None),
                    RestaurantBrand.owner_id != new_owner_id,
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if conflict is not None:
            conflicting_subs.add(user_id)

    revoked = 0
    now = datetime.now(timezone.utc)
    for row in rows:
        if row.user_id not in conflicting_subs:
            continue
        logger.warning(
            "admin assign-owner: revoking manager assignment (brand_id=%s, location_id=%s, "
            "manager_sub=%s): manager already holds an active assignment under a different owner",
            brand.id,
            row.location_id,
            row.user_id,
        )
        row.is_active = False
        row.revoked_at = now
        await audit_service.log(
            db,
            table_name="location_manager",
            record_id=row.id,
            action="update",
            actor_id=admin_sub,
            actor_role="admin",
            old_val={"is_active": True},
            new_val={"is_active": False, "reason": "owner_assigned_cross_owner_manager"},
        )
        revoked += 1
    return revoked


async def assign_owner(
    db: AsyncSession, brand_id: int, body: AssignOwnerRequest, admin_sub: str
) -> AssignOwnerResponse:
    """`POST /admin/restaurants/{brand_id}/assign-owner`. One transaction:
    (optional owner_account create) + brand update + manager revocations +
    their audit rows commit together."""
    brand = (
        await db.execute(
            select(RestaurantBrand).where(RestaurantBrand.id == brand_id).with_for_update()
        )
    ).scalar_one_or_none()
    if brand is None or brand.deleted_at is not None:
        raise AppError(404, "Restaurant not found", "not_found")
    if brand.owner_id is not None:
        # Generic on purpose: no owner identity in the message.
        raise AppError(409, "This listing can't be assigned an owner", "brand_already_owned")

    pending_claims = (
        await db.execute(
            select(func.count())
            .select_from(ClaimRequest)
            .where(ClaimRequest.brand_id == brand.id, ClaimRequest.status == "pending_review")
        )
    ).scalar_one()
    if pending_claims:
        raise AppError(
            409,
            "This listing has a pending claim. Review the claim instead.",
            "claim_pending",
        )

    created = False
    if body.owner_id is not None:
        owner = await db.get(OwnerAccount, body.owner_id)
        if owner is None or owner.personal_data_deleted_at is not None:
            raise AppError(404, _OWNER_NOT_FOUND, "owner_not_found")
    else:
        assert body.owner_email is not None
        owner, created = await _resolve_or_create_owner_by_email(db, body.owner_email, admin_sub)

    old_val = {
        "owner_id": brand.owner_id,
        "is_claimed": brand.is_claimed,
        "claimed_at": brand.claimed_at.isoformat() if brand.claimed_at else None,
    }
    now = datetime.now(timezone.utc)
    brand.owner_id = owner.id
    brand.is_claimed = True
    brand.claimed_at = now

    revoked = await _revoke_conflicting_managers(db, brand, owner.id, admin_sub)

    await audit_service.log(
        db,
        table_name="restaurant_brand",
        record_id=brand.id,
        action="update",
        actor_id=admin_sub,
        actor_role="admin",
        old_val=old_val,
        new_val={
            "owner_id": owner.id,
            "is_claimed": True,
            "claimed_at": now.isoformat(),
            "source": "admin_assign_owner",
        },
    )
    owner_id, owner_email = owner.id, owner.email
    await db.commit()
    return AssignOwnerResponse(
        brand_id=brand_id,
        owner_id=owner_id,
        owner_email=owner_email,
        is_claimed=True,
        owner_account_created=created,
        revoked_manager_count=revoked,
    )
