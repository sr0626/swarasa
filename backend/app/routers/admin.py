"""Admin-only, cross-entity operational endpoints that don't belong under
a single resource's own router (`/restaurants`, `/locations`, ...).
`POST /admin/restaurants/bulk-import` is the first of these -- see
`app/services/restaurant_bulk_import_service.py` module docstring for what
it does and why (reusable bulk-import capability, requested separately
from the specific Irving, TX real-data seed it also unblocks).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.dependencies.auth import CurrentUser, require_admin
from app.dependencies.db import get_db
from app.models.owner_account import OwnerAccount
from app.schemas.admin_notifications import AdminNotificationsResponse
from app.schemas.restaurant_bulk_import import (
    BulkImportRequest,
    BulkImportResponse,
    BulkImportRowOut,
)
from app.services.admin_notification_service import get_admin_notifications
from app.services.restaurant_bulk_import_service import BulkImportError, bulk_import_restaurants

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/notifications", response_model=AdminNotificationsResponse)
async def admin_notifications_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_admin),
) -> AdminNotificationsResponse:
    """Auth: admin only. Counts + latest items for the top-bar bell: pending
    claims, new listing reports, owner sign-ups in the last 7 days. Read-only
    aggregate computed per request (see docs/API_CONTRACTS.md "Admin
    notifications" for the new-users limitation)."""
    return await get_admin_notifications(db)


@router.post("/restaurants/bulk-import", response_model=BulkImportResponse)
async def bulk_import_restaurants_endpoint(
    body: BulkImportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_admin),
) -> BulkImportResponse:
    """Auth: admin only (`require_admin`, same dependency
    `/claim/{id}/approve` and `/data-deletion/{id}/approve` use).

    `owner_id` in the request body names the local `owner_account.id` every
    row in this batch will be created under -- validated to exist up front
    so a bad id fails the whole call clearly, rather than surfacing as 26
    identical per-row errors.
    """
    owner = await db.get(OwnerAccount, body.owner_id)
    if owner is None:
        raise AppError(404, "owner_id does not match any owner_account", "not_found")

    try:
        result = await bulk_import_restaurants(
            db,
            body.restaurants,
            owner_id=body.owner_id,
            actor_id=current_user.cognito_sub,
            actor_role="admin",
        )
    except BulkImportError as exc:
        raise AppError(400, str(exc), "bulk_import_failed") from exc

    return BulkImportResponse(
        created=result.created,
        skipped=result.skipped,
        errors=result.errors,
        rows=[
            BulkImportRowOut(
                index=row.index,
                name=row.name,
                status=row.status.value,
                brand_id=row.brand_id,
                location_id=row.location_id,
                detail=row.detail,
            )
            for row in result.rows
        ],
    )
