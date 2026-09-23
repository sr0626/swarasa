"""GET /search — public. See docs/API_CONTRACTS.md "GET /search"."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.db import get_db
from app.dependencies.pagination import Pagination, pagination_params
from app.schemas.search import SearchResponse
from app.services import search_service

router = APIRouter(tags=["search"])


@router.get("/search", response_model=SearchResponse)
async def search(
    lat: float | None = Query(default=None),
    lng: float | None = Query(default=None),
    radius: float = Query(default=15, gt=0, le=100),
    cuisine: list[str] | None = Query(default=None, alias="cuisine[]"),
    dietary: list[str] | None = Query(default=None, alias="dietary[]"),
    type_: list[str] | None = Query(default=None, alias="type[]"),
    q: str | None = Query(default=None, max_length=100),
    has_deals_today: bool | None = Query(
        default=None,
        description="When true, only return brands with at least one "
        "location that has an active deal matching today (any candidate "
        "location within the radius/filter set, not just the nearest one "
        "shown on the card).",
    ),
    pagination: Pagination = Depends(pagination_params),
    db: AsyncSession = Depends(get_db),
) -> SearchResponse:
    results, total = await search_service.search(
        db, lat, lng, radius, cuisine, dietary, type_, pagination, q, has_deals_today
    )
    return SearchResponse(
        results=results, page=pagination.page, page_size=pagination.page_size, total=total
    )
