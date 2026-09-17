"""GET/PATCH /auth/me, plus the CCPA `/auth/me/data-export` and
`/auth/me/data-deletion` routes — see docs/API_CONTRACTS.md "Auth (/auth)"
and "Privacy (CCPA data export / deletion)"."""
from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.auth import (
    CurrentUser,
    get_current_user,
    require_owner,
    require_registered_user,
)
from app.dependencies.db import get_db
from app.dependencies.pagination import Pagination, pagination_params
from app.schemas.auth import MeResponse, MeUpdateRequest, OwnerAccountOut
from app.schemas.follow import FollowListResponse
from app.schemas.privacy import (
    DataDeletionListResponse,
    DataDeletionRequestCreate,
    DataDeletionRequestOut,
    DataExportOut,
)
from app.services import auth_service, follow_service, privacy_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me", response_model=MeResponse)
async def get_me(
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> MeResponse:
    return await auth_service.get_me(db, current_user)


@router.patch("/me", response_model=OwnerAccountOut)
async def update_me(
    body: MeUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_owner),
) -> OwnerAccountOut:
    return await auth_service.update_me(db, current_user, body)


@router.get("/me/follows", response_model=FollowListResponse)
async def get_my_follows(
    pagination: Pagination = Depends(pagination_params),
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_registered_user),
) -> FollowListResponse:
    return await follow_service.list_my_follows(db, current_user, pagination)


@router.get("/me/data-export", response_model=DataExportOut)
async def export_my_data(
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> DataExportOut:
    """Any authenticated role — read-only, synchronous (see
    docs/DECISIONS.md "CCPA data export/deletion"). GET, not POST: this
    creates nothing and has no side effect, same semantics as GET
    /auth/me.
    """
    return await privacy_service.export_my_data(db, current_user)


@router.post(
    "/me/data-deletion",
    response_model=DataDeletionRequestOut,
    status_code=status.HTTP_201_CREATED,
)
async def request_my_data_deletion(
    body: DataDeletionRequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> DataDeletionRequestOut:
    """Any authenticated role. Creates a pending admin-reviewed request —
    does NOT delete anything synchronously (see
    docs/DECISIONS.md "CCPA data export/deletion").
    """
    return await privacy_service.create_deletion_request(db, current_user, body)


@router.get("/me/data-deletion", response_model=DataDeletionListResponse)
async def list_my_data_deletion_requests(
    pagination: Pagination = Depends(pagination_params),
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> DataDeletionListResponse:
    return await privacy_service.list_my_deletion_requests(db, current_user, pagination)
