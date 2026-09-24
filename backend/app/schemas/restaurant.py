"""Request/response shapes for /restaurants (restaurant_brand) — see
docs/API_CONTRACTS.md "Restaurants (restaurant_brand)".
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.cuisine import CuisineTagOut
from app.schemas.location import LocationOut, LocationStatusValue
from app.schemas.search import NearestLocationOut

# `GET /restaurants` sort option (added for the admin "Most followed"
# sort control, docs/API_CONTRACTS.md "GET /restaurants"). Omitted/`None`
# keeps the existing, unchanged default (`restaurant_brand.id` ascending).
# `followers` orders by `follower_count` descending, ties broken by `id`
# ascending for a stable order across pages — see
# `restaurant_service.list_restaurants`.
RestaurantSortValue = Literal["followers"]

# `GET /restaurants?status=` accepts every real `restaurant_location.status`
# value PLUS the pseudo-status `deleted` (admin only): "only soft-deleted
# listings" — see `restaurant_service.list_restaurants`. Kept here, NOT
# added to `LocationStatusValue`, because that type also validates the
# `POST /locations/{id}/status` body, where `deleted` must stay illegal.
RestaurantListStatusValue = Literal[
    "active", "owner_deactivated", "coming_soon", "closed_pending_reopen", "deleted"
]


class RestaurantOut(BaseModel):
    id: int
    name: str
    slug: str
    description: str | None
    website: str | None
    is_claimed: bool
    # True while a claim_request for this brand is pending review. Public,
    # boolean-only (no claimant detail): the site hides the "Claim this
    # restaurant" CTA from everyone while a claim is in review, and shows
    # admins a "Claim pending" marker.
    has_pending_claim: bool = False
    owner_id: int | None
    cuisine_tags: list[CuisineTagOut]
    location_count: int
    # Dashboard-only stat, never public (docs/API_CONTRACTS.md "GET
    # /restaurants"). `null` for a caller who isn't allowed to see it —
    # the public `GET /restaurants/{id}` (and anonymous/registered_user/
    # manager-role callers generally) always get `null` here rather than
    # the field being omitted entirely, so the shape stays identical for
    # every caller (same posture `has_pending_claim`/`owner_id` already
    # take) while the *value* is caller-gated. Populated (an actual
    # count, 0 included) only for the owner-scoped `GET /restaurants`
    # list and for the owner/admin who just created/updated the brand —
    # see `restaurant_service._brand_to_out`'s `current_user` parameter.
    follower_count: int | None = None
    # Soft-delete timestamp (restaurant_brand.deleted_at). Always `null` for
    # a live brand — and a deleted brand is only ever returned to an admin
    # (`GET /restaurants?status=deleted`, `POST /restaurants/{id}/restore`),
    # never on a public/owner path.
    deleted_at: datetime | None = None


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
    # Own public-page slug (/restaurant/{brand_slug}/{slug}), unique per brand.
    slug: str
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
    # Added alongside the location status lifecycle
    # (app/models/restaurant_location.py) — same fields/semantics as
    # LocationOut.status/is_active (backend/app/schemas/location.py).
    status: LocationStatusValue
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


class BrandLocationCardOut(NearestLocationOut):
    """One ACTIVE location of a brand, as a landing-page card
    (`GET /restaurants/by-slug/{brand_slug}`): everything a search tile
    shows — `NearestLocationOut` (slug, address, phone, today's hours inputs,
    `is_open_now`, `has_deal_today` with the SAME predicate `/search` uses) —
    plus the location's own optional label and cover photo. `distance_mi` is
    always null (no viewer position). Public and content-free: deal titles are
    never here, only the boolean.
    """

    location_name: str | None = None
    cover_photo_url: str | None = None
    cover_photo_thumbnail_url: str | None = None


class RestaurantPublicOut(RestaurantOut):
    """`GET /restaurants/by-slug/{brand_slug}` — the brand plus its ACTIVE
    locations (hidden locations and soft-deleted brands never appear; a
    soft-deleted brand is a 404). Ordered by city (case-insensitive), then id.
    The public landing / single-location page decides what to render from
    `locations` (0 -> brand-only page, 1 -> that location's profile at the
    brand URL, 2+ -> landing page)."""

    locations: list[BrandLocationCardOut]


class LocationPageOut(BaseModel):
    """`GET /restaurants/by-slug/{brand_slug}/locations/{location_slug}` — one
    round trip for the location profile page: the brand (its
    `location_count` is the ACTIVE-location count, which is how the page
    decides its canonical URL) and the location's full detail, exactly the
    `GET /locations/{id}` payload (same visibility + deal-content gating)."""

    restaurant: RestaurantOut
    location: LocationOut


class PublicLocationIndexItem(BaseModel):
    """One row of `GET /sitemap/locations` — everything the sitemap needs to
    emit canonical URLs without a per-brand lookup."""

    brand_slug: str
    location_slug: str
    # ACTIVE locations of this brand: 1 means the canonical URL is the short
    # /restaurant/{brand_slug}; 2+ means /restaurant/{brand_slug}/{location_slug}.
    active_location_count: int
    updated_at: datetime


class PublicLocationIndexResponse(BaseModel):
    results: list[PublicLocationIndexItem]
    page: int
    page_size: int
    total: int
