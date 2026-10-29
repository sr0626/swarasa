"""`summary` objects added (additively) to the admin people/report list
responses -- `GET /admin/users|owners|managers|registered-users|listings`.
See docs/API_CONTRACTS.md "Admin list summaries".

Every summary counts the WHOLE dataset: it is computed before `q` / role /
status / filter parameters are applied and does not depend on `page`, so the
header above a table stays stable while an admin searches or pages. Counts are
consistent with the unfiltered list (`summary.total` == `total` of the same
request with no search/filter).
"""
from __future__ import annotations

from pydantic import BaseModel

# "Seen recently" window for the last_seen-based chips.
SEEN_WINDOW_DAYS = 30


class UserRoleCounts(BaseModel):
    """Users bucketed by their highest-privilege role (the row's `role`), so
    the four values sum to `total`."""

    admin: int = 0
    owner: int = 0
    manager: int = 0
    registered_user: int = 0


class AdminUsersSummary(BaseModel):
    total: int = 0
    # Cognito `Enabled` = true / false. active + inactive == total.
    active: int = 0
    inactive: int = 0
    # `status == UNCONFIRMED` (overlaps active/inactive -- not a partition).
    unconfirmed: int = 0
    # `user_profile.last_seen_at` within the last 30 days.
    seen_last_30_days: int = 0
    by_role: UserRoleCounts = UserRoleCounts()
    # True when a role group hit the per-group Cognito cap: counts are then a
    # lower bound.
    truncated: bool = False


class AdminOwnersSummary(BaseModel):
    # Every `owner_account` row (CCPA-deleted ones included, as in the list).
    total: int = 0
    # Owners with >= 1 ACTIVE location under a live (not soft-deleted) brand.
    active: int = 0
    # total - active: no locations at all, or none of them active (hidden,
    # coming soon, closed pending reopen). Unclaimed brands have no owner and
    # never count.
    inactive: int = 0
    # Subset of `inactive`: owners with no live location at all.
    without_locations: int = 0


class AdminManagersSummary(BaseModel):
    # Everyone listed (>= 1 assignment row, active or revoked).
    total: int = 0
    # >= 1 active assignment on a live brand's location.
    active: int = 0
    # total - active: every assignment revoked (or the brand was deleted).
    inactive: int = 0
    seen_last_30_days: int = 0


class AdminRegisteredUsersSummary(BaseModel):
    total: int = 0
    # Cognito `Enabled` = true / false. active + inactive == total.
    active: int = 0
    inactive: int = 0
    unconfirmed: int = 0
    seen_last_30_days: int = 0
    # Always false today (the diner sweep is uncapped); kept so every
    # Cognito-backed summary carries the same flag.
    truncated: bool = False


class AdminListingsSummary(BaseModel):
    # Live (not soft-deleted) brands.
    brands: int = 0
    # Live brands with `is_claimed = false` (no owner yet).
    unclaimed_brands: int = 0
    # Locations of live brands, and the same by the 4-value status lifecycle
    # (the four status counts sum to `locations`).
    locations: int = 0
    active: int = 0
    coming_soon: int = 0
    owner_deactivated: int = 0
    closed_pending_reopen: int = 0
