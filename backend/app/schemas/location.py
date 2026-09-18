"""Request/response shapes for /locations (restaurant_location) — see
docs/API_CONTRACTS.md "Locations (restaurant_location)".
"""
from __future__ import annotations

from datetime import datetime, time

from pydantic import BaseModel, Field


class HoursOut(BaseModel):
    day_of_week: int
    open_time: time | None
    close_time: time | None
    is_closed: bool | None


class GalleryPhotoOut(BaseModel):
    id: int
    url: str
    # Added 2026-09-16 alongside restaurant_photo.thumbnail_s3_key — see
    # app/schemas/photo.py PhotoOut.thumbnail_url and docs/DECISIONS.md
    # "Resize Lambda: thumbnail variant". Additive: `url` unchanged.
    thumbnail_url: str
    display_order: int


class LocationOut(BaseModel):
    id: int
    brand_id: int
    # Added: the location editor page had no way to show the actual
    # restaurant name at all when `location_name` (an optional per-location
    # label, e.g. "Downtown") is unset -- it fell back to the raw street
    # address instead, which is the case for every location that doesn't
    # set a distinct label (every CSV-imported restaurant, found live
    # 2026-09-18 on /portal/locations/{id}).
    brand_name: str
    location_name: str | None
    address_line1: str
    address_line2: str | None
    city: str
    state: str
    postal_code: str
    country: str
    phone: str | None
    timezone: str
    latitude: float | None
    longitude: float | None
    is_verified: bool
    is_paid: bool
    # Added alongside is_active below (docs/PROJECT_PLAN.csv "Serialize
    # paid_until/is_active on location endpoints..."). `None` when free
    # tier (root CLAUDE.md "Tier model (is_paid)").
    paid_until: datetime | None
    # Soft-hide flag (restaurant_location.is_active) — was a real stored
    # column that this response never serialized before. `GET
    # /locations/{id}` itself is unchanged otherwise: it still returns a
    # deactivated location's detail to ANY caller (no filtering here, same
    # as before this change) — only `GET /restaurants/{id}/locations`
    # (list) gained owner/admin-aware filtering, see location_service.py.
    is_active: bool
    is_open_now: bool | None
    hours: list[HoursOut]
    cover_photo_url: str | None
    # Added 2026-09-16 alongside GalleryPhotoOut.thumbnail_url (see that
    # field's comment) — None exactly when cover_photo_url is None.
    cover_photo_thumbnail_url: str | None
    gallery_photos: list[GalleryPhotoOut]


class LocationCreate(BaseModel):
    brand_id: int
    address_line1: str = Field(min_length=1, max_length=255)
    address_line2: str | None = None
    city: str = Field(min_length=1, max_length=120)
    state: str = Field(min_length=2, max_length=2)
    postal_code: str = Field(min_length=1, max_length=10)
    country: str = Field(default="US", min_length=2, max_length=2)
    phone: str | None = None
    timezone: str = "America/Chicago"
    latitude: float | None = None
    longitude: float | None = None


class LocationUpdate(BaseModel):
    location_name: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None
    country: str | None = None
    phone: str | None = None
    timezone: str | None = None
    latitude: float | None = None
    longitude: float | None = None
