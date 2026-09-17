"""GET/PATCH /auth/me. See docs/API_CONTRACTS.md "Auth (/auth)"."""
from __future__ import annotations

from fastapi import APIRouter, Depends
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
from app.services import auth_service, follow_service

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
