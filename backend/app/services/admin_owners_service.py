"""`GET /admin/owners` — the admin "Owners" report: one row per
`owner_account` with joined date, brand/location counts (by status),
verified-location count, follower total and pending review items. See
docs/API_CONTRACTS.md "GET /admin/owners".

Query shape (no N+1, no fan-out): each aggregate is its own
`GROUP BY owner_id` subquery, LEFT JOINed onto `owner_account` — so the
brand, location, follow and pending-request counts can never multiply each
other the way a single multi-join `COUNT` would. Search, sort and
`LIMIT/OFFSET` are all applied in that one statement; a second `COUNT`
query gives `total` for the same search filter.

Owners with zero brands ARE listed (unlike the Platform Overview owner
table, which is "owners with >=1 brand") — an admin reviewing sign-ups
needs to see an owner who registered but hasn't added a restaurant yet.

CCPA-deleted owners (`personal_data_deleted_at` set) stay in the list,
flagged `personal_data_deleted=true`, with email/name/phone withheld: their
brands/locations still exist on the platform and hiding the row would make
the counts elsewhere (Overview) disagree with this report.
"""
from __future__ import annotations

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.pagination import Pagination
from app.models.claim_request import ClaimRequest
from app.models.location_reopen_request import LocationReopenRequest
from app.models.owner_account import OwnerAccount
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.models.user_follow import UserFollow
from app.schemas.admin_overview import StatusBreakdown
from app.schemas.admin_owners import AdminOwnerOut, AdminOwnersResponse, OwnerSort

PENDING_REVIEW = "pending_review"


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _search_filter(search: str | None):
    term = (search or "").strip()
    if not term:
        return None
    pattern = f"%{_escape_like(term)}%"
    return or_(
        OwnerAccount.email.ilike(pattern, escape="\\"),
        OwnerAccount.full_name.ilike(pattern, escape="\\"),
    )


async def get_admin_owners(
    db: AsyncSession,
    pagination: Pagination,
    search: str | None = None,
    sort: OwnerSort = "newest",
) -> AdminOwnersResponse:
    search_clause = _search_filter(search)

    count_stmt: Select = select(func.count()).select_from(OwnerAccount)
    if search_clause is not None:
        count_stmt = count_stmt.where(search_clause)
    total = (await db.execute(count_stmt)).scalar_one()

    # Soft-deleted brands (`restaurant_brand.deleted_at`) are excluded from
    # every per-owner count below.
    brand_sq = (
        select(
            RestaurantBrand.owner_id.label("owner_id"),
            func.count(RestaurantBrand.id).label("brand_count"),
        )
        .where(RestaurantBrand.owner_id.is_not(None), RestaurantBrand.deleted_at.is_(None))
        .group_by(RestaurantBrand.owner_id)
        .subquery("brand_agg")
    )

    def _status_count(status: str):
        return func.count(RestaurantLocation.id).filter(RestaurantLocation.status == status)

    location_sq = (
        select(
            RestaurantBrand.owner_id.label("owner_id"),
            func.count(RestaurantLocation.id).label("location_count"),
            _status_count(RestaurantLocation.STATUS_ACTIVE).label("active"),
            _status_count(RestaurantLocation.STATUS_OWNER_DEACTIVATED).label("owner_deactivated"),
            _status_count(RestaurantLocation.STATUS_COMING_SOON).label("coming_soon"),
            _status_count(RestaurantLocation.STATUS_CLOSED_PENDING_REOPEN).label(
                "closed_pending_reopen"
            ),
            func.count(RestaurantLocation.id)
            .filter(RestaurantLocation.is_verified.is_(True))
            .label("verified"),
        )
        .join(RestaurantLocation, RestaurantLocation.brand_id == RestaurantBrand.id)
        .where(RestaurantBrand.owner_id.is_not(None), RestaurantBrand.deleted_at.is_(None))
        .group_by(RestaurantBrand.owner_id)
        .subquery("location_agg")
    )

    follow_sq = (
        select(
            RestaurantBrand.owner_id.label("owner_id"),
            func.count(UserFollow.id).label("follower_count"),
        )
        .join(UserFollow, UserFollow.brand_id == RestaurantBrand.id)
        .where(RestaurantBrand.owner_id.is_not(None), RestaurantBrand.deleted_at.is_(None))
        .group_by(RestaurantBrand.owner_id)
        .subquery("follow_agg")
    )

    claim_sq = (
        select(
            ClaimRequest.claimant_user_id.label("cognito_sub"),
            func.count(ClaimRequest.id).label("pending_claims"),
        )
        .where(ClaimRequest.status == PENDING_REVIEW)
        .group_by(ClaimRequest.claimant_user_id)
        .subquery("claim_agg")
    )

    reopen_sq = (
        select(
            RestaurantBrand.owner_id.label("owner_id"),
            func.count(LocationReopenRequest.id).label("pending_reopens"),
        )
        .join(RestaurantLocation, RestaurantLocation.brand_id == RestaurantBrand.id)
        .join(LocationReopenRequest, LocationReopenRequest.location_id == RestaurantLocation.id)
        .where(
            RestaurantBrand.owner_id.is_not(None),
            RestaurantBrand.deleted_at.is_(None),
            LocationReopenRequest.status == PENDING_REVIEW,
        )
        .group_by(RestaurantBrand.owner_id)
        .subquery("reopen_agg")
    )

    def _n(column):
        return func.coalesce(column, 0)

    location_count = _n(location_sq.c.location_count)

    stmt = (
        select(
            OwnerAccount,
            _n(brand_sq.c.brand_count).label("brand_count"),
            location_count.label("location_count"),
            _n(location_sq.c.active).label("active"),
            _n(location_sq.c.owner_deactivated).label("owner_deactivated"),
            _n(location_sq.c.coming_soon).label("coming_soon"),
            _n(location_sq.c.closed_pending_reopen).label("closed_pending_reopen"),
            _n(location_sq.c.verified).label("verified"),
            _n(follow_sq.c.follower_count).label("follower_count"),
            _n(claim_sq.c.pending_claims).label("pending_claims"),
            _n(reopen_sq.c.pending_reopens).label("pending_reopens"),
        )
        .outerjoin(brand_sq, brand_sq.c.owner_id == OwnerAccount.id)
        .outerjoin(location_sq, location_sq.c.owner_id == OwnerAccount.id)
        .outerjoin(follow_sq, follow_sq.c.owner_id == OwnerAccount.id)
        .outerjoin(claim_sq, claim_sq.c.cognito_sub == OwnerAccount.cognito_sub)
        .outerjoin(reopen_sq, reopen_sq.c.owner_id == OwnerAccount.id)
    )
    if search_clause is not None:
        stmt = stmt.where(search_clause)

    # `id` is always the final tiebreaker so pages never reshuffle.
    if sort == "oldest":
        order = (OwnerAccount.created_at.asc(), OwnerAccount.id.asc())
    elif sort == "most_locations":
        order = (location_count.desc(), OwnerAccount.created_at.desc(), OwnerAccount.id.desc())
    elif sort == "email":
        order = (func.lower(OwnerAccount.email).asc(), OwnerAccount.id.asc())
    else:
        order = (OwnerAccount.created_at.desc(), OwnerAccount.id.desc())

    rows = (
        await db.execute(stmt.order_by(*order).offset(pagination.offset).limit(pagination.page_size))
    ).all()

    results: list[AdminOwnerOut] = []
    for row in rows:
        owner: OwnerAccount = row[0]
        deleted = owner.personal_data_deleted_at is not None
        results.append(
            AdminOwnerOut(
                id=owner.id,
                email=None if deleted else owner.email,
                full_name=None if deleted else owner.full_name,
                phone=None if deleted else owner.phone,
                joined_at=owner.created_at,
                personal_data_deleted=deleted,
                brand_count=row.brand_count,
                location_count=row.location_count,
                by_status=StatusBreakdown(
                    active=row.active,
                    owner_deactivated=row.owner_deactivated,
                    coming_soon=row.coming_soon,
                    closed_pending_reopen=row.closed_pending_reopen,
                ),
                verified_location_count=row.verified,
                follower_count=row.follower_count,
                pending_claim_count=row.pending_claims,
                pending_reopen_request_count=row.pending_reopens,
            )
        )

    return AdminOwnersResponse(
        results=results,
        page=pagination.page,
        page_size=pagination.page_size,
        total=total,
    )
