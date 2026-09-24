"""deal CRUD — owner (any of their locations) or an assigned manager (only
their assigned locations), same access-check pattern as photos/hours. See
docs/API_CONTRACTS.md "Deals (deal)".

Deliberately its own router/file, not folded into locations.py's existing
hours/photos sub-resource bundle (backend/CLAUDE.md "one file per resource")
— deals are a large enough, independent-enough domain concept (public
visibility gating, the expiry cron) to warrant its own module, even though
every route here nests under the same `/locations/{location_id}` path
prefix as locations.py's own router.

Public read of deal CONTENT does NOT live here — it's folded directly into
`GET /locations/{id}` (LocationOut.deals_today) and `GET /search`
(NearestLocationOut.has_deal_today), both in their existing
routers/services, per this task's explicit design (see
app/services/deal_service.py and app/services/location_service.py). This
router is the owner/manager/admin MANAGEMENT view only — always full
content, including inactive deals.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.auth import CurrentUser, require_location_write_access
from app.dependencies.db import get_db
from app.schemas.deal import (
    DealCreate,
    DealListResponse,
    DealOut,
    DealUpdate,
    DealVisibilityIn,
    DealVisibilityOut,
)
from app.services import deal_service

router = APIRouter(prefix="/locations", tags=["deals"])


@router.get("/{location_id}/deals", response_model=DealListResponse)
async def list_location_deals(
    location_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_location_write_access),
) -> DealListResponse:
    """Management view — owner/manager/admin sees every deal for this
    location, active or not (used by the deal editor)."""
    results = await deal_service.list_deals_for_location(db, location_id)
    return DealListResponse(
        results=results,
        deals_hidden=await deal_service.deals_hidden_for_location(db, location_id),
    )


@router.put("/{location_id}/deals/visibility", response_model=DealVisibilityOut)
async def set_location_deals_visibility(
    location_id: int,
    body: DealVisibilityIn,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_location_write_access),
) -> DealVisibilityOut:
    """"Hide all deals" / "Show all deals" — location-level, non-destructive;
    independent of each deal's own `is_active`. Idempotent."""
    return await deal_service.set_deals_hidden(db, location_id, body.is_hidden, current_user)


@router.post(
    "/{location_id}/deals", response_model=DealOut, status_code=status.HTTP_201_CREATED
)
async def create_location_deal(
    location_id: int,
    body: DealCreate,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_location_write_access),
) -> DealOut:
    return await deal_service.create_deal(db, location_id, body, current_user)


@router.patch("/{location_id}/deals/{deal_id}", response_model=DealOut)
async def update_location_deal(
    location_id: int,
    deal_id: int,
    body: DealUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_location_write_access),
) -> DealOut:
    return await deal_service.update_deal(db, location_id, deal_id, body, current_user)


@router.delete(
    "/{location_id}/deals/{deal_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
async def delete_location_deal(
    location_id: int,
    deal_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_location_write_access),
) -> None:
    await deal_service.delete_deal(db, location_id, deal_id, current_user)
