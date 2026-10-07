"""`GET /admin/listings` — the admin Listings page's data source.

Replaces the page's old fan-out (`GET /restaurants` + one public
`GET /restaurants/{id}/locations` per brand). That fan-out had two defects:
the per-brand call was unauthenticated, so it returned ACTIVE locations only —
a "Coming soon" filter matched a brand through a location the page then could
not show — and it could not carry admin-only provenance. This endpoint returns
each brand with ALL of its locations, the owner's email, and who created the
brand/location (from `audit_log`), in a fixed number of queries no matter how
many brands are on the page (no N+1; see `tests/integration/
test_admin_listings.py::test_query_count_does_not_grow_with_page_size`).

Filter semantics. Brand-level filters (`owner_id`, `owner_email`, `name`,
`is_claimed`, soft-delete visibility) are exactly `GET /restaurants`'s (shared
`restaurant_service.brand_level_filters`). Location-level filters (`status`,
`is_paid`, `city`) differ from `GET /restaurants` in ONE deliberate way: they
are evaluated against a SINGLE location. `GET /restaurants` ANDs three
independent "any location" tests, so `status=coming_soon&is_paid=true`
matches a brand whose coming-soon branch is free and whose active branch is
paid — a brand with no location that is both, which a per-location highlight
could not explain. Here a brand matches only if at least one location
satisfies every provided location-level filter, and each returned location
carries `matches_filter` saying whether it does. With a single filter the
two endpoints agree exactly (so the Overview tile counts still equal this
endpoint's `total`).
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.pagination import Pagination
from app.models.claim_request import ClaimRequest
from app.models.owner_account import OwnerAccount
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.models.user_follow import UserFollow
from app.schemas.admin_listings import (
    AdminListingLocationOut,
    AdminListingOut,
    AdminListingSort,
    AdminListingsResponse,
)
from app.schemas.cuisine import CuisineTagOut
from app.services import admin_actor_service, cuisine_service
from app.services.restaurant_service import brand_level_filters


def _location_conditions(status: str | None, is_paid: bool | None, city: str | None) -> list:
    conds: list = []
    if status is not None:
        conds.append(RestaurantLocation.status == status)
    if is_paid is not None:
        conds.append(RestaurantLocation.is_paid == is_paid)
    if city:
        conds.append(func.lower(RestaurantLocation.city) == city.strip().lower())
    return conds


def _location_matches(
    location: RestaurantLocation, status: str | None, is_paid: bool | None, city: str | None
) -> bool:
    if status is not None and location.status != status:
        return False
    if is_paid is not None and location.is_paid != is_paid:
        return False
    if city and (location.city or "").strip().lower() != city.strip().lower():
        return False
    return True


async def get_admin_listings(
    db: AsyncSession,
    pagination: Pagination,
    *,
    owner_id: int | None = None,
    brand_id: int | None = None,
    owner_email: str | None = None,
    name: str | None = None,
    status: str | None = None,
    is_paid: bool | None = None,
    city: str | None = None,
    is_claimed: bool | None = None,
    sort: AdminListingSort = "newest",
) -> AdminListingsResponse:
    filters, location_status = brand_level_filters(
        owner_id=owner_id,
        owner_email=owner_email,
        name=name,
        status=status,
        is_claimed=is_claimed,
    )
    if brand_id is not None:
        filters.append(RestaurantBrand.id == brand_id)
    location_conds = _location_conditions(location_status, is_paid, city)
    if location_conds:
        filters.append(
            RestaurantBrand.id.in_(select(RestaurantLocation.brand_id).where(*location_conds))
        )

    total = (
        await db.execute(select(func.count()).select_from(RestaurantBrand).where(*filters))
    ).scalar_one()

    if sort == "followers":
        follower_expr = (
            select(func.count())
            .select_from(UserFollow)
            .where(UserFollow.brand_id == RestaurantBrand.id)
            .correlate(RestaurantBrand)
            .scalar_subquery()
        )
        order = [follower_expr.desc(), RestaurantBrand.id.desc()]
    elif sort == "oldest":
        order = [RestaurantBrand.id.asc()]
    else:
        order = [RestaurantBrand.id.desc()]

    brands = (
        (
            await db.execute(
                select(RestaurantBrand)
                .where(*filters)
                .order_by(*order)
                .offset(pagination.offset)
                .limit(pagination.page_size)
            )
        )
        .scalars()
        .all()
    )
    if not brands:
        return AdminListingsResponse(
            results=[], page=pagination.page, page_size=pagination.page_size, total=total
        )

    brand_ids = [b.id for b in brands]

    locations = (
        (
            await db.execute(
                select(RestaurantLocation)
                .where(RestaurantLocation.brand_id.in_(brand_ids))
                .order_by(RestaurantLocation.id)
            )
        )
        .scalars()
        .all()
    )
    locations_by_brand: dict[int, list[RestaurantLocation]] = {bid: [] for bid in brand_ids}
    for loc in locations:
        locations_by_brand[loc.brand_id].append(loc)

    location_tags = await cuisine_service.get_location_cuisine_tags_bulk(
        db, [loc.id for loc in locations]
    )
    brand_tags = await cuisine_service.get_brand_union_tags_bulk(
        db, brand_ids, only_active=False
    )

    owner_ids = {b.owner_id for b in brands if b.owner_id is not None}
    owners: dict[int, OwnerAccount] = {}
    if owner_ids:
        owner_rows = (
            (await db.execute(select(OwnerAccount).where(OwnerAccount.id.in_(owner_ids))))
            .scalars()
            .all()
        )
        owners = {o.id: o for o in owner_rows}

    follower_rows = (
        await db.execute(
            select(UserFollow.brand_id, func.count())
            .where(UserFollow.brand_id.in_(brand_ids))
            .group_by(UserFollow.brand_id)
        )
    ).all()
    followers = {brand_id: count for brand_id, count in follower_rows}

    pending_claim_brand_ids = set(
        (
            await db.execute(
                select(ClaimRequest.brand_id)
                .where(
                    ClaimRequest.brand_id.in_(brand_ids),
                    ClaimRequest.status == "pending_review",
                )
                .distinct()
            )
        )
        .scalars()
        .all()
    )

    brand_creators, location_creators = await admin_actor_service.load_creators(
        db,
        brands={b.id: b.created_at for b in brands},
        locations={loc.id: loc.created_at for loc in locations},
    )

    results: list[AdminListingOut] = []
    for brand in brands:
        brand_locations = locations_by_brand[brand.id]
        owner = owners.get(brand.owner_id) if brand.owner_id is not None else None
        owner_deleted = owner is not None and owner.personal_data_deleted_at is not None
        creator = brand_creators[brand.id]
        results.append(
            AdminListingOut(
                id=brand.id,
                name=brand.name,
                slug=brand.slug,
                is_claimed=brand.is_claimed,
                has_pending_claim=brand.id in pending_claim_brand_ids,
                owner_id=brand.owner_id,
                owner_email=None if owner is None or owner_deleted else owner.email,
                owner_deleted=owner_deleted,
                location_count=sum(
                    1 for loc in brand_locations if loc.status == RestaurantLocation.STATUS_ACTIVE
                ),
                follower_count=followers.get(brand.id, 0),
                deleted_at=brand.deleted_at,
                cuisine_tags=[
                    CuisineTagOut.model_validate(t) for t in brand_tags.get(brand.id, [])
                ],
                locations=[
                    AdminListingLocationOut(
                        id=loc.id,
                        slug=loc.slug,
                        location_name=loc.location_name,
                        address_line1=loc.address_line1,
                        address_line2=getattr(loc, "address_line2", None),
                        city=loc.city,
                        state=loc.state,
                        postal_code=loc.postal_code,
                        phone=loc.phone,
                        status=loc.status,
                        is_verified=loc.is_verified,
                        is_paid=loc.is_paid,
                        paid_until=loc.paid_until,
                        cuisine_tags=[
                            CuisineTagOut.model_validate(t) for t in location_tags.get(loc.id, [])
                        ],
                        matches_filter=_location_matches(loc, location_status, is_paid, city),
                        **location_creators[loc.id].model_dump(),
                    )
                    for loc in brand_locations
                ],
                **creator.model_dump(),
            )
        )

    return AdminListingsResponse(
        results=results, page=pagination.page, page_size=pagination.page_size, total=total
    )
