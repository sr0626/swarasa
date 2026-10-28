"""Admin owner assignment endpoints — kept in their own module so they
don't touch the shared `routers/admin.py`. See docs/API_CONTRACTS.md.

- `POST /admin/restaurants/{brand_id}/assign-owner`
- `POST /admin/owners`

No unassign endpoint (judgment call — see the API contract).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.auth import CurrentUser, require_admin
from app.dependencies.db import get_db
from app.schemas.admin_owner_assignment import (
    AddOwnerRequest,
    AddOwnerResponse,
    AssignOwnerRequest,
    AssignOwnerResponse,
)
from app.services import admin_owner_assignment_service

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/restaurants/{brand_id}/assign-owner", response_model=AssignOwnerResponse)
async def assign_owner_endpoint(
    brand_id: int,
    body: AssignOwnerRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_admin),
) -> AssignOwnerResponse:
    """Auth: admin only. Attach an unclaimed listing (no owner) to an owner,
    by `owner_id` or by account `owner_email`."""
    return await admin_owner_assignment_service.assign_owner(
        db, brand_id, body, current_user.cognito_sub
    )


@router.post("/owners", response_model=AddOwnerResponse, status_code=status.HTTP_201_CREATED)
async def add_owner_endpoint(
    body: AddOwnerRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_admin),
) -> AddOwnerResponse:
    """Auth: admin only. Pre-create the `owner_account` for an existing
    Cognito `owner`-group user (by email). No invitation is sent."""
    return await admin_owner_assignment_service.add_owner(db, body.email, current_user.cognito_sub)
