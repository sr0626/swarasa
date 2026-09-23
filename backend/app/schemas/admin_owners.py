"""`GET /admin/owners` — see docs/API_CONTRACTS.md "GET /admin/owners".
Backs the admin console's "Owners" report (`/admin/owners`), the owner-side
counterpart to `admin_registered_users.py`. Purely local-DB data
(`owner_account` + its brands/locations/follows/pending requests) — no
Cognito call — and deliberately carries NO billing/payment fields
(Stripe/`is_paid` work is deferred; nothing here may leak
`stripe_customer_id`/`stripe_sub_id`).
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas.admin_overview import StatusBreakdown

OwnerSort = Literal["newest", "oldest", "most_locations", "email"]


class AdminOwnerOut(BaseModel):
    id: int
    # `null` for an owner whose CCPA deletion was executed
    # (`personal_data_deleted=true`): the row's stored value is only a
    # synthetic tombstone (`deleted-owner-<id>@deleted.swarasa.invalid`),
    # which is never surfaced.
    email: str | None
    full_name: str | None
    phone: str | None
    # `owner_account.created_at`.
    joined_at: datetime
    # True once a CCPA deletion request for this owner was approved
    # (`owner_account.personal_data_deleted_at IS NOT NULL`). The row is
    # kept (brands/locations hang off it) but identity fields are redacted.
    personal_data_deleted: bool
    brand_count: int
    # Location-grain, same 4-value status lifecycle as
    # `GET /admin/overview`'s owner breakdown; values sum to `location_count`.
    location_count: int
    by_status: StatusBreakdown
    verified_location_count: int
    # Total `user_follow` rows across all of this owner's brands (a diner
    # following two of the owner's brands counts twice). Admin-only stat —
    # same gate as `RestaurantOut.follower_count`.
    follower_count: int
    # `claim_request` rows in `pending_review` submitted by this owner's
    # Cognito identity (claimant_user_id == owner_account.cognito_sub).
    pending_claim_count: int
    # `location_reopen_request` rows in `pending_review` for locations
    # under this owner's brands.
    pending_reopen_request_count: int


class AdminOwnersResponse(BaseModel):
    results: list[AdminOwnerOut]
    page: int
    page_size: int
    total: int
