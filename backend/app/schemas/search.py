"""Response shapes for GET /search — see docs/API_CONTRACTS.md."""
from __future__ import annotations

from datetime import time

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
    # Added alongside address_line1/postal_code — the search card shows a
    # clickable phone number too (docs/PROJECT_PLAN.csv "Search result
    # card: cover photo + full address..."). Nullable: restaurant_location.phone
    # itself is nullable.
    phone: str | None
    is_verified: bool
    is_paid: bool
    is_open_now: bool | None
    # Today's hours in the location's own timezone, for the card's
    # "Open today 11am-9pm" / "Closed today" label. None = unknown (no
    # hours row, or times missing) — the frontend shows no label then.
    # When is_closed is true, open_time/close_time are None.
    open_time: time | None = None
    close_time: time | None = None
    is_closed: bool | None = None


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
