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
from app.schemas.follow import FollowedBrandOut, FollowListResponse, FollowOut


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
    if brand is None:
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


async def list_my_follows(
    db: AsyncSession, current_user, pagination: Pagination
) -> FollowListResponse:
    """GET /auth/me/follows. Paginated (backend/CLAUDE.md "ALWAYS include
    pagination on list endpoints") — DECISIONS.md "No follow cap for
    registered users" means this list has no natural upper bound, unlike
    `GET /locations/{id}/managers` which is capped small enough to skip
    paging.
    """
    base_stmt = select(UserFollow, RestaurantBrand).join(
        RestaurantBrand, RestaurantBrand.id == UserFollow.brand_id
    ).where(UserFollow.user_id == current_user.cognito_sub)

    total = (
        await db.execute(
            select(func.count())
            .select_from(UserFollow)
            .where(UserFollow.user_id == current_user.cognito_sub)
        )
    ).scalar_one()

    rows = (
        await db.execute(
            base_stmt.order_by(UserFollow.created_at.desc(), UserFollow.id.desc())
            .offset(pagination.offset)
            .limit(pagination.page_size)
        )
    ).all()

    results = [
        FollowedBrandOut(
            brand_id=brand.id,
            name=brand.name,
            slug=brand.slug,
            is_claimed=brand.is_claimed,
            followed_at=follow.created_at,
        )
        for follow, brand in rows
    ]
    return FollowListResponse(
        results=results, page=pagination.page, page_size=pagination.page_size, total=total
    )
