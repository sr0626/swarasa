"""Request/response shapes for /restaurants (restaurant_brand) — see
docs/API_CONTRACTS.md "Restaurants (restaurant_brand)".
"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.cuisine import CuisineTagOut


class RestaurantOut(BaseModel):
    id: int
    name: str
    slug: str
    description: str | None
    website: str | None
    is_claimed: bool
    owner_id: int | None
    cuisine_tags: list[CuisineTagOut]
    location_count: int


class RestaurantCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    website: str | None = Field(default=None, max_length=500)
    cuisine_tag_ids: list[int] = Field(default_factory=list)


class RestaurantUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    website: str | None = Field(default=None, max_length=500)
    cuisine_tag_ids: list[int] | None = None


class LocationSummaryOut(BaseModel):
    id: int
    location_name: str | None
    address_line1: str
    city: str
    state: str
    postal_code: str
    phone: str | None
    is_verified: bool
    is_paid: bool
    # Added: real restaurant_location columns that were previously not
    # serialized here at all (docs/PROJECT_PLAN.csv "Serialize
    # paid_until/is_active on location endpoints..."). `paid_until` is
    # `None` on the free tier. `is_active` will always be `true` for an
    # anonymous/public caller (this endpoint still filters those out by
    # default — see location_service.list_locations_for_brand) but can be
    # `false` for the owning owner or an admin caller, who additionally
    # see their own deactivated locations.
    paid_until: datetime | None
    is_active: bool
    is_open_now: bool | None


class LocationListResponse(BaseModel):
    results: list[LocationSummaryOut]
    page: int
    page_size: int
    total: int


class RestaurantListResponse(BaseModel):
    """`GET /restaurants` — see docs/API_CONTRACTS.md "Owner-scoped
    restaurant list". Same per-row shape as `RestaurantOut`
    (`GET /restaurants/{id}`) — not a summary/list-trimmed variant.
    """

    results: list[RestaurantOut]
    page: int
    page_size: int
    total: int
