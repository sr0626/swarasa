"""Response shapes for `GET /admin/overview` — see docs/API_CONTRACTS.md
"Admin platform overview". Backs the admin console's "Platform Overview"
page (`/admin/overview`) — deliberately NOT named "Reports": that name is
already taken by the report-a-problem triage queue (`/admin/reports`,
`ReportsTriagePanel.tsx`).
"""
from __future__ import annotations

from pydantic import BaseModel


class StatusBreakdown(BaseModel):
    """Counts keyed by the 4-value `restaurant_location.status` lifecycle
    (app/models/restaurant_location.py "Location status lifecycle")."""

    active: int
    owner_deactivated: int
    coming_soon: int
    closed_pending_reopen: int


class TierBreakdown(BaseModel):
    paid: int
    free: int


class RestaurantOverview(BaseModel):
    """Brand-grain counts — see
    `app/services/admin_overview_service._restaurant_overview`'s docstring
    for the full judgment-call writeup. In short: `by_status`/`by_tier`
    use the exact same "matches a brand if ANY of its locations satisfies
    this" semantics as `GET /restaurants`' `status`/`is_paid` filters (PR
    #177), so every number here is identical to the `total` a caller gets
    back from `GET /restaurants?status=<x>` / `?is_paid=<x>` — the admin
    overview page's "view list" links (`/admin/listings?status=<x>`) always
    agree with the tile they came from.

    Because a brand can have several locations, `by_status`/`by_tier` are
    NOT mutually exclusive and do not have to sum to `total` — a brand
    with one `active` and one `coming_soon` location is counted in both
    buckets. `total` itself is a plain, unfiltered count of every
    `restaurant_brand` row.
    """

    total: int
    by_status: StatusBreakdown
    by_tier: TierBreakdown


class OwnerOverviewItem(BaseModel):
    owner_id: int
    email: str
    # Location-grain — see `admin_overview_service._owner_overview`
    # docstring. NOT the same grain as `RestaurantOverview` above: this is
    # a straightforward count of this owner's `restaurant_location` rows
    # (their actual operational footprint), not the "any location
    # matches" brand-grain count `RestaurantOverview` uses to stay
    # link-consistent with `/admin/listings`. `by_status` values always
    # sum to `restaurant_count` (unlike `RestaurantOverview.by_status`).
    restaurant_count: int
    by_status: StatusBreakdown


class OwnerOverview(BaseModel):
    # Full count of owners with >=1 brand — independent of `page`/`page_size`.
    total_owners: int
    results: list[OwnerOverviewItem]
    page: int
    page_size: int
    total: int


class AdminOverviewResponse(BaseModel):
    restaurants: RestaurantOverview
    owners: OwnerOverview
    # OUT OF SCOPE for this endpoint by design (see docs/PROJECT_PLAN.csv
    # — a separate, parallel task owns this): a true "total registered
    # users" count needs Cognito access (`cognito-idp:ListUsers`, an Infra
    # grant) or a post-confirmation hook writing a local row — same gap
    # `admin_notification_service.py`'s `new_users` section already
    # documents. Always `null` here; kept as an explicit field (rather
    # than omitted) so the frontend has a stable place to render a "coming
    # soon" tile against without a second schema/response change once the
    # companion PR lands.
    registered_user_count: int | None = None
