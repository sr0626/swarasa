"""POST /activity/tile-click — registered_user only. See
docs/API_CONTRACTS.md "Activity tracking (`/activity`)" and
`app/services/activity_service.py` for the recording rules (registered
users only, size-bounded, best-effort, 12-month retention).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.auth import CurrentUser, require_registered_user
from app.dependencies.db import get_db
from app.schemas.activity import TileClickIn
from app.services import activity_service

router = APIRouter(prefix="/activity", tags=["activity"])


@router.post("/tile-click", status_code=204)
async def record_tile_click(
    body: TileClickIn,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_registered_user),
) -> Response:
    """Fire-and-forget from the client (a beacon on tile click). `204` on
    success — including when the write itself failed best-effort, since the
    caller can do nothing useful about it. `404` for an unknown brand or a
    location that doesn't belong to that brand (a client bug)."""
    await activity_service.record_tile_click(db, current_user, body)
    return Response(status_code=204)
