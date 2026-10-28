"""Public city endpoints for the SEO city landing pages — no auth.
See docs/API_CONTRACTS.md "Cities"."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.db import get_db
from app.dependencies.pagination import Pagination, pagination_params
from app.schemas.city import CityListResponse, CityRestaurantsResponse
from app.services import city_service

router = APIRouter(prefix="/cities", tags=["cities"])

# Identical for every caller (no auth, content-free deal signal only), so a
# short shared-cache window is safe and keeps crawler bursts off Aurora.
_CACHE_CONTROL = "public, max-age=300, s-maxage=300"


@router.get("", response_model=CityListResponse)
async def list_cities(
    response: Response,
    pagination: Pagination = Depends(pagination_params),
    db: AsyncSession = Depends(get_db),
) -> CityListResponse:
    result = await city_service.list_cities(db, pagination)
    response.headers["Cache-Control"] = _CACHE_CONTROL
    return result


@router.get("/{slug}/restaurants", response_model=CityRestaurantsResponse)
async def list_city_restaurants(
    slug: str,
    response: Response,
    pagination: Pagination = Depends(pagination_params),
    db: AsyncSession = Depends(get_db),
) -> CityRestaurantsResponse:
    result = await city_service.list_city_restaurants(db, slug, pagination)
    response.headers["Cache-Control"] = _CACHE_CONTROL
    return result
