"""Owner analytics -- docs/API_CONTRACTS.md "Owner analytics".

- `POST /track/location/{id}`  PUBLIC counter increment (204 always).
- `GET /locations/{id}/analytics`  owner / assigned manager / admin.
- `GET /restaurants/{id}/analytics`  brand owner / admin.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.auth import (
    CurrentUser,
    get_current_user_lenient,
    require_brand_write_access,
    require_location_read_access,
)
from app.dependencies.db import get_db
from app.schemas.analytics import BrandAnalyticsOut, LocationAnalyticsOut, TrackEventIn
from app.services import analytics_service

router = APIRouter(tags=["analytics"])


@router.post("/track/location/{location_id}", status_code=204)
async def track_location_event(
    location_id: int,
    body: TrackEventIn,
    db: AsyncSession = Depends(get_db),
    # Identity is used ONLY to drop an owner's/manager's/admin's own views;
    # `lenient` so a stale token can never turn a beacon into a 401.
    current_user: CurrentUser | None = Depends(get_current_user_lenient),
) -> Response:
    await analytics_service.record_event(db, location_id, body.event, current_user)
    return Response(status_code=204)


@router.get("/locations/{location_id}/analytics", response_model=LocationAnalyticsOut)
async def get_location_analytics(
    location_id: int,
    days: int = Query(30),
    db: AsyncSession = Depends(get_db),
    _user: CurrentUser = Depends(require_location_read_access),
) -> LocationAnalyticsOut:
    return await analytics_service.get_location_analytics(db, location_id, days)


@router.get("/restaurants/{brand_id}/analytics", response_model=BrandAnalyticsOut)
async def get_brand_analytics(
    brand_id: int,
    days: int = Query(30),
    db: AsyncSession = Depends(get_db),
    _user: CurrentUser = Depends(require_brand_write_access),
) -> BrandAnalyticsOut:
    return await analytics_service.get_brand_analytics(db, brand_id, days)
