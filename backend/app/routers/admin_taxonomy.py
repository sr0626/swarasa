"""Admin taxonomy management -- `/admin/taxonomy`. See
docs/API_CONTRACTS.md "Admin taxonomy management". Admin only.
No DELETE route on purpose: tags are retired by deactivating them."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Path, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.auth import CurrentUser, require_admin
from app.dependencies.db import get_db
from app.schemas.admin_taxonomy import (
    AdminTagCreate,
    AdminTagOut,
    AdminTagUpdate,
    AdminTaxonomyResponse,
)
from app.services import admin_taxonomy_service

router = APIRouter(prefix="/admin/taxonomy", tags=["admin"])


@router.get("", response_model=AdminTaxonomyResponse)
async def list_taxonomy_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_admin),
) -> AdminTaxonomyResponse:
    """Auth: admin only. Every tag (active + inactive) with usage counts."""
    return await admin_taxonomy_service.list_taxonomy(db)


@router.post("", response_model=AdminTagOut, status_code=status.HTTP_201_CREATED)
async def create_tag_endpoint(
    body: AdminTagCreate,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_admin),
) -> AdminTagOut:
    """Auth: admin only. 409 on a slug / display-name clash. Audited."""
    return await admin_taxonomy_service.create_tag(db, body, current_user)


@router.patch("/{tag_id}", response_model=AdminTagOut)
async def update_tag_endpoint(
    body: AdminTagUpdate,
    tag_id: int = Path(ge=1),
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_admin),
) -> AdminTagOut:
    """Auth: admin only. Rename and/or deactivate/reactivate. Audited."""
    return await admin_taxonomy_service.update_tag(db, tag_id, body, current_user)
