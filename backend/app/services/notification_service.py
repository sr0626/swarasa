"""In-app notifications for `registered_user` accounts (the bell).

First kind: `deal_new` — a NEW deal was created at a location; every user
following that location's BRAND (`user_follow` is brand-level, see
app/models/user_follow.py) gets one `user_notification` row. No email / SES
(deferred) and no queue: the fan-out is one synchronous
`INSERT ... SELECT` inside `deal_service.create_deal`'s transaction.

FAN-OUT CAP: at most `MAX_FANOUT_PER_DEAL` (1000) followers are notified per
deal, lowest `user_follow.id` first (the longest-standing followers) so the
result is deterministic. Keeps the create-deal request bounded on Lambda;
there is no follow cap per brand today, so a viral brand is the only case
that hits it. Raising it / moving to an async worker is the follow-up if
that ever matters (log line `deal alert fan-out capped` marks the event).

The fan-out runs in a SAVEPOINT and is best-effort: a failure rolls back
only the notification rows and never blocks creating the deal.

Eligibility (`should_notify_for_deal`): the deal is active, hasn't already
ended, the location is publicly visible (`status == 'active'`) and has not
hidden its deals (`deals_hidden`), and the brand isn't soft-deleted — i.e.
exactly the deals a public viewer could see. The acting user is never
notified.

Reading: `registered_user` only (router), and every query is scoped to the
caller's own `user_sub` — another user's notification id is a 404, never a
403, so ids can't be probed.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import and_, func, insert, literal, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.dependencies.pagination import Pagination
from app.models.deal import Deal
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.models.user_follow import UserFollow
from app.models.user_notification import UserNotification
from app.schemas.notification import (
    NotificationListResponse,
    NotificationOut,
    NotificationsReadAllOut,
)

logger = logging.getLogger("app.notifications")

KIND_DEAL_NEW = "deal_new"

# Max followers notified per new deal. See module docstring.
MAX_FANOUT_PER_DEAL = 1000


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def should_notify_for_deal(
    deal: Deal,
    location: RestaurantLocation,
    *,
    brand_deleted: bool,
    now: datetime | None = None,
) -> bool:
    """Pure eligibility check — see module docstring."""
    if not deal.is_active or location.deals_hidden or brand_deleted:
        return False
    if location.status != "active":
        return False
    now = now or datetime.now(timezone.utc)
    if deal.end_at is not None and _aware(deal.end_at) <= now:
        return False
    return True


async def notify_followers_of_new_deal(
    db: AsyncSession,
    location: RestaurantLocation,
    deal: Deal,
    actor_sub: str,
) -> int:
    """Insert a `deal_new` notification for each follower of the location's
    brand (capped, actor excluded). Returns the number of rows inserted.
    Caller owns the transaction (does NOT commit). Best-effort: any failure
    is logged and swallowed after rolling back to the savepoint, so deal
    creation itself is never blocked by it."""
    brand = await db.get(RestaurantBrand, location.brand_id)
    if brand is None or not should_notify_for_deal(
        deal, location, brand_deleted=brand.deleted_at is not None
    ):
        return 0

    followers = (
        select(
            UserFollow.user_id,
            literal(KIND_DEAL_NEW),
            literal(location.id),
            literal(deal.id),
            literal(deal.title),
        )
        .where(UserFollow.brand_id == location.brand_id, UserFollow.user_id != actor_sub)
        .order_by(UserFollow.id)
        .limit(MAX_FANOUT_PER_DEAL)
    )
    try:
        async with db.begin_nested():
            result = await db.execute(
                insert(UserNotification).from_select(
                    ["user_sub", "kind", "location_id", "deal_id", "title"], followers
                )
            )
    except Exception:  # noqa: BLE001 - best-effort, see docstring
        logger.warning("deal alert fan-out failed for deal %s", deal.id, exc_info=True)
        return 0
    inserted = result.rowcount or 0
    if inserted >= MAX_FANOUT_PER_DEAL:
        logger.warning("deal alert fan-out capped at %s for deal %s", MAX_FANOUT_PER_DEAL, deal.id)
    return inserted


def _to_out(notification: UserNotification, location: RestaurantLocation, brand: RestaurantBrand) -> NotificationOut:
    return NotificationOut(
        id=notification.id,
        kind=notification.kind,  # type: ignore[arg-type]
        title=notification.title,
        location_id=notification.location_id,
        restaurant_name=location.location_name or brand.name,
        city=location.city,
        brand_slug=brand.slug,
        location_slug=location.slug,
        created_at=notification.created_at,
        read_at=notification.read_at,
    )


async def unread_count(db: AsyncSession, user_sub: str) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(UserNotification)
            .where(UserNotification.user_sub == user_sub, UserNotification.read_at.is_(None))
        )
    ).scalar_one()


async def list_notifications(
    db: AsyncSession, user_sub: str, pagination: Pagination
) -> NotificationListResponse:
    total = (
        await db.execute(
            select(func.count())
            .select_from(UserNotification)
            .where(UserNotification.user_sub == user_sub)
        )
    ).scalar_one()
    rows = (
        await db.execute(
            select(UserNotification, RestaurantLocation, RestaurantBrand)
            .join(RestaurantLocation, RestaurantLocation.id == UserNotification.location_id)
            .join(RestaurantBrand, RestaurantBrand.id == RestaurantLocation.brand_id)
            .where(UserNotification.user_sub == user_sub)
            .order_by(UserNotification.created_at.desc(), UserNotification.id.desc())
            .offset(pagination.offset)
            .limit(pagination.page_size)
        )
    ).all()
    return NotificationListResponse(
        results=[_to_out(n, loc, brand) for n, loc, brand in rows],
        page=pagination.page,
        page_size=pagination.page_size,
        total=total,
        unread_count=await unread_count(db, user_sub),
    )


async def mark_read(db: AsyncSession, user_sub: str, notification_id: int) -> None:
    """Idempotent. 404 for a missing id OR one belonging to another user."""
    notification = (
        await db.execute(
            select(UserNotification).where(
                and_(UserNotification.id == notification_id, UserNotification.user_sub == user_sub)
            )
        )
    ).scalar_one_or_none()
    if notification is None:
        raise AppError(404, "Notification not found", "not_found")
    if notification.read_at is None:
        notification.read_at = datetime.now(timezone.utc)
        await db.commit()


async def mark_all_read(db: AsyncSession, user_sub: str) -> NotificationsReadAllOut:
    result = await db.execute(
        update(UserNotification)
        .where(UserNotification.user_sub == user_sub, UserNotification.read_at.is_(None))
        .values(read_at=datetime.now(timezone.utc))
    )
    await db.commit()
    return NotificationsReadAllOut(marked_read=result.rowcount or 0)
