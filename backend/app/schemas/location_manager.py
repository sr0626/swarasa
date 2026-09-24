"""Request/response shapes for `/locations/{id}/managers` — see
docs/API_CONTRACTS.md "Location Managers". Kept as its own module rather
than folded into `schemas/location.py`: it's a distinct sub-resource with
its own request/response family (like `schemas/hours.py` and
`schemas/photo.py` are already split out from `schemas/location.py`),
not a variant of the `LocationOut`/`LocationCreate`/`LocationUpdate` shapes
that file holds.
"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class AssignManagerRequest(BaseModel):
    # Plain `str`, not Pydantic's `EmailStr` — no other schema in this app
    # uses `EmailStr` and `email-validator` isn't in requirements.txt
    # (see `schemas/auth.py`'s `email: str | None`); format validation
    # happens at the Cognito lookup (no matching user -> 404) rather than
    # here.
    manager_email: str = Field(min_length=3, max_length=255)


class LocationManagerOut(BaseModel):
    id: int
    location_id: int
    user_id: str
    email: str | None
    is_active: bool
    assigned_by_owner_id: int | None
    assigned_at: datetime
    revoked_at: datetime | None


class LocationManagerListResponse(BaseModel):
    results: list[LocationManagerOut]


class ManagedLocationOut(BaseModel):
    """One row of `GET /auth/me/managed-locations` — see
    docs/API_CONTRACTS.md "GET /auth/me/managed-locations". Same field
    shape as `schemas/restaurant.py`'s `LocationSummaryOut` (the
    brand-scoped `GET /restaurants/{id}/locations` listing) — deliberately
    duplicated rather than imported from there: this is a different
    sub-resource (a manager's own assignments, not a brand's locations)
    and the two lists are free to diverge later without one file reaching
    into the other's schema module (same reasoning `LocationManagerOut`
    above gives for living in its own file rather than `schemas/location.py`).
    """

    id: int
    # Added: the panel showing "Locations I manage" had no way to display
    # which RESTAURANT a location belongs to — location_name is an optional
    # per-location label (e.g. "Downtown"), not the brand/restaurant name,
    # so a manager with locations under different restaurants saw address
    # rows with no restaurant identity at all. Found live 2026-09-23.
    brand_name: str
    # Public-page URL parts (/restaurant/{brand_slug}/{slug}) so the manager
    # console's "View public page" can link to THIS location's page.
    slug: str
    brand_slug: str
    location_name: str | None
    address_line1: str
    city: str
    state: str
    postal_code: str
    phone: str | None
    is_verified: bool
    is_paid: bool
    is_open_now: bool | None
    # Dashboard-only stat (same field/reasoning as `RestaurantOut.
    # follower_count` — see `backend/app/schemas/restaurant.py`), added
    # here alongside it. Unlike that field this one is never `None`:
    # `GET /auth/me/managed-locations` is already hard-scoped to the
    # caller's own active assignments (`location_manager_service.
    # list_managed_locations`'s own docstring), so there's no public/
    # other-caller variant of this response to gate against — every row
    # this endpoint ever returns is one the caller is entitled to see.
    # Follows are brand-level (app/models/user_follow.py), not
    # location-level, so this is really the location's parent brand's
    # follower count — every location under the same brand reports the
    # same number.
    follower_count: int


class ManagedLocationListResponse(BaseModel):
    results: list[ManagedLocationOut]
    page: int
    page_size: int
    total: int
