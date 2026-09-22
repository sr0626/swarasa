"""Request/response shapes for /locations (restaurant_location) — see
docs/API_CONTRACTS.md "Locations (restaurant_location)".
"""
from __future__ import annotations

from datetime import datetime, time
from typing import Literal

from pydantic import BaseModel, Field, field_validator

ABOUT_MAX_LENGTH = 1000
SPECIALTIES_MAX_ITEMS = 8
SPECIALTY_MAX_LENGTH = 40

# See app/models/restaurant_location.py "Location status lifecycle" for the
# full model. All four are legal *self-service* targets on
# `POST /locations/{id}/status` — the asymmetric "can't self-exit
# closed_pending_reopen" rule is enforced in location_service.py, not here
# (this schema only validates that the value is one of the four known
# statuses, same as ClaimStatus/ReportStatus elsewhere in this codebase).
LocationStatusValue = Literal[
    "active", "owner_deactivated", "coming_soon", "closed_pending_reopen"
]


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
    # Public profile content, see restaurant_location.about/specialties.
    about: str | None
    specialties: list[str] | None
    timezone: str
    latitude: float | None
    longitude: float | None
    is_verified: bool
    is_paid: bool
    # Added alongside is_active below (docs/PROJECT_PLAN.csv "Serialize
    # paid_until/is_active on location endpoints..."). `None` when free
    # tier (root CLAUDE.md "Tier model (is_paid)").
    paid_until: datetime | None
    # Product-state lifecycle (app/models/restaurant_location.py "Location
    # status lifecycle") — added alongside the enforcement change that
    # made `GET /locations/{id}` actually 404 a hidden location for a
    # caller without access (see location_service.get_location). A caller
    # who legitimately sees this response (public + active, or
    # owner/admin/assigned manager on any status) always gets the real
    # status string here.
    status: LocationStatusValue
    # Backward-compat derived flag — True only when status == "active".
    # kept alongside `status` (not replaced) since several existing
    # frontend call sites already read this boolean; see the hybrid
    # property of the same name on the model.
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
    # Public profile content. Unlike the fields above, an explicit `null`
    # (or empty string / empty list, normalised to None by the validators
    # below) CLEARS the stored value -- see location_service.update_location.
    about: str | None = None
    specialties: list[str] | None = None

    @field_validator("about")
    @classmethod
    def _normalise_about(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            return None
        if len(value) > ABOUT_MAX_LENGTH:
            raise ValueError(f"about must be at most {ABOUT_MAX_LENGTH} characters")
        return value

    @field_validator("specialties")
    @classmethod
    def _normalise_specialties(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned: list[str] = []
        seen: set[str] = set()
        for item in value:
            item = item.strip()
            if not item:
                continue
            if len(item) > SPECIALTY_MAX_LENGTH:
                raise ValueError(
                    f"each specialty must be at most {SPECIALTY_MAX_LENGTH} characters"
                )
            key = item.casefold()
            if key in seen:
                continue
            seen.add(key)
            cleaned.append(item)
        if len(cleaned) > SPECIALTIES_MAX_ITEMS:
            raise ValueError(f"at most {SPECIALTIES_MAX_ITEMS} specialties allowed")
        return cleaned or None


class LocationStatusUpdate(BaseModel):
    """Body for `POST /locations/{id}/status` — owner/admin self-service
    status change. `location_service.update_location_status` is what
    actually enforces the one asymmetric rule (no self-service transition
    OUT of `closed_pending_reopen`); this schema only validates the value
    shape."""

    status: LocationStatusValue
