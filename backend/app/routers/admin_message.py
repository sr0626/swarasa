"""Contact admin + admin inbox. See docs/API_CONTRACTS.md "Contact admin".

- `POST /contact-admin` — owner or manager only.
- `GET /admin/messages`, `PATCH /admin/messages/{id}` — admin only.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.auth import CurrentUser, require_admin, require_owner_or_manager
from app.dependencies.db import get_db
from app.dependencies.pagination import Pagination, pagination_params
from app.schemas.admin_message import (
    SEARCH_MAX_LENGTH,
    AdminMessageListResponse,
    AdminMessageOut,
    AdminMessageStatus,
    AdminMessageUpdate,
    ContactAdminCreate,
    ContactAdminReceipt,
)
from app.services import admin_message_service

router = APIRouter(tags=["contact-admin"])


@router.post("/contact-admin", response_model=ContactAdminReceipt, status_code=status.HTTP_201_CREATED)
async def contact_admin(
    body: ContactAdminCreate,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_owner_or_manager),
) -> ContactAdminReceipt:
    """Auth: owner or manager. Max 5 messages per sender per rolling hour."""
    await admin_message_service.create_message(db, current_user, body)
    return ContactAdminReceipt()


@router.get("/admin/messages", response_model=AdminMessageListResponse)
async def list_admin_messages(
    status_filter: AdminMessageStatus | None = Query(default=None, alias="status"),
    q: str | None = Query(default=None, max_length=SEARCH_MAX_LENGTH),
    pagination: Pagination = Depends(pagination_params),
    db: AsyncSession = Depends(get_db),
    _admin: CurrentUser = Depends(require_admin),
) -> AdminMessageListResponse:
    """Auth: admin only. `status` = open | resolved (omit for all); `q`
    searches subject, body, sender email and sender name."""
    return await admin_message_service.list_messages(db, pagination, status_filter, q)


@router.patch("/admin/messages/{message_id}", response_model=AdminMessageOut)
async def update_admin_message(
    message_id: int,
    body: AdminMessageUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_admin),
) -> AdminMessageOut:
    """Auth: admin only. Resolve (`status=resolved`) or re-open (`open`)."""
    message = await admin_message_service.update_message_status(
        db, message_id, current_user.cognito_sub, body.status
    )
    return admin_message_service.to_message_out(message)
