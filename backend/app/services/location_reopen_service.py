"""location_reopen_request business logic — the only path that can move a
`closed_pending_reopen` location back to `active`. See
`app/models/location_reopen_request.py` for why this mirrors
`claim_service.py`'s admin-review shape (real side effect on approval)
rather than `listing_report_service.py`'s (triage only, never itself
writes back to the listing).
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import AppError
from app.dependencies.pagination import Pagination
from app.models.location_reopen_request import LocationReopenRequest
from app.models.owner_account import OwnerAccount
from app.models.restaurant_location import RestaurantLocation
from app.schemas.location_reopen import (
    ReopenRequestListResponse,
    ReopenRequestOut,
    ReopenRequestQueueItem,
)
from app.services import audit_service

_LOAD_OPTIONS = (
    selectinload(LocationReopenRequest.location).selectinload(RestaurantLocation.brand),
)


def to_reopen_request_out(request: LocationReopenRequest) -> ReopenRequestOut:
    return ReopenRequestOut(
        request_id=request.id,
        location_id=request.location_id,
        status=request.status,
        notes=request.notes,
        submitted_at=request.submitted_at,
        reviewed_at=request.reviewed_at,
        reviewer_notes=request.reviewer_notes,
    )


def _to_queue_item(request: LocationReopenRequest, requester_email: str | None) -> ReopenRequestQueueItem:
    location = request.location
    brand = location.brand
    return ReopenRequestQueueItem(
        request_id=request.id,
        location_id=request.location_id,
        brand_id=brand.id,
        brand_name=brand.name,
        brand_slug=brand.slug,
        location_slug=location.slug,
        location_address=(
            f"{location.address_line1}, {location.city}, {location.state} {location.postal_code}"
        ),
        requested_by_user_id=request.requested_by_user_id,
        requester_email=requester_email,
        notes=request.notes,
        status=request.status,
        submitted_at=request.submitted_at,
        reviewed_by=request.reviewed_by,
        reviewed_at=request.reviewed_at,
        reviewer_notes=request.reviewer_notes,
    )


async def create_reopen_request(
    db: AsyncSession, location: RestaurantLocation, current_user, notes: str | None
) -> LocationReopenRequest:
    """`POST /locations/{id}/reopen-requests` — the router's
    `require_location_owner_only` dependency already resolved and
    ownership-checked `location`, so this only enforces the one remaining
    business rule: a reopen request only makes sense for a location that
    is actually `closed_pending_reopen` right now."""
    if location.status != RestaurantLocation.STATUS_CLOSED_PENDING_REOPEN:
        raise AppError(
            409,
            "This location is not closed pending reopen — there is nothing to request.",
            "not_closed_pending_reopen",
        )

    request = LocationReopenRequest(
        location_id=location.id,
        requested_by_user_id=current_user.cognito_sub,
        notes=notes,
        status="pending_review",
    )
    db.add(request)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise AppError(
            409,
            "A reopen request is already pending for this location",
            "reopen_request_already_pending",
        )
    await db.refresh(request)
    return request


async def list_reopen_requests(
    db: AsyncSession, pagination: Pagination, status: str = "pending_review"
) -> ReopenRequestListResponse:
    """Admin review queue, oldest pending first (matching the "review
    what's been waiting longest" posture of `/claim` and `/reports`)."""
    total = (
        await db.execute(
            select(func.count())
            .select_from(LocationReopenRequest)
            .where(LocationReopenRequest.status == status)
        )
    ).scalar_one()
    rows = (
        await db.execute(
            select(LocationReopenRequest, OwnerAccount.email)
            .outerjoin(
                OwnerAccount,
                OwnerAccount.cognito_sub == LocationReopenRequest.requested_by_user_id,
            )
            .options(*_LOAD_OPTIONS)
            .where(LocationReopenRequest.status == status)
            .order_by(LocationReopenRequest.submitted_at.asc(), LocationReopenRequest.id.asc())
            .offset(pagination.offset)
            .limit(pagination.page_size)
        )
    ).all()
    return ReopenRequestListResponse(
        results=[_to_queue_item(request, email) for request, email in rows],
        page=pagination.page,
        page_size=pagination.page_size,
        total=total,
    )


async def get_reopen_request(
    db: AsyncSession, request_id: int, current_user
) -> LocationReopenRequest:
    request = await db.get(LocationReopenRequest, request_id)
    if request is None:
        raise AppError(404, "Reopen request not found", "not_found")
    if current_user.role != "admin" and request.requested_by_user_id != current_user.cognito_sub:
        raise AppError(403, "Not authorized to view this reopen request", "forbidden")
    return request


async def _get_pending_request_or_404(db: AsyncSession, request_id: int) -> LocationReopenRequest:
    request = await db.get(LocationReopenRequest, request_id)
    if request is None:
        raise AppError(404, "Reopen request not found", "not_found")
    if request.status != "pending_review":
        raise AppError(409, "Reopen request has already been reviewed", "request_not_pending")
    return request


async def approve_reopen_request(
    db: AsyncSession, request_id: int, admin_sub: str, reviewer_notes: str | None
) -> LocationReopenRequest:
    """Approve a pending reopen request — the real side effect: sets the
    location's status back to `active`, audit-logged (root CLAUDE.md
    "ALWAYS write an audit_log entry ... restaurant_location"), same
    "commit the effect, then the review record" ordering as
    `claim_service.approve_claim`."""
    request = await _get_pending_request_or_404(db, request_id)

    location = await db.get(RestaurantLocation, request.location_id)
    if location is None:
        raise AppError(404, "Location not found", "not_found")

    old_val = {"status": location.status}
    location.status = RestaurantLocation.STATUS_ACTIVE
    new_val = {"status": location.status}

    request.status = "approved"
    request.reviewed_by = admin_sub
    request.reviewed_at = datetime.now(timezone.utc)
    request.reviewer_notes = reviewer_notes

    await audit_service.log(
        db,
        table_name="restaurant_location",
        record_id=location.id,
        action="update",
        actor_id=admin_sub,
        actor_role="admin",
        old_val=old_val,
        new_val=new_val,
    )
    await db.commit()
    await db.refresh(request)
    return request


async def reject_reopen_request(
    db: AsyncSession, request_id: int, admin_sub: str, reviewer_notes: str
) -> LocationReopenRequest:
    request = await _get_pending_request_or_404(db, request_id)
    request.status = "rejected"
    request.reviewed_by = admin_sub
    request.reviewed_at = datetime.now(timezone.utc)
    request.reviewer_notes = reviewer_notes
    await db.commit()
    await db.refresh(request)
    return request
