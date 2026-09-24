"""Request/response shapes for `user_follow` — see docs/API_CONTRACTS.md
"Follows". Kept as its own module, same reasoning as `schemas/hours.py` /
`schemas/photo.py` / `schemas/location_manager.py` being split out from
their parent resource's schema file: a distinct sub-resource with its own
response family, not a variant of `RestaurantOut`.
"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


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
    """One row of `GET /auth/me/follows` — a brand summary, not the full
    `RestaurantOut` shape (no `cuisine_tags`/`location_count` — this list
    is "what do I follow", not a restaurant detail page)."""

    brand_id: int
    name: str
    slug: str
    is_claimed: bool
    followed_at: datetime
    # True when ANY of the brand's active locations has an active deal that
    # applies today (same predicate as `GET /search`'s per-location flag —
    # `deal_service.todays_deals_by_brand`).
    has_deal_today: bool = False
    # Up to 2 of today's deal titles (title only). Safe to include: this
    # endpoint is registered_user-only, a role that may view deal content
    # (`deal_service.caller_may_view_deal_content_for_location`). Empty
    # whenever `has_deal_today` is false.
    deal_titles_today: list[str] = []


class FollowListResponse(BaseModel):
    results: list[FollowedBrandOut]
    page: int
    page_size: int
    total: int
