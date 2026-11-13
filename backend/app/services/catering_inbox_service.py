"""Catering quote requests — restaurant side (owner / assigned manager / admin).

Scoping (server-side on every call, never the JWT alone):
- owner: locations under brands they own (brand not soft-deleted);
- manager: locations with an ACTIVE `location_manager` row (queried each time);
- admin: every location.
A recipient row outside the caller's scope is a plain 404 (never a 403), so ids
cannot be probed across tenants.

PRIVACY RULE (docs/DECISIONS.md "Catering quote requests"): before a
restaurant answers it sees the requester's FIRST NAME plus the event details
(date, headcount, delivery/pickup + city/ZIP, items, notes). The requester's
email and phone are revealed to a restaurant ONLY after that restaurant has
submitted a quote (status `quoted`) — never for a pending or declined
recipient, and never to another restaurant that got the same request.

Responding: one response per recipient row, editable (quote <-> decline,
amount/note changes) until the request expires or is cancelled. A quote
creates an in-app `catering_quote` notification for the requester (no email —
SES is deferred).
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import AppError
from app.dependencies.pagination import Pagination
from app.models.catering import (
    REQUEST_OPEN,
    RECIPIENT_DECLINED,
    RECIPIENT_PENDING,
    RECIPIENT_QUOTED,
    CateringRequest,
    CateringRequestItem,
    CateringRequestRecipient,
)
from app.models.location_manager import LocationManager
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.models.user_notification import UserNotification
from app.schemas.catering import (
    MAX_QUOTE_DOLLARS,
    CateringItemOut,
    CateringResponseIn,
    CateringSettingsOut,
    InboxDetailOut,
    InboxList,
    InboxRowOut,
)
from app.services import audit_service, auth_service
from app.services.catering_service import expire_due_requests, restaurant_name
from app.services.subscription_service import is_location_subscribed

KIND_CATERING_QUOTE = "catering_quote"


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def first_name(full_name: str | None) -> str | None:
    parts = (full_name or "").split()
    return parts[0][:60] if parts else None


async def _scope_conditions(db: AsyncSession, current_user) -> list:
    """Conditions over (CateringRequestRecipient, RestaurantLocation,
    RestaurantBrand) limiting rows to the caller's locations."""
    if current_user.role == "admin":
        return []
    brand_live = RestaurantBrand.deleted_at.is_(None)
    if current_user.role == "owner":
        owner = await auth_service.get_owner_account_by_sub(db, current_user.cognito_sub)
        owner_id = owner.id if owner is not None else -1
        return [RestaurantBrand.owner_id == owner_id, brand_live]
    if current_user.role == "manager":
        assigned = select(LocationManager.location_id).where(
            LocationManager.user_id == current_user.cognito_sub,
            LocationManager.is_active == True,  # noqa: E712
        )
        return [RestaurantLocation.id.in_(assigned), brand_live]
    raise AppError(403, "Not authorized", "forbidden")


def _joined(stmt):
    return (
        stmt.join(CateringRequest, CateringRequest.id == CateringRequestRecipient.request_id)
        .join(RestaurantLocation, RestaurantLocation.id == CateringRequestRecipient.location_id)
        .join(RestaurantBrand, RestaurantBrand.id == RestaurantLocation.brand_id)
    )


def _can_respond(request: CateringRequest, now: datetime) -> bool:
    return request.status == REQUEST_OPEN and _aware(request.expires_at) > now


async def list_inbox(
    db: AsyncSession,
    current_user,
    pagination: Pagination,
    *,
    location_id: int | None,
) -> InboxList:
    await expire_due_requests(db)
    conds = await _scope_conditions(db, current_user)
    if location_id is not None:
        conds.append(CateringRequestRecipient.location_id == location_id)

    total = (
        await db.execute(
            _joined(select(func.count()).select_from(CateringRequestRecipient)).where(*conds)
        )
    ).scalar_one()
    unread = (
        await db.execute(
            _joined(select(func.count()).select_from(CateringRequestRecipient)).where(
                *conds,
                CateringRequestRecipient.viewed_at.is_(None),
                CateringRequestRecipient.status == RECIPIENT_PENDING,
                CateringRequest.status == REQUEST_OPEN,
            )
        )
    ).scalar_one()
    rows = (
        await db.execute(
            _joined(
                select(
                    CateringRequestRecipient,
                    CateringRequest,
                    RestaurantLocation,
                    RestaurantBrand,
                    select(func.count())
                    .select_from(CateringRequestItem)
                    .where(CateringRequestItem.request_id == CateringRequest.id)
                    .correlate(CateringRequest)
                    .scalar_subquery(),
                ).select_from(CateringRequestRecipient)
            )
            .where(*conds)
            .order_by(CateringRequest.created_at.desc(), CateringRequestRecipient.id.desc())
            .offset(pagination.offset)
            .limit(pagination.page_size)
        )
    ).all()
    return InboxList(
        results=[
            InboxRowOut(
                recipient_id=rec.id,
                request_id=req.id,
                location_id=loc.id,
                restaurant_name=restaurant_name(loc, brand),
                city=loc.city,
                requester_first_name=first_name(req.requester_name),
                event_date=req.event_date,
                headcount=req.headcount,
                delivery_or_pickup=req.delivery_or_pickup,  # type: ignore[arg-type]
                item_count=item_count,
                request_status=req.status,  # type: ignore[arg-type]
                status=rec.status,  # type: ignore[arg-type]
                quote_amount_cents=rec.quote_amount_cents,
                is_unread=rec.viewed_at is None
                and rec.status == RECIPIENT_PENDING
                and req.status == REQUEST_OPEN,
                created_at=req.created_at,
                expires_at=req.expires_at,
            )
            for rec, req, loc, brand, item_count in rows
        ],
        page=pagination.page,
        page_size=pagination.page_size,
        total=total,
        unread_count=unread,
    )


async def _load_in_scope(
    db: AsyncSession, current_user, recipient_id: int
) -> tuple[CateringRequestRecipient, CateringRequest, RestaurantLocation, RestaurantBrand]:
    conds = await _scope_conditions(db, current_user)
    row = (
        await db.execute(
            _joined(
                select(CateringRequestRecipient, CateringRequest, RestaurantLocation, RestaurantBrand)
                .select_from(CateringRequestRecipient)
                .options(selectinload(CateringRequest.items))
            ).where(CateringRequestRecipient.id == recipient_id, *conds)
        )
    ).first()
    if row is None:
        raise AppError(404, "Request not found", "not_found")
    return row[0], row[1], row[2], row[3]


def _detail(
    rec: CateringRequestRecipient,
    req: CateringRequest,
    loc: RestaurantLocation,
    brand: RestaurantBrand,
) -> InboxDetailOut:
    revealed = rec.status == RECIPIENT_QUOTED
    return InboxDetailOut(
        recipient_id=rec.id,
        request_id=req.id,
        location_id=loc.id,
        restaurant_name=restaurant_name(loc, brand),
        city=loc.city,
        requester_first_name=first_name(req.requester_name),
        requester_email=req.requester_email if revealed else None,
        requester_phone=req.requester_phone if revealed else None,
        event_date=req.event_date,
        headcount=req.headcount,
        delivery_or_pickup=req.delivery_or_pickup,  # type: ignore[arg-type]
        delivery_city=req.delivery_city,
        delivery_zip=req.delivery_zip,
        notes=req.notes,
        items=[
            CateringItemOut(
                item_name=i.item_name, size=i.size, quantity=i.quantity, note=i.note  # type: ignore[arg-type]
            )
            for i in req.items
        ],
        request_status=req.status,  # type: ignore[arg-type]
        status=rec.status,  # type: ignore[arg-type]
        quote_amount_cents=rec.quote_amount_cents,
        quote_note=rec.quote_note,
        quoted_at=rec.quoted_at,
        created_at=req.created_at,
        expires_at=req.expires_at,
        can_respond=_can_respond(req, datetime.now(timezone.utc)),
    )


async def get_inbox_detail(db: AsyncSession, current_user, recipient_id: int) -> InboxDetailOut:
    """Opening a request marks it viewed (owner/manager only — an admin
    looking in for support must not clear the restaurant's unread badge)."""
    await expire_due_requests(db)
    rec, req, loc, brand = await _load_in_scope(db, current_user, recipient_id)
    if rec.viewed_at is None and current_user.role != "admin":
        rec.viewed_at = datetime.now(timezone.utc)
        await db.commit()
    return _detail(rec, req, loc, brand)


def _amount_to_cents(amount: Decimal | None) -> int:
    invalid = AppError(422, "Enter a quote amount greater than 0 and up to $1,000,000", "invalid_amount")
    if amount is None or not amount.is_finite():
        raise invalid
    if amount <= 0 or amount > MAX_QUOTE_DOLLARS:
        raise invalid
    cents = amount * 100
    if cents != cents.to_integral_value():
        raise AppError(422, "Enter the amount in dollars and cents", "invalid_amount")
    return int(cents)


def _format_dollars(cents: int) -> str:
    return f"${cents / 100:,.2f}"


async def respond(
    db: AsyncSession, current_user, recipient_id: int, body: CateringResponseIn
) -> InboxDetailOut:
    await expire_due_requests(db)
    rec, req, loc, brand = await _load_in_scope(db, current_user, recipient_id)
    now = datetime.now(timezone.utc)
    if not _can_respond(req, now):
        raise AppError(409, "This request is no longer open", "request_not_open")

    cents = _amount_to_cents(body.amount) if body.decision == "quote" else None
    old_val = {
        "status": rec.status,
        "quote_amount_cents": rec.quote_amount_cents,
    }
    rec.quote_note = body.note
    if body.decision == "quote":
        rec.status = RECIPIENT_QUOTED
        rec.quote_amount_cents = cents
        rec.quoted_at = now
    else:
        rec.status = RECIPIENT_DECLINED
        rec.quote_amount_cents = None
        rec.quoted_at = None
    rec.quoted_by_user_sub = current_user.cognito_sub
    if rec.viewed_at is None:
        rec.viewed_at = now

    await audit_service.log(
        db,
        table_name="catering_request_recipient",
        record_id=rec.id,
        action="update",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=old_val,
        new_val={"status": rec.status, "quote_amount_cents": rec.quote_amount_cents},
    )
    if body.decision == "quote" and cents is not None:
        name = restaurant_name(loc, brand)
        db.add(
            UserNotification(
                user_sub=req.requester_user_sub,
                kind=KIND_CATERING_QUOTE,
                location_id=loc.id,
                deal_id=None,
                title=f"Catering quote from {name}: {_format_dollars(cents)}"[:255],
            )
        )
    await db.commit()
    return _detail(rec, req, loc, brand)


async def get_settings(db: AsyncSession, location_id: int) -> CateringSettingsOut:
    location = await db.get(RestaurantLocation, location_id)
    if location is None:
        raise AppError(404, "Location not found", "not_found")
    return _settings_out(location)


def _settings_out(location: RestaurantLocation) -> CateringSettingsOut:
    return CateringSettingsOut(
        location_id=location.id,
        accepts_catering=bool(location.accepts_catering),
        subscribed=is_location_subscribed(location),
        paid_until=location.paid_until,
    )


async def set_settings(
    db: AsyncSession, location_id: int, accepts_catering: bool, current_user
) -> CateringSettingsOut:
    """Idempotent; a real change is audited on `restaurant_location`."""
    location = await db.get(RestaurantLocation, location_id)
    if location is None:
        raise AppError(404, "Location not found", "not_found")
    old = bool(location.accepts_catering)
    if old != accepts_catering:
        location.accepts_catering = accepts_catering
        await db.flush()
        await audit_service.log(
            db,
            table_name="restaurant_location",
            record_id=location.id,
            action="update",
            actor_id=current_user.cognito_sub,
            actor_role=current_user.role,
            old_val={"accepts_catering": old},
            new_val={"accepts_catering": accepts_catering},
        )
        await db.commit()
    return _settings_out(location)
