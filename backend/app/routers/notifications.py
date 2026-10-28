"""In-app notifications (the bell) — registered_user only, own rows only.
See docs/API_CONTRACTS.md "Notifications".

Route order matters: `POST /notifications/read-all` is declared before
`POST /notifications/{notification_id}/read` only for readability — the
paths cannot collide (`read-all` has no trailing `/read`).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.auth import CurrentUser, require_registered_user
from app.dependencies.db import get_db
from app.dependencies.pagination import Pagination, pagination_params
from app.schemas.notification import NotificationListResponse, NotificationsReadAllOut
from app.services import notification_service

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=NotificationListResponse)
async def list_my_notifications(
    pagination: Pagination = Depends(pagination_params),
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_registered_user),
) -> NotificationListResponse:
    """Auth: registered_user. Newest first; `unread_count` spans all pages."""
    return await notification_service.list_notifications(db, current_user.cognito_sub, pagination)


@router.post("/read-all", response_model=NotificationsReadAllOut)
async def mark_all_notifications_read(
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_registered_user),
) -> NotificationsReadAllOut:
    """Auth: registered_user. Marks every unread alert of the caller read."""
    return await notification_service.mark_all_read(db, current_user.cognito_sub)


@router.post("/{notification_id}/read", status_code=204)
async def mark_notification_read(
    notification_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_registered_user),
) -> Response:
    """Auth: registered_user. Idempotent; 404 if not the caller's own."""
    await notification_service.mark_read(db, current_user.cognito_sub, notification_id)
    return Response(status_code=204)
