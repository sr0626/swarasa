"""GET /search — public. See docs/API_CONTRACTS.md "GET /search"."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.auth import CurrentUser, get_current_user_lenient
from app.dependencies.db import get_db
from app.dependencies.pagination import Pagination, pagination_params
from app.schemas.search import SearchResponse
from app.services import activity_service, search_service

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
    loc: str | None = Query(
        default=None,
        description="The location text the user typed (city/ZIP). Used ONLY "
        "for a signed-in registered_user's search-history entry (clipped to "
        "100 chars there); never affects results (lat/lng do). No "
        "max_length here on purpose: an over-long value must not turn a "
        "public search into a 422 — it is just truncated when recorded.",
    ),
    pagination: Pagination = Depends(pagination_params),
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser | None = Depends(get_current_user_lenient),
) -> SearchResponse:
    results, total = await search_service.search(
        db, lat, lng, radius, cuisine, dietary, type_, pagination, q, has_deals_today
    )

    # Search-history recording for a signed-in registered_user only — a
    # best-effort no-op for everyone else and on any failure (see
    # `activity_service` module docstring). Page 1 only, so paging through
    # one result set is one search, not N.
    if pagination.page == 1:
        await activity_service.record_search_best_effort(
            db,
            current_user,
            q=q,
            cuisine=cuisine,
            dietary=dietary,
            type_=type_,
            loc=loc,
            has_deals_today=has_deals_today,
            result_count=total,
        )

    return SearchResponse(
        results=results, page=pagination.page, page_size=pagination.page_size, total=total
    )
