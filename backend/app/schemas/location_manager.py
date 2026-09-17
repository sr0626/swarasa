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
    location_name: str | None
    address_line1: str
    city: str
    state: str
    postal_code: str
    phone: str | None
    is_verified: bool
    is_paid: bool
    is_open_now: bool | None


class ManagedLocationListResponse(BaseModel):
    results: list[ManagedLocationOut]
    page: int
    page_size: int
    total: int
