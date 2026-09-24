"""`user_follow` business logic for `/restaurants/{id}/follow` and
`/auth/me/follows` — see docs/API_CONTRACTS.md "Follows".

`user_follow` is not on root CLAUDE.md's audit-required table list
(restaurant_brand, restaurant_location, menu_item, deal, owner_account,
location_manager) — no `audit_service.log` call here, deliberately, unlike
`location_manager_service`.
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.dependencies.pagination import Pagination
from app.models.restaurant_brand import RestaurantBrand
from app.models.user_follow import UserFollow
from app.models.restaurant_location import RestaurantLocation
from app.schemas.cuisine import CuisineTagOut
from app.schemas.follow import FollowedBrandOut, FollowListResponse, FollowOut
from app.schemas.search import NearestLocationOut
from app.services import cuisine_service, deal_service, hours_service, photo_service, s3_service

# Max deal titles surfaced per followed-brand tile.
_MAX_DEAL_TITLES = 2


async def _get_existing_follow(db: AsyncSession, user_id: str, brand_id: int) -> UserFollow | None:
    result = await db.execute(
        select(UserFollow).where(UserFollow.user_id == user_id, UserFollow.brand_id == brand_id)
    )
    return result.scalar_one_or_none()


async def count_followers_for_brand(db: AsyncSession, brand_id: int) -> int:
    """Owner/manager/admin-dashboard-only stat — see
    `restaurant_service._brand_to_out` (RestaurantOut.follower_count,
    caller-gated so this never reaches a public response) and
    `location_manager_service.list_managed_locations`
    (ManagedLocationOut.follower_count, already self-scoped to the
    caller's own assignments). Follows are brand-level, not
    location-level (see app/models/user_follow.py), so a location's
    follower_count is really its parent brand's count — every location
    under the same brand reports the same number, same as
    `location_count` is a brand-level stat too.
    """
    result = await db.execute(
        select(func.count()).select_from(UserFollow).where(UserFollow.brand_id == brand_id)
    )
    return result.scalar_one()


async def follow_brand(db: AsyncSession, brand_id: int, current_user) -> FollowOut:
    """POST /restaurants/{id}/follow.

    Idempotent: following a brand the user already follows is a success,
    not an error — returns the existing follow's original `followed_at`
    rather than creating a second row (the `uq_user_follow_user_brand`
    unique constraint would reject a duplicate insert anyway; checking
    first avoids relying on that as the only path and keeps the "already
    following" case from touching the DB at all).
    """
    brand = await db.get(RestaurantBrand, brand_id)
    if brand is None or brand.deleted_at is not None:
        raise AppError(404, "Restaurant not found", "not_found")

    existing = await _get_existing_follow(db, current_user.cognito_sub, brand_id)
    if existing is not None:
        return FollowOut(brand_id=brand_id, followed_at=existing.created_at)

    follow = UserFollow(user_id=current_user.cognito_sub, brand_id=brand_id)
    db.add(follow)
    try:
        await db.flush()
    except IntegrityError:
        # Concurrent follow request for the same user/brand raced us
        # between the check above and this insert — same defensive pattern
        # as `location_manager_service.assign_manager`'s IntegrityError
        # catch. Not a real error: re-fetch and return the row the other
        # request created.
        await db.rollback()
        existing = await _get_existing_follow(db, current_user.cognito_sub, brand_id)
        if existing is None:  # pragma: no cover - should be unreachable
            raise
        return FollowOut(brand_id=brand_id, followed_at=existing.created_at)

    await db.commit()
    return FollowOut(brand_id=brand_id, followed_at=follow.created_at)


async def unfollow_brand(db: AsyncSession, brand_id: int, current_user) -> None:
    """DELETE /restaurants/{id}/follow.

    Idempotent, same posture as
    `location_manager_service.deactivate_manager`: unfollowing a brand the
    user doesn't follow (or that doesn't exist) is a no-op success, not a
    404/409 — plain REST-delete idempotency. Unlike that manager case
    there's no "existing but already in the target state" row to leave
    untouched here; there's either a row to delete or there isn't.
    """
    existing = await _get_existing_follow(db, current_user.cognito_sub, brand_id)
    if existing is None:
        return

    await db.delete(existing)
    await db.commit()


async def _active_locations_by_brand(
    db: AsyncSession, brand_ids: list[int]
) -> dict[int, list]:
    """One batched query: every `active` location of the given brands,
    ordered by id — so index 0 is the brand's primary display location (the
    one the detail page shows first, `GET /restaurants/{id}/locations`).
    Brands are already known not to be soft-deleted (the caller's page
    query excludes them). Only the columns a search-style tile needs.
    """
    if not brand_ids:
        return {}
    rows = (
        await db.execute(
            select(
                RestaurantLocation.id,
                RestaurantLocation.brand_id,
                RestaurantLocation.slug,
                RestaurantLocation.address_line1,
                RestaurantLocation.city,
                RestaurantLocation.state,
                RestaurantLocation.postal_code,
                RestaurantLocation.phone,
                RestaurantLocation.is_verified,
                RestaurantLocation.is_paid,
                RestaurantLocation.timezone,
            )
            .where(
                RestaurantLocation.brand_id.in_(brand_ids),
                RestaurantLocation.status == RestaurantLocation.STATUS_ACTIVE,
            )
            .order_by(RestaurantLocation.id)
        )
    ).all()
    by_brand: dict[int, list] = {}
    for row in rows:
        by_brand.setdefault(row.brand_id, []).append(row)
    return by_brand


def _choose_location(locations: list, deals: list):
    """The location a brand's tile represents. Deals are per location and
    same-name restaurants run different location-based deals, so when the
    brand has a deal today the tile must show THE DEAL'S location: the first
    (lowest id — `todays_deals_by_brand` orders deals by location id) active
    location with a deal today. Otherwise the primary location — the first
    active location, same rule as the restaurant detail page. None when the
    brand has no active location.
    """
    if not locations:
        return None
    if deals:
        by_id = {row.id: row for row in locations}
        deal_location = by_id.get(deals[0].location_id)
        if deal_location is not None:
            return deal_location
    return locations[0]


def _nearest_location_out(row, has_deal_today: bool, hours_rows: list) -> NearestLocationOut:
    """`NearestLocationOut` for a followed brand's chosen location — the same
    shape/semantics `/search` builds, minus distance (no viewer position)."""
    today = hours_service.today_weekday(row.timezone)
    today_row = next((h for h in hours_rows if h.day_of_week == today), None)
    status = hours_service.compute_today_status(today_row, row.timezone)
    return NearestLocationOut(
        location_id=row.id,
        slug=row.slug,
        distance_mi=None,
        address_line1=row.address_line1,
        city=row.city,
        state=row.state,
        postal_code=row.postal_code,
        phone=row.phone,
        is_verified=row.is_verified,
        is_paid=row.is_paid,
        is_open_now=status.is_open_now,
        open_time=status.open_time,
        close_time=status.close_time,
        is_closed=status.is_closed,
        has_deal_today=has_deal_today,
    )


async def list_my_follows(
    db: AsyncSession, current_user, pagination: Pagination
) -> FollowListResponse:
    """GET /auth/me/follows. Paginated (backend/CLAUDE.md "ALWAYS include
    pagination on list endpoints") — DECISIONS.md "No follow cap for
    registered users" means this list has no natural upper bound, unlike
    `GET /locations/{id}/managers` which is capped small enough to skip
    paging.
    """
    # Soft-deleted brands (`restaurant_brand.deleted_at`) are excluded from
    # both the page and `total` — a favourites list never shows a dead
    # listing. The `user_follow` row itself is kept, so a restored brand
    # reappears in the follower's list.
    base_stmt = (
        select(UserFollow, RestaurantBrand)
        .join(RestaurantBrand, RestaurantBrand.id == UserFollow.brand_id)
        .where(
            UserFollow.user_id == current_user.cognito_sub,
            RestaurantBrand.deleted_at.is_(None),
        )
    )

    total = (
        await db.execute(
            select(func.count())
            .select_from(UserFollow)
            .join(RestaurantBrand, RestaurantBrand.id == UserFollow.brand_id)
            .where(
                UserFollow.user_id == current_user.cognito_sub,
                RestaurantBrand.deleted_at.is_(None),
            )
        )
    ).scalar_one()

    rows = (
        await db.execute(
            base_stmt.order_by(UserFollow.created_at.desc(), UserFollow.id.desc())
            .offset(pagination.offset)
            .limit(pagination.page_size)
        )
    ).all()

    # Batch (2 queries for the whole page, no per-brand lookups) — see
    # `deal_service.todays_deals_by_brand`. Follows are brand-level and deals
    # are per location, so a brand "has a deal today" when any active
    # location does.
    deals_by_brand = await deal_service.todays_deals_by_brand(
        db, [brand.id for _, brand in rows]
    )

    # Follows are brand-level, but a tile represents ONE location (see
    # `_choose_location`). Everything below is batched over the whole page —
    # one query each for locations, cuisine tags, hours and cover photos — so
    # the total query count is constant, independent of page size.
    brand_ids = [brand.id for _, brand in rows]
    locations_by_brand = await _active_locations_by_brand(db, brand_ids)
    chosen_by_brand = {
        brand.id: _choose_location(
            locations_by_brand.get(brand.id, []), deals_by_brand.get(brand.id, [])
        )
        for _, brand in rows
    }
    chosen_ids = [loc.id for loc in chosen_by_brand.values() if loc is not None]
    tags_by_brand = await cuisine_service.get_brand_cuisine_tags_bulk(db, brand_ids)
    hours_by_location = await hours_service.get_hours_map_for_locations(db, chosen_ids)
    covers_by_location = await photo_service.get_cover_photos_bulk(db, chosen_ids)

    results: list[FollowedBrandOut] = []
    for follow, brand in rows:
        chosen = chosen_by_brand[brand.id]
        deals = deals_by_brand.get(brand.id, [])
        cover = covers_by_location.get(chosen.id) if chosen is not None else None
        results.append(
            FollowedBrandOut(
                brand_id=brand.id,
                name=brand.name,
                slug=brand.slug,
                is_claimed=brand.is_claimed,
                followed_at=follow.created_at,
                cuisine_tags=[
                    CuisineTagOut.model_validate(t) for t in tags_by_brand.get(brand.id, [])
                ],
                nearest_location=(
                    _nearest_location_out(
                        chosen, bool(deals), hours_by_location.get(chosen.id, [])
                    )
                    if chosen is not None
                    else None
                ),
                location_count_nearby=len(locations_by_brand.get(brand.id, [])),
                cover_photo_url=s3_service.resolve_media_url(cover.s3_key) if cover else None,
                cover_photo_thumbnail_url=(
                    s3_service.resolve_media_url(cover.thumbnail_s3_key or cover.s3_key)
                    if cover
                    else None
                ),
                has_deal_today=bool(deals),
                deal_titles_today=[d.title for d in deals[:_MAX_DEAL_TITLES]],
            )
        )
    return FollowListResponse(
        results=results, page=pagination.page, page_size=pagination.page_size, total=total
    )
