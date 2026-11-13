"""Who counts as "subscribed" — the ONE place that answers it.

A location is subscribed when `is_paid` is true AND `paid_until` is NULL
(open-ended: an admin free offer / the manual flag with no end date) or in the
future. Everything that gates a feature on "subscribed" (today: catering
quote requests) goes through `is_location_subscribed` /
`subscribed_clause`, so when the Stripe integration lands (it sets
`is_paid` + `paid_until` from webhooks, root CLAUDE.md "Tier model") this
stays the single definition and nothing else changes.

Until a payment processor exists the flag is set BY HAND by an admin
(`set_manual_subscription`, `PUT /admin/locations/{id}/subscription`): no
payment is taken, the audit row says `note: "manual"`. This does NOT turn
tier gating back on for the free features (menu, deals stay free).
"""
from __future__ import annotations

from datetime import date, datetime, time, timezone

from sqlalchemy import and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.restaurant_location import RestaurantLocation
from app.schemas.catering import SubscriptionOut
from app.services import audit_service


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def is_location_subscribed(location: RestaurantLocation, now: datetime | None = None) -> bool:
    """`is_paid` AND (`paid_until` is NULL OR in the future)."""
    if not location.is_paid:
        return False
    if location.paid_until is None:
        return True
    return _aware(location.paid_until) > (now or datetime.now(timezone.utc))


def subscribed_clause(now: datetime | None = None):
    """SQL twin of `is_location_subscribed` for list queries."""
    now = now or datetime.now(timezone.utc)
    return and_(
        RestaurantLocation.is_paid.is_(True),
        or_(RestaurantLocation.paid_until.is_(None), RestaurantLocation.paid_until > now),
    )


def _end_of_day(day: date) -> datetime:
    """`paid_until` as an end-of-day UTC instant, so "until Dec 31" includes Dec 31."""
    return datetime.combine(day, time(23, 59, 59), tzinfo=timezone.utc)


async def set_manual_subscription(
    db: AsyncSession,
    location_id: int,
    *,
    is_paid: bool,
    paid_until: date | None,
    actor_sub: str,
) -> SubscriptionOut:
    """Admin-only manual paid flag. `is_paid=false` always clears `paid_until`.
    `paid_until` (when given with `is_paid=true`) must be in the future.
    Audited on `restaurant_location` with old/new values and `note: manual`."""
    location = await db.get(RestaurantLocation, location_id)
    if location is None:
        raise AppError(404, "Location not found", "not_found")

    new_until: datetime | None = None
    if is_paid and paid_until is not None:
        new_until = _end_of_day(paid_until)
        if new_until <= datetime.now(timezone.utc):
            raise AppError(422, "The end date must be in the future", "validation_error")

    old_until = location.paid_until
    old_val = {
        "is_paid": bool(location.is_paid),
        "paid_until": _aware(old_until).isoformat() if old_until else None,
    }
    location.is_paid = is_paid
    location.paid_until = new_until
    await db.flush()
    await audit_service.log(
        db,
        table_name="restaurant_location",
        record_id=location.id,
        action="update",
        actor_id=actor_sub,
        actor_role="admin",
        old_val=old_val,
        new_val={
            "is_paid": is_paid,
            "paid_until": new_until.isoformat() if new_until else None,
            "note": "manual",
        },
    )
    await db.commit()
    return SubscriptionOut(
        location_id=location.id,
        is_paid=location.is_paid,
        paid_until=location.paid_until,
        subscribed=is_location_subscribed(location),
    )
