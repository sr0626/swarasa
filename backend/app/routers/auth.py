"""GET/PATCH /auth/me, plus the CCPA `/auth/me/data-export` and
`/auth/me/data-deletion` routes — see docs/API_CONTRACTS.md "Auth (/auth)"
and "Privacy (CCPA data export / deletion)"."""
from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.auth import (
    CurrentUser,
    get_current_user,
)
from app.dependencies.db import get_db
from app.dependencies.pagination import Pagination, pagination_params
from app.schemas.auth import MeResponse, MeUpdateRequest, OwnerAccountOut
from app.schemas.follow import FollowListResponse
from app.schemas.location_manager import ManagedLocationListResponse
from app.schemas.privacy import (
    DataDeletionListResponse,
    DataDeletionRequestCreate,
    DataDeletionRequestOut,
    DataExportOut,
)
from app.services import auth_service, follow_service, location_manager_service, privacy_service

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
    current_user: CurrentUser = Depends(get_current_user),
) -> OwnerAccountOut:
    """Any authenticated role, self-scoped (docs/PROJECT_PLAN.csv "Broaden
    PATCH /auth/me beyond owner-only") — same auth posture GET /auth/me
    already uses. `require_owner` was an oversight from when this route was
    first built with only owner accounts in mind, not a deliberate
    restriction: there is no local editable profile record for
    manager/admin/registered_user today (only `owner_account` has
    `full_name`/`phone`), so `auth_service.update_me` still 404s those
    three roles with an explicit `no_editable_profile` code — never a bare
    403, which would (incorrectly) read as a permissions problem rather
    than "there's nothing here to update yet."
    """
    return await auth_service.update_me(db, current_user, body)


@router.get("/me/managed-locations", response_model=ManagedLocationListResponse)
async def get_my_managed_locations(
    pagination: Pagination = Depends(pagination_params),
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ManagedLocationListResponse:
    """Any authenticated role — no role restriction, it's inherently
    scoped to the caller's own active `location_manager` rows (see
    `location_manager_service.list_managed_locations`'s docstring).
    """
    return await location_manager_service.list_managed_locations(db, current_user, pagination)


@router.get("/me/follows", response_model=FollowListResponse)
async def get_my_follows(
    pagination: Pagination = Depends(pagination_params),
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> FollowListResponse:
    """Auth: any authenticated role — widened alongside `POST`/`DELETE
    /restaurants/{id}/follow` (root CLAUDE.md "Permission model", changed
    2026-09-22). Not in the original task brief for this change, but left
    on `registered_user` only would have meant an owner/manager who can now
    follow a restaurant could never list what they follow — inherently
    self-scoped (query already filters to `current_user.cognito_sub`), so
    widening it has no access-control cost.
    """
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
