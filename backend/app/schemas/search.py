"""Response shapes for GET /search — see docs/API_CONTRACTS.md."""
from __future__ import annotations

from pydantic import BaseModel

from app.schemas.cuisine import CuisineTagOut


class NearestLocationOut(BaseModel):
    location_id: int
    distance_mi: float
    # Added: search result cards need the full street address for display
    # and a "get directions"-style link — city/state alone wasn't enough
    # (docs/PROJECT_PLAN.csv "Search result card: full address + Google
    # Maps link").
    address_line1: str
    city: str
    state: str
    postal_code: str
    is_verified: bool
    is_paid: bool
    is_open_now: bool | None


class SearchResultOut(BaseModel):
    brand_id: int
    name: str
    slug: str
    is_claimed: bool
    cuisine_tags: list[CuisineTagOut]
    nearest_location: NearestLocationOut
    location_count_nearby: int
    cover_photo_url: str | None
    # Added 2026-09-16 — search result cards are exactly the
    # bandwidth-sensitive, card-style-listing use case the resize
    # pipeline's thumbnail variant was added for (see
    # app/schemas/location.py GalleryPhotoOut.thumbnail_url and
    # docs/DECISIONS.md "Resize Lambda: thumbnail variant"). None exactly
    # when cover_photo_url is None.
    cover_photo_thumbnail_url: str | None


class SearchResponse(BaseModel):
    results: list[SearchResultOut]
    page: int
    page_size: int
    total: int
