"""Claim flow business logic — see docs/API_CONTRACTS.md "Claim flow
(/claim)" and DECISIONS.md "Claim flow: Google Business Profile match OR
phone verification, admin-reviewed, 2-business-day SLA".

JUDGMENT CALL (flagged for review): on `POST /claim`, this module eagerly
resolves/creates the claimant's `owner_account` row (via
`auth_service.get_or_create_owner_account`, using the claimant's *own*
JWT email at submission time) rather than waiting until admin approval.
`POST /claim/{id}/approve` sets `restaurant_brand.owner_id` to that
resolved account's id — but approval is admin-initiated, and the admin's
request carries no JWT for the claimant, so there is no email available
at approval time to provision a brand-new `owner_account` row if one
doesn't already exist. Resolving it at submission time (when the
claimant's own authenticated request does carry their email) avoids that
gap entirely. Cognito group elevation ("owner" pool group membership) on
approval is NOT implemented here — that needs `cognito-idp:
AdminAddUserToGroup`, a permission this task has no Infra-granted scope
for (root CLAUDE.md "AWS Best Practices" — ask Infra for a specific grant
rather than assuming one); left as a follow-up, noted in the final report.

UPDATE: group elevation is now implemented as a best-effort step AFTER the
approval commit (`_grant_owner_group`). The `AdminAddUserToGroup` IAM grant
ships in a separate Infra PR and may not be applied yet, so a Cognito
failure (AccessDenied, network, pool id unset) must never undo or block the
approval: it is logged as a warning and reported as
`owner_group_granted: false` on the approve response; an admin can add the
group by hand (docs/API_CONTRACTS.md).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import AppError
from app.dependencies.pagination import Pagination
from app.models.claim_request import ClaimRequest
from app.models.owner_account import OwnerAccount
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.schemas.claim import ClaimCreate, ClaimListResponse, ClaimOut, ClaimQueueItem
from app.services import audit_service, auth_service, cognito_service

logger = logging.getLogger(__name__)

_SLA_BUSINESS_DAYS = 2


def _add_business_days(start: datetime, days: int) -> datetime:
    current = start
    added = 0
    while added < days:
        current += timedelta(days=1)
        if current.weekday() < 5:  # Mon-Fri
            added += 1
    return current


def to_claim_out(claim: ClaimRequest) -> ClaimOut:
    return ClaimOut(
        claim_id=claim.id,
        brand_id=claim.brand_id,
        status=claim.status,
        proof_method=claim.proof_method,
        submitted_at=claim.submitted_at,
        sla_due_at=_add_business_days(claim.submitted_at, _SLA_BUSINESS_DAYS),
        reviewed_at=claim.reviewed_at,
        reviewer_notes=claim.reviewer_notes,
    )


def to_claim_queue_item(claim: ClaimRequest, claimant_email: str | None) -> ClaimQueueItem:
    location = claim.location
    return ClaimQueueItem(
        claim_id=claim.id,
        brand_id=claim.brand_id,
        brand_name=claim.brand.name,
        brand_slug=claim.brand.slug,
        location_id=claim.location_id,
        location_address=(
            f"{location.address_line1}, {location.city}, {location.state} {location.postal_code}"
            if location is not None
            else None
        ),
        claimant_user_id=claim.claimant_user_id,
        claimant_email=claimant_email,
        proof_method=claim.proof_method,
        google_business_profile_url=claim.google_business_profile_url,
        supporting_document_url=claim.supporting_document_key,
        status=claim.status,
        submitted_at=claim.submitted_at,
        sla_due_at=_add_business_days(claim.submitted_at, _SLA_BUSINESS_DAYS),
        reviewed_at=claim.reviewed_at,
        reviewer_notes=claim.reviewer_notes,
    )


async def list_claims(
    db: AsyncSession, pagination: Pagination, status: str = "pending_review"
) -> ClaimListResponse:
    """Admin claims queue, newest first. Claimant email comes from
    `owner_account` (outer-joined on cognito_sub; `create_claim` eagerly
    creates that row) and is `None` when no such row exists."""
    total = (
        await db.execute(
            select(func.count()).select_from(ClaimRequest).where(ClaimRequest.status == status)
        )
    ).scalar_one()
    rows = (
        await db.execute(
            select(ClaimRequest, OwnerAccount.email)
            .outerjoin(OwnerAccount, OwnerAccount.cognito_sub == ClaimRequest.claimant_user_id)
            .options(selectinload(ClaimRequest.brand), selectinload(ClaimRequest.location))
            .where(ClaimRequest.status == status)
            .order_by(ClaimRequest.submitted_at.desc(), ClaimRequest.id.desc())
            .offset(pagination.offset)
            .limit(pagination.page_size)
        )
    ).all()
    return ClaimListResponse(
        results=[to_claim_queue_item(claim, email) for claim, email in rows],
        page=pagination.page,
        page_size=pagination.page_size,
        total=total,
    )


async def create_claim(db: AsyncSession, current_user, body: ClaimCreate) -> ClaimRequest:
    brand = await db.get(RestaurantBrand, body.brand_id)
    if brand is None or brand.deleted_at is not None:
        raise AppError(404, "Restaurant not found", "not_found")

    location: RestaurantLocation | None = None
    if body.location_id is not None:
        location = await db.get(RestaurantLocation, body.location_id)
        if location is None or location.brand_id != brand.id:
            raise AppError(400, "location_id does not belong to this restaurant", "invalid_location")

    if body.proof_method == "phone_verification" and location is None:
        # "the phone number already on the public listing" only resolves
        # unambiguously for a single-location brand (docs/DATA_MODEL.md
        # "claim_request" judgment call).
        count_result = await db.execute(
            select(func.count())
            .select_from(RestaurantLocation)
            .where(RestaurantLocation.brand_id == brand.id, RestaurantLocation.is_active == True)  # noqa: E712
        )
        if count_result.scalar_one() != 1:
            raise AppError(
                400,
                "location_id is required for phone verification on a multi-location restaurant",
                "location_required",
            )
        loc_result = await db.execute(
            select(RestaurantLocation).where(
                RestaurantLocation.brand_id == brand.id, RestaurantLocation.is_active == True  # noqa: E712
            )
        )
        location = loc_result.scalar_one()

    # Eagerly resolve/create the claimant's owner_account — see module
    # docstring judgment call.
    await auth_service.get_or_create_owner_account(db, current_user.cognito_sub, current_user.email)

    claim = ClaimRequest(
        brand_id=brand.id,
        location_id=location.id if location else None,
        claimant_user_id=current_user.cognito_sub,
        proof_method=body.proof_method,
        google_business_profile_url=body.google_business_profile_url,
        supporting_document_key=body.supporting_document_url,
        status="pending_review",
    )
    db.add(claim)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise AppError(409, "A claim is already pending for this restaurant", "claim_already_pending")

    await db.refresh(claim)
    return claim


async def get_claim(db: AsyncSession, claim_id: int, current_user) -> ClaimRequest:
    claim = await db.get(ClaimRequest, claim_id)
    if claim is None:
        raise AppError(404, "Claim not found", "not_found")
    if current_user.role != "admin" and claim.claimant_user_id != current_user.cognito_sub:
        raise AppError(403, "Not authorized to view this claim", "forbidden")
    return claim


async def _get_pending_claim_or_404(db: AsyncSession, claim_id: int) -> ClaimRequest:
    claim = await db.get(ClaimRequest, claim_id)
    if claim is None:
        raise AppError(404, "Claim not found", "not_found")
    if claim.status != "pending_review":
        raise AppError(409, "Claim has already been reviewed", "claim_not_pending")
    return claim


def _grant_owner_group(claimant_sub: str, claimant_email: str | None) -> bool:
    """Best-effort: add the claimant to the Cognito `owner` group. Returns
    True on success (including already-a-member), False on any failure.
    Never raises, never logs credentials or stack traces.

    Username is the JWT `sub`; if Cognito rejects it with
    `UserNotFoundException` (pool configured with email as username) retry
    once with the claimant's email.
    """
    try:
        try:
            cognito_service.add_user_to_group(claimant_sub, cognito_service.OWNER_GROUP)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") != "UserNotFoundException" or not claimant_email:
                raise
            cognito_service.add_user_to_group(claimant_email, cognito_service.OWNER_GROUP)
        return True
    except ClientError as exc:
        logger.warning(
            "Claim approved but adding claimant to owner group failed: %s",
            exc.response.get("Error", {}).get("Code", "ClientError"),
        )
    except (BotoCoreError, RuntimeError) as exc:
        logger.warning(
            "Claim approved but adding claimant to owner group failed: %s", type(exc).__name__
        )
    return False


async def approve_claim(
    db: AsyncSession, claim_id: int, admin_sub: str, reviewer_notes: str | None
) -> tuple[ClaimRequest, bool]:
    """Approve a pending claim. Returns `(claim, owner_group_granted)`; the
    DB changes are committed before the (best-effort) Cognito call."""
    claim = await _get_pending_claim_or_404(db, claim_id)

    owner = await auth_service.get_owner_account_by_sub(db, claim.claimant_user_id)
    if owner is None:
        # Should not happen — create_claim always provisions this row at
        # submission time. Surfaced as a clean 409 rather than a 500 if it
        # somehow does (data inconsistency, not a caller error).
        raise AppError(
            409,
            "Claimant has no owner account on file; cannot approve this claim",
            "claimant_account_missing",
        )

    brand = await db.get(RestaurantBrand, claim.brand_id)
    if brand is None:
        raise AppError(404, "Restaurant not found", "not_found")

    # Captured before commit — the ORM row is expired afterwards.
    claimant_email = owner.email
    claimant_sub = claim.claimant_user_id
    old_val = {"owner_id": brand.owner_id, "is_claimed": brand.is_claimed}
    brand.owner_id = owner.id
    brand.is_claimed = True
    brand.claimed_at = datetime.now(timezone.utc)

    claim.status = "approved"
    claim.reviewed_by = admin_sub
    claim.reviewed_at = datetime.now(timezone.utc)
    claim.reviewer_notes = reviewer_notes

    await audit_service.log(
        db,
        table_name="restaurant_brand",
        record_id=brand.id,
        action="update",
        actor_id=admin_sub,
        actor_role="admin",
        old_val=old_val,
        new_val={"owner_id": brand.owner_id, "is_claimed": brand.is_claimed},
    )
    await db.commit()
    await db.refresh(claim)

    # After the commit: a Cognito failure must not roll back the approval.
    # Blocking boto3 called directly, same posture as cognito_service's
    # other callers.
    granted = _grant_owner_group(claimant_sub, claimant_email)
    return claim, granted


async def reject_claim(
    db: AsyncSession, claim_id: int, admin_sub: str, reviewer_notes: str
) -> ClaimRequest:
    claim = await _get_pending_claim_or_404(db, claim_id)
    claim.status = "rejected"
    claim.reviewed_by = admin_sub
    claim.reviewed_at = datetime.now(timezone.utc)
    claim.reviewer_notes = reviewer_notes
    await db.commit()
    await db.refresh(claim)
    return claim
