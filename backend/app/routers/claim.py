"""Claim flow endpoints. See docs/API_CONTRACTS.md "Claim flow (/claim)"."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.auth import CurrentUser, get_current_user, require_admin
from app.dependencies.db import get_db
from app.dependencies.pagination import Pagination, pagination_params
from app.schemas.claim import (
    ClaimApproveRequest,
    ClaimCreate,
    ClaimListResponse,
    ClaimOut,
    ClaimRejectRequest,
    ClaimStatus,
)
from app.services import claim_service

router = APIRouter(prefix="/claim", tags=["claim"])


@router.post("", response_model=ClaimOut, status_code=status.HTTP_201_CREATED)
async def submit_claim(
    body: ClaimCreate,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ClaimOut:
    claim = await claim_service.create_claim(db, current_user, body)
    return claim_service.to_claim_out(claim)


@router.get("", response_model=ClaimListResponse)
async def list_claims(
    status_filter: ClaimStatus = Query(default="pending_review", alias="status"),
    pagination: Pagination = Depends(pagination_params),
    db: AsyncSession = Depends(get_db),
    _admin: CurrentUser = Depends(require_admin),
) -> ClaimListResponse:
    """Auth: admin only. `status` defaults to `pending_review`; newest first."""
    return await claim_service.list_claims(db, pagination, status_filter)


@router.get("/{claim_id}", response_model=ClaimOut)
async def get_claim(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ClaimOut:
    claim = await claim_service.get_claim(db, claim_id, current_user)
    return claim_service.to_claim_out(claim)


@router.post("/{claim_id}/approve", response_model=ClaimOut)
async def approve_claim(
    claim_id: int,
    body: ClaimApproveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_admin),
) -> ClaimOut:
    claim, owner_group_granted = await claim_service.approve_claim(
        db, claim_id, current_user.cognito_sub, body.reviewer_notes
    )
    out = claim_service.to_claim_out(claim)
    out.owner_group_granted = owner_group_granted
    return out


@router.post("/{claim_id}/reject", response_model=ClaimOut)
async def reject_claim(
    claim_id: int,
    body: ClaimRejectRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_admin),
) -> ClaimOut:
    claim = await claim_service.reject_claim(db, claim_id, current_user.cognito_sub, body.reviewer_notes)
    return claim_service.to_claim_out(claim)
