"""Request/response shapes for `user_follow` — see docs/API_CONTRACTS.md
"Follows". Kept as its own module, same reasoning as `schemas/hours.py` /
`schemas/photo.py` / `schemas/location_manager.py` being split out from
their parent resource's schema file: a distinct sub-resource with its own
response family, not a variant of `RestaurantOut`.
"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.schemas.cuisine import CuisineTagOut
from app.schemas.search import NearestLocationOut


class FollowOut(BaseModel):
    """Response for `POST /restaurants/{id}/follow` — deliberately minimal
    (just the two fields that matter: which brand, since when). No `id`
    (the `user_follow.id` PK) is exposed: nothing in this API ever
    addresses a follow by its own id — `DELETE` targets a `brand_id`, same
    as the `POST`.
    """

    brand_id: int
    followed_at: datetime


class FollowedBrandOut(BaseModel):
    """One row of `GET /auth/me/follows`.

    Deliberately search-result-shaped (`brand_id`/`name`/`slug`/`is_claimed`/
    `cuisine_tags`/`nearest_location`/`location_count_nearby`/cover photo —
    see `schemas/search.SearchResultOut`) so the favourites grid renders the
    very same tile component as `/search`. Differences: `followed_at` is
    added, `nearest_location` is the ONE chosen location (see
    `follow_service`) with `distance_mi` always null (there is no viewer
    position), it is null when the brand has no active location, and
    `location_count_nearby` is the brand's total active-location count.
    """

    brand_id: int
    name: str
    slug: str
    is_claimed: bool
    followed_at: datetime
    cuisine_tags: list[CuisineTagOut] = []
    # The location the tile represents: the first (lowest id) active location
    # with a deal today, else the first active location (the one the
    # restaurant detail page shows first). None when the brand has no active
    # location.
    nearest_location: NearestLocationOut | None = None
    # Number of the brand's `active` locations (0 when none).
    location_count_nearby: int = 0
    # Cover photo of `nearest_location` (None when there is none).
    cover_photo_url: str | None = None
    cover_photo_thumbnail_url: str | None = None
    # True when ANY of the brand's active locations has an active deal that
    # applies today (same predicate as `GET /search`'s per-location flag —
    # `deal_service.todays_deals_by_brand`). When true, `nearest_location` is
    # a location that has the deal, so its own `has_deal_today` is true too.
    has_deal_today: bool = False
    # Up to 2 of today's deal titles (title only). Safe to include: this
    # endpoint is registered_user-only, a role that may view deal content
    # (`deal_service.caller_may_view_deal_content_for_location`). Empty
    # whenever `has_deal_today` is false. (The tile itself shows only the
    # badge; kept for API compatibility.)
    deal_titles_today: list[str] = []


class FollowListResponse(BaseModel):
    results: list[FollowedBrandOut]
    page: int
    page_size: int
    total: int
