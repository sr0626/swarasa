"""GET /sitemap/locations — public index of every ACTIVE location page, used by
the frontend's `sitemap.xml` (`frontend/src/app/sitemap.ts`) to list every
location URL with the right canonical form. See docs/API_CONTRACTS.md
"GET /sitemap/locations"."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.db import get_db
from app.dependencies.pagination import Pagination, pagination_params
from app.schemas.restaurant import PublicLocationIndexResponse
from app.services import restaurant_service

router = APIRouter(prefix="/sitemap", tags=["sitemap"])


@router.get("/locations", response_model=PublicLocationIndexResponse)
async def list_public_locations(
    pagination: Pagination = Depends(pagination_params),
    db: AsyncSession = Depends(get_db),
) -> PublicLocationIndexResponse:
    return await restaurant_service.list_public_location_index(db, pagination)
