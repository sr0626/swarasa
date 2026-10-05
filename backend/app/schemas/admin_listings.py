"""`GET /admin/listings` — see docs/API_CONTRACTS.md "GET /admin/listings".
Backs the admin console's Listings page (`/admin/listings`).

Admin-only by construction: this is a separate endpoint (not extra fields
on `GET /restaurants` / `GET /restaurants/{id}/locations`) precisely so the
provenance fields below — who owns a brand, who created a listing/location
and when — can never appear in a public, owner or manager payload.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from app.schemas.cuisine import CuisineTagOut
from app.schemas.location import LocationStatusValue
from app.schemas.utc import UtcDatetime

# Who created a record, per its `audit_log` "create" row:
#   owner/manager/admin — a signed-in caller of that role
#   system              — a non-interactive actor (import command, seed
#                         script, ...: audit `actor_id` starts "system:")
CreatorRole = Literal["owner", "manager", "admin", "system"]

AdminListingSort = Literal["newest", "oldest", "followers"]


class CreatorOut(BaseModel):
    """Provenance of one brand/location. Every field is nullable: a row that
    predates audit logging (or whose audit row was purged) has no known
    creator, and the frontend then shows the date alone."""

    # The audit "create" row's timestamp; falls back to the record's own
    # `created_at` when there is no audit row.
    created_at: UtcDatetime | None = None
    created_by_role: CreatorRole | None = None
    # Resolved account email (owner_account, else Cognito best-effort).
    # `null` when unknown, the account was CCPA-deleted, or the actor is a
    # system script.
    created_by_email: str | None = None
    # Ready-to-render actor text: the email when known, else "import" /
    # "seed" / a short script name for system actors, else the first 8
    # characters of the Cognito sub, else `null` (creator unknown).
    created_by_label: str | None = None


class AdminListingLocationOut(CreatorOut):
    id: int
    slug: str
    location_name: str | None
    address_line1: str
    address_line2: str | None = None
    city: str
    state: str
    postal_code: str
    phone: str | None
    status: LocationStatusValue
    is_verified: bool
    is_paid: bool
    paid_until: UtcDatetime | None = None
    cuisine_tags: list[CuisineTagOut] = []
    # True when this location satisfies EVERY location-level filter in the
    # request (`status`, `is_paid`, `city`); always true when none is set.
    # Lets the console highlight which location(s) made the brand match.
    matches_filter: bool = True


class AdminListingOut(CreatorOut):
    id: int
    name: str
    slug: str
    is_claimed: bool
    has_pending_claim: bool = False
    owner_id: int | None
    # `owner_account.email`; `null` for an unclaimed brand (owner_id null)
    # and for a CCPA-deleted owner (see `owner_deleted`).
    owner_email: str | None = None
    owner_deleted: bool = False
    # ACTIVE-location count (same meaning as `RestaurantOut.location_count`).
    location_count: int
    follower_count: int
    deleted_at: UtcDatetime | None = None
    # Distinct union of the brand's locations' tags (every status).
    cuisine_tags: list[CuisineTagOut] = []
    # EVERY location of the brand, whatever its status (coming soon,
    # hidden, closed...), oldest first.
    locations: list[AdminListingLocationOut]


class AdminListingsResponse(BaseModel):
    results: list[AdminListingOut]
    page: int
    page_size: int
    total: int
