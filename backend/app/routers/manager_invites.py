"""Invitee-side manager-invite endpoints — see docs/API_CONTRACTS.md
"Manager invites". The owner-side create/list/revoke live under
`/locations/{id}/manager-invites` (routers/locations.py).

The token travels in the POST body, never the URL path, so it doesn't end up
in access logs.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.auth import CurrentUser, get_current_user
from app.dependencies.db import get_db
from app.schemas.manager_invite import InviteAcceptedOut, InvitePreviewOut, InviteTokenRequest
from app.services import manager_invite_service

router = APIRouter(prefix="/manager-invites", tags=["manager-invites"])


@router.post("/preview", response_model=InvitePreviewOut)
async def preview_manager_invite(
    body: InviteTokenRequest,
    db: AsyncSession = Depends(get_db),
) -> InvitePreviewOut:
    """Auth: PUBLIC (the 256-bit token is the credential). Every unusable
    token gets the same generic 404."""
    return await manager_invite_service.preview_invite(db, body.token)


@router.post("/accept", response_model=InviteAcceptedOut)
async def accept_manager_invite(
    body: InviteTokenRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> InviteAcceptedOut:
    """Auth: any signed-in registered_user/manager whose verified email
    matches the invited address."""
    return await manager_invite_service.accept_invite(db, body.token, current_user)
