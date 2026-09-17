"""Admin-review side of CCPA data deletion requests. See
docs/API_CONTRACTS.md "Privacy (CCPA data export / deletion)". Self-serve
creation/listing lives on `/auth/me/data-deletion` instead
(`app/routers/auth.py`) — this router is the `claim_request`-shaped
review-queue family (`GET /{id}`, `POST /{id}/approve`,
`POST /{id}/reject`), same split `/claim` already uses between "submit"
(any authenticated user) and "review" (admin).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.auth import CurrentUser, get_current_user, require_admin
from app.dependencies.db import get_db
from app.schemas.privacy import (
    DataDeletionApproveRequest,
    DataDeletionRejectRequest,
    DataDeletionRequestOut,
)
from app.services import privacy_service

router = APIRouter(prefix="/data-deletion", tags=["privacy"])


@router.get("/{request_id}", response_model=DataDeletionRequestOut)
async def get_data_deletion_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> DataDeletionRequestOut:
    """Auth: the requester (own request only) or admin (any request) —
    permission check happens in the service layer, same shape as
    `claim_service.get_claim`.
    """
    return await privacy_service.get_deletion_request(db, request_id, current_user)


@router.post("/{request_id}/approve", response_model=DataDeletionRequestOut)
async def approve_data_deletion_request(
    request_id: int,
    body: DataDeletionApproveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_admin),
) -> DataDeletionRequestOut:
    return await privacy_service.approve_deletion_request(
        db, request_id, current_user.cognito_sub, body.reviewer_notes
    )


@router.post("/{request_id}/reject", response_model=DataDeletionRequestOut)
async def reject_data_deletion_request(
    request_id: int,
    body: DataDeletionRejectRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_admin),
) -> DataDeletionRequestOut:
    return await privacy_service.reject_deletion_request(
        db, request_id, current_user.cognito_sub, body.reviewer_notes
    )
