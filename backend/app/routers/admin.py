"""Admin-only, cross-entity operational endpoints that don't belong under
a single resource's own router (`/restaurants`, `/locations`, ...).
`POST /admin/restaurants/bulk-import` is the first of these -- see
`app/services/restaurant_bulk_import_service.py` module docstring for what
it does and why (reusable bulk-import capability, requested separately
from the specific Irving, TX real-data seed it also unblocks).
"""
from __future__ import annotations

import logging

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.dependencies.auth import CurrentUser, require_admin
from app.dependencies.db import get_db
from app.dependencies.pagination import Pagination, pagination_params
from app.models.owner_account import OwnerAccount
from app.schemas.admin_notifications import AdminNotificationsResponse
from app.schemas.admin_overview import AdminOverviewResponse
from app.schemas.admin_stats import RegisteredUserCountResponse
from app.schemas.restaurant_bulk_import import (
    BulkImportRequest,
    BulkImportResponse,
    BulkImportRowOut,
)
from app.services import cognito_service
from app.services.admin_notification_service import get_admin_notifications
from app.services.admin_overview_service import get_admin_overview
from app.services.restaurant_bulk_import_service import BulkImportError, bulk_import_restaurants

logger = logging.getLogger("app.routers.admin")

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


@router.get("/registered-user-count", response_model=RegisteredUserCountResponse)
async def registered_user_count_endpoint(
    current_user: CurrentUser = Depends(require_admin),
) -> RegisteredUserCountResponse:
    """Auth: admin only. Total diner ("registered_user") sign-ups.

    Source of truth is Cognito, not the local database: `owner_account`
    only has rows for owners, and `user_profile` only gets a row when a
    diner sets a display name — most never do (see
    docs/API_CONTRACTS.md "GET /admin/notifications" known limitation,
    which this endpoint closes for the diner-count case specifically).
    "Registered users" reads as the `registered_user` pool group, not the
    whole pool (which would also count owner/manager/admin accounts) —
    that's the reading the `new_users` limitation note itself pointed at,
    and it's what an admin overview page asking "how many people signed up
    to browse/follow/save" actually wants.

    Live call, no caching — see `cognito_service.count_users_in_group`
    docstring for why that's fine here (admin-only, low-traffic).
    """
    try:
        count = cognito_service.count_users_in_group(cognito_service.REGISTERED_USER_GROUP)
    except ClientError as exc:
        logger.warning(
            "registered-user-count: Cognito ListUsersInGroup failed: %s",
            exc.response.get("Error", {}).get("Code", "ClientError"),
        )
        raise AppError(502, "Unable to retrieve registered user count", "upstream_error") from exc
    except (BotoCoreError, RuntimeError) as exc:
        logger.warning("registered-user-count: Cognito lookup failed: %s", type(exc).__name__)
        raise AppError(502, "Unable to retrieve registered user count", "upstream_error") from exc

    return RegisteredUserCountResponse(count=count)


@router.get("/overview", response_model=AdminOverviewResponse)
async def admin_overview_endpoint(
    pagination: Pagination = Depends(pagination_params),
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_admin),
) -> AdminOverviewResponse:
    """Auth: admin only. Platform-wide restaurant/tier/owner aggregate for
    the "Platform Overview" admin page (docs/API_CONTRACTS.md "Admin
    platform overview"). `page`/`page_size` paginate the owner breakdown
    list only — the restaurant/tier counts in the response are always
    platform-wide totals, never paginated."""
    return await get_admin_overview(db, pagination)


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
