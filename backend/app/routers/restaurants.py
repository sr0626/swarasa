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
    RestaurantOut,
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
    pagination: Pagination = Depends(pagination_params),
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_owner_or_admin),
) -> RestaurantListResponse:
    """Auth: owner or admin. Owner caller: hard-filtered server-side to
    their own brands, no query param can widen this. Admin caller: the
    optional `owner_id` query param, omitted returns all brands
    (docs/API_CONTRACTS.md "GET /restaurants")."""
    return await restaurant_service.list_restaurants(db, current_user, owner_id, pagination)


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
    await restaurant_service.delete_restaurant(db, brand_id, current_user)


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
