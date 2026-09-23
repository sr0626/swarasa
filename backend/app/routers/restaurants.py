"""restaurant_brand endpoints. See docs/API_CONTRACTS.md "Restaurants
(restaurant_brand)".

Public: GET /restaurants/{id}, GET /restaurants/{id}/locations
(backend/CLAUDE.md "Public Routes"). Everything else requires auth,
including the owner/admin-scoped list below (bare GET /restaurants).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.auth import (
    CurrentUser,
    get_current_user_optional,
    require_admin,
    require_brand_write_access,
    require_owner,
    require_owner_or_admin,
    require_registered_user,
)
from app.dependencies.db import get_db
from app.dependencies.pagination import Pagination, pagination_params
from app.schemas.follow import FollowOut
from app.schemas.restaurant import (
    LocationListResponse,
    RestaurantCreate,
    RestaurantListResponse,
    RestaurantListStatusValue,
    RestaurantOut,
    RestaurantSortValue,
    RestaurantUpdate,
)
from app.services import follow_service, location_service, restaurant_service

router = APIRouter(prefix="/restaurants", tags=["restaurants"])


@router.get("", response_model=RestaurantListResponse)
async def list_restaurants(
    owner_id: int | None = Query(
        default=None,
        description="Admin only — ignored for an owner caller, who is always "
        "filtered to their own owner_id regardless of this param.",
    ),
    owner_email: str | None = Query(
        default=None,
        max_length=255,
        description="Admin only — same ignored-for-owner-caller rule as "
        "owner_id. Case-insensitive substring match against the brand "
        "owner's owner_account.email. A brand with no owner (unclaimed, "
        "owner_id IS NULL) never matches a non-empty owner_email filter.",
    ),
    name: str | None = Query(
        default=None,
        max_length=255,
        description="Admin only. Case-insensitive substring match against "
        "restaurant_brand.name.",
    ),
    location_status: RestaurantListStatusValue | None = Query(
        default=None,
        alias="status",
        description="Admin only. Matches a brand if ANY of its locations "
        "currently has this restaurant_location.status value. The "
        "pseudo-value `deleted` instead returns ONLY soft-deleted "
        "listings; every other request (and every owner request) excludes "
        "soft-deleted listings.",
    ),
    is_paid: bool | None = Query(
        default=None,
        description="Admin only. Matches a brand if ANY of its locations "
        "has this restaurant_location.is_paid value (true = at least one "
        "paid location, false = at least one free location).",
    ),
    city: str | None = Query(
        default=None,
        max_length=120,
        description="Admin only. Case-insensitive exact match against "
        "restaurant_location.city. Matches a brand if ANY of its "
        "locations is in that city — a brand can have locations across "
        "multiple cities.",
    ),
    is_claimed: bool | None = Query(
        default=None,
        description="Admin only. Matches restaurant_brand.is_claimed exactly.",
    ),
    sort: RestaurantSortValue | None = Query(
        default=None,
        description="Optional. Omitted keeps the default id-ascending order. "
        "`followers` sorts by follower_count descending (ties broken by id "
        "ascending) — available to the same owner/admin caller as the rest "
        "of this endpoint, not admin-only.",
    ),
    pagination: Pagination = Depends(pagination_params),
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_owner_or_admin),
) -> RestaurantListResponse:
    """Auth: owner or admin. Owner caller: hard-filtered server-side to
    their own brands, no query param can widen this. Admin caller: the
    optional `owner_id` query param, omitted returns all brands
    (docs/API_CONTRACTS.md "GET /restaurants").

    `owner_email`/`name`/`status`/`is_paid`/`city`/`is_claimed` (added for
    the admin listings management page, docs/API_CONTRACTS.md "GET
    /restaurants" filters) follow the exact same admin-only,
    silently-ignored-for-an-owner-caller rule as `owner_id` — see
    `restaurant_service.list_restaurants`. All provided filters combine
    with AND (docs/API_CONTRACTS.md "GET /search" facet convention —
    independent filters AND together; there is no OR-within-a-filter case
    here since every new param here is single-valued, unlike `/search`'s
    `cuisine[]`/`dietary[]`/`type[]`).

    `sort` (added for the admin listings "Most followed" sort control) is
    NOT admin-only, unlike the filters above — see
    `restaurant_service.list_restaurants`'s docstring.
    """
    return await restaurant_service.list_restaurants(
        db,
        current_user,
        owner_id,
        pagination,
        owner_email=owner_email,
        name=name,
        status=location_status,
        is_paid=is_paid,
        city=city,
        is_claimed=is_claimed,
        sort=sort,
    )


@router.get("/{id_or_slug}", response_model=RestaurantOut)
async def get_restaurant(id_or_slug: str, db: AsyncSession = Depends(get_db)) -> RestaurantOut:
    """`id_or_slug` may be the numeric `restaurant_brand.id` or its `slug`
    (docs/API_CONTRACTS.md "GET /restaurants/{id}")."""
    return await restaurant_service.get_restaurant(db, id_or_slug)


@router.get("/{brand_id}/locations", response_model=LocationListResponse)
async def list_restaurant_locations(
    brand_id: int,
    pagination: Pagination = Depends(pagination_params),
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser | None = Depends(get_current_user_optional),
) -> LocationListResponse:
    """Public by default — active locations only (backend/CLAUDE.md
    "Public Routes"; docs/API_CONTRACTS.md "GET /restaurants/{id}/locations").
    An authenticated caller who owns this brand, or an admin, additionally
    sees their own deactivated locations here (docs/PROJECT_PLAN.csv
    "Serialize paid_until/is_active on location endpoints + let owner see
    own deactivated locations") — every other caller (anonymous, a
    manager, a registered_user, or an owner who does not own this brand)
    is unaffected. See `location_service.list_locations_for_brand` /
    `_caller_may_see_inactive_locations` for the exact rule.
    """
    return await location_service.list_locations_for_brand(
        db, brand_id, pagination, current_user
    )


@router.post("", response_model=RestaurantOut, status_code=status.HTTP_201_CREATED)
async def create_restaurant(
    body: RestaurantCreate,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_owner),
) -> RestaurantOut:
    return await restaurant_service.create_restaurant(db, body, current_user)


@router.patch("/{brand_id}", response_model=RestaurantOut)
async def update_restaurant(
    brand_id: int,
    body: RestaurantUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_brand_write_access),
) -> RestaurantOut:
    return await restaurant_service.update_restaurant(db, brand_id, body, current_user)


@router.delete("/{brand_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_restaurant(
    brand_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_admin),
) -> None:
    """Admin only. SOFT delete: stamps `restaurant_brand.deleted_at` and
    deactivates every active location of the brand in the same transaction.
    Idempotent, never 409s (docs/API_CONTRACTS.md "DELETE /restaurants/{id}")."""
    await restaurant_service.delete_restaurant(db, brand_id, current_user)


@router.post("/{brand_id}/restore", response_model=RestaurantOut)
async def restore_restaurant(
    brand_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_admin),
) -> RestaurantOut:
    """Admin only. Clears `deleted_at`; the brand's locations stay
    deactivated until re-enabled via `POST /locations/{id}/status`."""
    return await restaurant_service.restore_restaurant(db, brand_id, current_user)


@router.post("/{brand_id}/follow", response_model=FollowOut)
async def follow_restaurant(
    brand_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_registered_user),
) -> FollowOut:
    return await follow_service.follow_brand(db, brand_id, current_user)


@router.delete("/{brand_id}/follow", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def unfollow_restaurant(
    brand_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_registered_user),
) -> None:
    await follow_service.unfollow_brand(db, brand_id, current_user)
