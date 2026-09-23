"""`GET /admin/overview` aggregate — platform-wide restaurant/tier/owner
stats for the admin "Platform Overview" page. See docs/API_CONTRACTS.md
"Admin platform overview" and `app/schemas/admin_overview.py` for the full
response shape and the grain judgment call summarised again below.

Registered-user total is explicitly OUT OF SCOPE here (see
`AdminOverviewResponse.registered_user_count`'s own docstring) — a
companion PR wires it up once Infra grants Cognito access. Do not add any
`cognito-idp`/`boto3` call to this module.

Kept to two queries for the restaurant/tier counts (one `COUNT`, one
`GROUP BY`) and two more for the owner breakdown (one `COUNT`, one
`GROUP BY` join) — no N+1 per owner or per status value.
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.pagination import Pagination
from app.models.owner_account import OwnerAccount
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.schemas.admin_overview import (
    AdminOverviewResponse,
    OwnerOverview,
    OwnerOverviewItem,
    RestaurantOverview,
    StatusBreakdown,
    TierBreakdown,
)

STATUSES: tuple[str, ...] = RestaurantLocation.STATUSES


def _empty_status_counts() -> dict[str, int]:
    return {status: 0 for status in STATUSES}


async def _restaurant_overview(db: AsyncSession) -> RestaurantOverview:
    """Brand-grain, deliberately mirroring
    `restaurant_service.list_restaurants`'s "matches a brand if ANY of its
    locations satisfies the filter" semantics (docs/API_CONTRACTS.md "GET
    /restaurants" filters, PR #177) — so every count here equals the same
    `total` a caller gets back from `GET /restaurants?status=<x>` /
    `?is_paid=<x>`, and the admin overview page's `/admin/listings?...`
    links always agree with the tile they came from.

    `func.count(distinct(brand_id))` grouped by `status` (resp. `is_paid`)
    is exactly that "any location" count in one query: a brand with two
    `active` locations contributes once to the `active` bucket; a brand
    with one `active` and one `coming_soon` location contributes once to
    EACH bucket (JUDGMENT CALL, see `RestaurantOverview`'s own docstring —
    the 4 status counts, and the 2 tier counts, do not have to sum to
    `total`).
    """
    total = (
        await db.execute(
            select(func.count())
            .select_from(RestaurantBrand)
            .where(RestaurantBrand.deleted_at.is_(None))
        )
    ).scalar_one()

    status_rows = (
        await db.execute(
            select(
                RestaurantLocation.status,
                func.count(func.distinct(RestaurantLocation.brand_id)),
            )
            .join(RestaurantBrand, RestaurantBrand.id == RestaurantLocation.brand_id)
            .where(RestaurantBrand.deleted_at.is_(None))
            .group_by(RestaurantLocation.status)
        )
    ).all()
    by_status = _empty_status_counts()
    for status_value, count in status_rows:
        if status_value in by_status:
            by_status[status_value] = count

    tier_rows = (
        await db.execute(
            select(
                RestaurantLocation.is_paid,
                func.count(func.distinct(RestaurantLocation.brand_id)),
            )
            .join(RestaurantBrand, RestaurantBrand.id == RestaurantLocation.brand_id)
            .where(RestaurantBrand.deleted_at.is_(None))
            .group_by(RestaurantLocation.is_paid)
        )
    ).all()
    paid = free = 0
    for is_paid, count in tier_rows:
        if is_paid:
            paid = count
        else:
            free = count

    return RestaurantOverview(
        total=total,
        by_status=StatusBreakdown(**by_status),
        by_tier=TierBreakdown(paid=paid, free=free),
    )


async def _owner_overview(db: AsyncSession, pagination: Pagination) -> OwnerOverview:
    """Location-grain — NOT the same grain as `_restaurant_overview` above
    (JUDGMENT CALL, see `OwnerOverviewItem`'s own docstring). There is no
    `/admin/listings`-style click-through this table needs to stay
    link-consistent with, so it uses the more natural, arithmetically
    clean unit for "how many restaurants does this owner run": their
    actual `restaurant_location` row count, broken down by status (values
    always sum to the total, unlike the brand-grain counts above).

    Two queries: (1) the page of owners (owner_account joined to
    restaurant_brand, so only owners with >=1 brand appear, matching the
    "unique owners with at least one brand" requirement), (2) one GROUP BY
    (owner_id, status) over restaurant_location for exactly that page of
    owners — a single query covers every owner's full breakdown, no
    per-owner follow-up query.
    """
    total_owners = (
        await db.execute(
            select(func.count(func.distinct(RestaurantBrand.owner_id))).where(
                RestaurantBrand.owner_id.is_not(None), RestaurantBrand.deleted_at.is_(None)
            )
        )
    ).scalar_one()

    owner_rows = (
        await db.execute(
            select(OwnerAccount.id, OwnerAccount.email)
            .join(RestaurantBrand, RestaurantBrand.owner_id == OwnerAccount.id)
            .where(RestaurantBrand.deleted_at.is_(None))
            .distinct()
            .order_by(OwnerAccount.email, OwnerAccount.id)
            .offset(pagination.offset)
            .limit(pagination.page_size)
        )
    ).all()
    owner_ids = [row.id for row in owner_rows]

    breakdown: dict[int, dict[str, int]] = {owner_id: _empty_status_counts() for owner_id in owner_ids}
    if owner_ids:
        location_rows = (
            await db.execute(
                select(
                    RestaurantBrand.owner_id,
                    RestaurantLocation.status,
                    func.count(RestaurantLocation.id),
                )
                .join(RestaurantLocation, RestaurantLocation.brand_id == RestaurantBrand.id)
                .where(
                    RestaurantBrand.owner_id.in_(owner_ids), RestaurantBrand.deleted_at.is_(None)
                )
                .group_by(RestaurantBrand.owner_id, RestaurantLocation.status)
            )
        ).all()
        for owner_id, status_value, count in location_rows:
            if status_value in breakdown[owner_id]:
                breakdown[owner_id][status_value] = count

    results = [
        OwnerOverviewItem(
            owner_id=row.id,
            email=row.email,
            restaurant_count=sum(breakdown[row.id].values()),
            by_status=StatusBreakdown(**breakdown[row.id]),
        )
        for row in owner_rows
    ]

    return OwnerOverview(
        total_owners=total_owners,
        results=results,
        page=pagination.page,
        page_size=pagination.page_size,
        total=total_owners,
    )


async def get_admin_overview(db: AsyncSession, owner_pagination: Pagination) -> AdminOverviewResponse:
    """`page`/`page_size` paginate the owner list only — the restaurant/
    tier counts are always platform-wide totals."""
    restaurants = await _restaurant_overview(db)
    owners = await _owner_overview(db, owner_pagination)
    return AdminOverviewResponse(restaurants=restaurants, owners=owners, registered_user_count=None)
