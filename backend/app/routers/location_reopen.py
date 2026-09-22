"""Admin review queue for location reopen requests. See
docs/API_CONTRACTS.md "Location reopen requests" and
app/models/location_reopen_request.py.

Submission itself (`POST /locations/{id}/reopen-requests`, owner-only)
lives on `app/routers/locations.py` — nested under the location it's
about, same as `POST /locations/{id}/managers`. This router is only the
admin-facing half (list/get/approve/reject), mirroring `/claim`'s shape
(`app/routers/claim.py`) at its own top-level path rather than under
`/admin`, matching `/claim` and `/reports` (neither of which live under
`/admin` either, despite being admin-reviewed).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.auth import CurrentUser, get_current_user, require_admin
from app.dependencies.db import get_db
from app.dependencies.pagination import Pagination, pagination_params
from app.schemas.location_reopen import (
    ReopenRequestApproveRequest,
    ReopenRequestListResponse,
    ReopenRequestOut,
    ReopenRequestRejectRequest,
    ReopenRequestStatus,
)
from app.services import location_reopen_service

router = APIRouter(prefix="/location-reopen-requests", tags=["location-reopen-requests"])


@router.get("", response_model=ReopenRequestListResponse)
async def list_reopen_requests(
    status_filter: ReopenRequestStatus = Query(default="pending_review", alias="status"),
    pagination: Pagination = Depends(pagination_params),
    db: AsyncSession = Depends(get_db),
    _admin: CurrentUser = Depends(require_admin),
) -> ReopenRequestListResponse:
    """Auth: admin only. `status` defaults to `pending_review`; oldest first."""
    return await location_reopen_service.list_reopen_requests(db, pagination, status_filter)


@router.get("/{request_id}", response_model=ReopenRequestOut)
async def get_reopen_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ReopenRequestOut:
    """Auth: the requesting owner (their own request) or admin (any)."""
    request = await location_reopen_service.get_reopen_request(db, request_id, current_user)
    return location_reopen_service.to_reopen_request_out(request)


@router.post("/{request_id}/approve", response_model=ReopenRequestOut)
async def approve_reopen_request(
    request_id: int,
    body: ReopenRequestApproveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_admin),
) -> ReopenRequestOut:
    """Auth: admin. Real side effect: the location's status flips to
    `active` (location_reopen_service.approve_reopen_request)."""
    request = await location_reopen_service.approve_reopen_request(
        db, request_id, current_user.cognito_sub, body.reviewer_notes
    )
    return location_reopen_service.to_reopen_request_out(request)


@router.post("/{request_id}/reject", response_model=ReopenRequestOut)
async def reject_reopen_request(
    request_id: int,
    body: ReopenRequestRejectRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_admin),
) -> ReopenRequestOut:
    """Auth: admin. `reviewer_notes` is required to reject, same as
    `POST /claim/{id}/reject`."""
    request = await location_reopen_service.reject_reopen_request(
        db, request_id, current_user.cognito_sub, body.reviewer_notes
    )
    return location_reopen_service.to_reopen_request_out(request)
