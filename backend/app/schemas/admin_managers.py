"""`GET /admin/managers` — see docs/API_CONTRACTS.md "GET /admin/managers".
Backs the admin console's "Managers" report (`/admin/managers`), the
manager-side sibling of the Owners and Registered users reports.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from app.schemas.utc import UtcDatetime

ManagerSort = Literal["newest", "oldest", "most_locations", "email", "last_seen"]


class ManagerLocationOut(BaseModel):
    """One ACTIVE assignment, in the shape a compact "Restaurant — City"
    link needs (`brand_id` + `location_id` link to the admin listing)."""

    location_id: int
    brand_id: int
    brand_name: str
    location_name: str | None
    city: str


class ManagerOwnerOut(BaseModel):
    """An owner this manager works under, derived from the brands of their
    ACTIVE locations. `email`/`full_name` are `null` for a CCPA-deleted owner."""

    id: int
    email: str | None
    full_name: str | None


class AdminManagerOut(BaseModel):
    cognito_sub: str
    # Cognito email, best-effort (`null` when the lookup failed or the
    # account no longer exists — see `email_lookup_degraded` on the
    # response).
    email: str | None
    # `user_profile.full_name`; managers set it via `PATCH /auth/me`.
    full_name: str | None
    # Earliest `location_manager.assigned_at` across ALL of this manager's
    # rows, active or revoked ("manager since").
    first_assigned_at: UtcDatetime | None
    # `user_profile.last_seen_at` (throttled, best-effort); `null` = never
    # tracked yet.
    last_seen_at: UtcDatetime | None
    # Active assignments on locations of live (not soft-deleted) brands.
    active_location_count: int
    owners: list[ManagerOwnerOut]
    locations: list[ManagerLocationOut]


class AdminManagersResponse(BaseModel):
    results: list[AdminManagerOut]
    page: int
    page_size: int
    total: int
    # True when the Cognito email lookup failed: emails are `null`, and a
    # `q` search then matches names only.
    email_lookup_degraded: bool = False
