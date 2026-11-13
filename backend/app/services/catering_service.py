"""Catering quote requests — requester side (registered_user).

Rules enforced here, server-side:
- ELIGIBLE restaurants (list + submit): location `status == 'active'`, brand
  not soft-deleted, `accepts_catering` opted in, and SUBSCRIBED
  (`subscription_service.is_location_subscribed` — manual admin flag until a
  payment processor exists). `eligible_conditions` is the single definition.
- Submit: 1..N distinct eligible locations, N = `platform_config`
  `catering_max_restaurants` (default 5, clamped to 1..20). ANY ineligible
  choice rejects the whole request with the same generic 422 — it never says
  which restaurant failed or why (no probing of subscription/opt-in state).
- Rate limit: at most `MAX_REQUESTS_PER_DAY` per requester per rolling 24h.
- Requests expire after `REQUEST_TTL` — lazily, on read
  (`expire_due_requests`), no cron.
- A requester only ever reads/cancels their own requests (another user's id is
  a 404, never a 403).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import AppError
from app.dependencies.pagination import Pagination
from app.models.catering import (
    REQUEST_CANCELLED,
    REQUEST_CLOSED,
    REQUEST_OPEN,
    RECIPIENT_EXPIRED,
    RECIPIENT_PENDING,
    CateringRequest,
    CateringRequestItem,
    CateringRequestRecipient,
)
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.schemas.catering import (
    CateringConfigOut,
    CateringItemOut,
    CateringRequestCreate,
    CateringRequestList,
    CateringRequestOut,
    EligibilityOut,
    EligibleRestaurantList,
    EligibleRestaurantOut,
    RequesterRecipientOut,
)
from app.services import audit_service, auth_service, platform_config_service
from app.services.subscription_service import subscribed_clause

MAX_RESTAURANTS_KEY = "catering_max_restaurants"
DEFAULT_MAX_RESTAURANTS = 5
HARD_MAX_RESTAURANTS = 20  # a bad config value can never exceed this

MAX_REQUESTS_PER_DAY = 5
RATE_WINDOW = timedelta(days=1)
REQUEST_TTL = timedelta(days=14)
# How far ahead an event may be (a sanity bound, not a business rule).
MAX_EVENT_DAYS_AHEAD = 730

_UNAVAILABLE = AppError(
    422, "One or more restaurants are not available", "restaurants_unavailable"
)


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def restaurant_name(location: RestaurantLocation, brand: RestaurantBrand) -> str:
    return location.location_name or brand.name


async def get_max_restaurants(db: AsyncSession) -> int:
    configured = await platform_config_service.get_config_int(
        db, MAX_RESTAURANTS_KEY, DEFAULT_MAX_RESTAURANTS
    )
    return max(1, min(configured, HARD_MAX_RESTAURANTS))


async def get_config(db: AsyncSession) -> CateringConfigOut:
    return CateringConfigOut(max_restaurants=await get_max_restaurants(db))


def eligible_conditions(now: datetime | None = None) -> list:
    """WHERE conditions (over RestaurantLocation joined to RestaurantBrand)
    for a location a requester may send a catering request to."""
    return [
        RestaurantLocation.status == RestaurantLocation.STATUS_ACTIVE,
        RestaurantBrand.deleted_at.is_(None),
        RestaurantLocation.accepts_catering.is_(True),
        subscribed_clause(now),
    ]


async def list_eligible_restaurants(
    db: AsyncSession, pagination: Pagination, *, city: str | None, q: str | None
) -> EligibleRestaurantList:
    conds = eligible_conditions()
    if city and city.strip():
        conds.append(func.lower(RestaurantLocation.city) == city.strip().lower())
    if q and q.strip():
        like = f"%{_escape_like(q.strip().lower())}%"
        conds.append(
            func.lower(RestaurantBrand.name).like(like, escape="\\")
            | func.lower(func.coalesce(RestaurantLocation.location_name, "")).like(like, escape="\\")
        )
    base = (
        select(RestaurantLocation, RestaurantBrand)
        .join(RestaurantBrand, RestaurantBrand.id == RestaurantLocation.brand_id)
        .where(*conds)
    )
    total = (
        await db.execute(
            select(func.count())
            .select_from(RestaurantLocation)
            .join(RestaurantBrand, RestaurantBrand.id == RestaurantLocation.brand_id)
            .where(*conds)
        )
    ).scalar_one()
    rows = (
        await db.execute(
            base.order_by(func.lower(RestaurantBrand.name), RestaurantLocation.id)
            .offset(pagination.offset)
            .limit(pagination.page_size)
        )
    ).all()
    return EligibleRestaurantList(
        results=[
            EligibleRestaurantOut(
                location_id=loc.id,
                restaurant_name=restaurant_name(loc, brand),
                city=loc.city,
                state=loc.state,
                brand_slug=brand.slug,
                location_slug=loc.slug,
            )
            for loc, brand in rows
        ],
        page=pagination.page,
        page_size=pagination.page_size,
        total=total,
        max_restaurants=await get_max_restaurants(db),
    )


async def eligible_location_ids(db: AsyncSession, location_ids: list[int]) -> set[int]:
    rows = (
        await db.execute(
            select(RestaurantLocation.id)
            .join(RestaurantBrand, RestaurantBrand.id == RestaurantLocation.brand_id)
            .where(RestaurantLocation.id.in_(location_ids), *eligible_conditions())
        )
    ).scalars()
    return set(rows)


async def check_eligibility(db: AsyncSession, location_id: int) -> EligibilityOut:
    row = (
        await db.execute(
            select(RestaurantLocation, RestaurantBrand)
            .join(RestaurantBrand, RestaurantBrand.id == RestaurantLocation.brand_id)
            .where(RestaurantLocation.id == location_id, *eligible_conditions())
        )
    ).first()
    if row is None:
        return EligibilityOut(location_id=location_id, eligible=False)
    loc, brand = row
    return EligibilityOut(
        location_id=location_id,
        eligible=True,
        restaurant=EligibleRestaurantOut(
            location_id=loc.id,
            restaurant_name=restaurant_name(loc, brand),
            city=loc.city,
            state=loc.state,
            brand_slug=brand.slug,
            location_slug=loc.slug,
        ),
    )


async def expire_due_requests(db: AsyncSession) -> None:
    """Lazy housekeeping, run at the start of every catering read: open
    requests past `expires_at` become `closed` and their still-pending
    recipients `expired` (quoted/declined rows keep their outcome)."""
    now = datetime.now(timezone.utc)
    due = select(CateringRequest.id).where(
        CateringRequest.status == REQUEST_OPEN, CateringRequest.expires_at <= now
    )
    pending = await db.execute(
        update(CateringRequestRecipient)
        .where(
            CateringRequestRecipient.request_id.in_(due),
            CateringRequestRecipient.status == RECIPIENT_PENDING,
        )
        .values(status=RECIPIENT_EXPIRED)
        .execution_options(synchronize_session=False)
    )
    closed = await db.execute(
        update(CateringRequest)
        .where(CateringRequest.status == REQUEST_OPEN, CateringRequest.expires_at <= now)
        .values(status=REQUEST_CLOSED)
        .execution_options(synchronize_session=False)
    )
    if (pending.rowcount or 0) or (closed.rowcount or 0):
        await db.commit()


async def _labels(
    db: AsyncSession, location_ids: set[int]
) -> dict[int, tuple[RestaurantLocation, RestaurantBrand]]:
    if not location_ids:
        return {}
    rows = (
        await db.execute(
            select(RestaurantLocation, RestaurantBrand)
            .join(RestaurantBrand, RestaurantBrand.id == RestaurantLocation.brand_id)
            .where(RestaurantLocation.id.in_(location_ids))
        )
    ).all()
    return {loc.id: (loc, brand) for loc, brand in rows}


def _to_out(
    request: CateringRequest, labels: dict[int, tuple[RestaurantLocation, RestaurantBrand]]
) -> CateringRequestOut:
    recipients = []
    for r in request.recipients:
        loc, brand = labels[r.location_id]
        recipients.append(
            RequesterRecipientOut(
                location_id=loc.id,
                restaurant_name=restaurant_name(loc, brand),
                city=loc.city,
                brand_slug=brand.slug,
                location_slug=loc.slug,
                status=r.status,  # type: ignore[arg-type]
                quote_amount_cents=r.quote_amount_cents,
                quote_note=r.quote_note,
                quoted_at=r.quoted_at,
            )
        )
    return CateringRequestOut(
        id=request.id,
        event_date=request.event_date,
        headcount=request.headcount,
        delivery_or_pickup=request.delivery_or_pickup,  # type: ignore[arg-type]
        delivery_city=request.delivery_city,
        delivery_zip=request.delivery_zip,
        requester_phone=request.requester_phone,
        notes=request.notes,
        status=request.status,  # type: ignore[arg-type]
        created_at=request.created_at,
        expires_at=request.expires_at,
        items=[
            CateringItemOut(
                item_name=i.item_name, size=i.size, quantity=i.quantity, note=i.note  # type: ignore[arg-type]
            )
            for i in request.items
        ],
        recipients=recipients,
    )


async def _outs(db: AsyncSession, requests: list[CateringRequest]) -> list[CateringRequestOut]:
    ids = {r.location_id for req in requests for r in req.recipients}
    labels = await _labels(db, ids)
    return [_to_out(req, labels) for req in requests]


async def create_request(
    db: AsyncSession, current_user, body: CateringRequestCreate
) -> CateringRequestOut:
    if not current_user.email:
        # Restaurants answer through the platform, but the requester's contact
        # address is revealed to a quoting restaurant, so one must exist.
        raise AppError(400, "Your account has no email address on file", "email_required")

    now = datetime.now(timezone.utc)
    recent = (
        await db.execute(
            select(func.count())
            .select_from(CateringRequest)
            .where(
                CateringRequest.requester_user_sub == current_user.cognito_sub,
                CateringRequest.created_at >= now - RATE_WINDOW,
            )
        )
    ).scalar_one()
    if recent >= MAX_REQUESTS_PER_DAY:
        raise AppError(
            429,
            "You've sent several catering requests recently. Please try again later.",
            "rate_limited",
        )

    today = now.date()
    if body.event_date < today - timedelta(days=1) or body.event_date > today + timedelta(
        days=MAX_EVENT_DAYS_AHEAD
    ):
        raise AppError(422, "Please choose a valid event date", "validation_error")

    max_restaurants = await get_max_restaurants(db)
    if len(set(body.location_ids)) != len(body.location_ids):
        raise AppError(422, "Each restaurant can only be chosen once", "duplicate_restaurants")
    if len(body.location_ids) > max_restaurants:
        raise AppError(
            422,
            f"You can choose up to {max_restaurants} restaurants",
            "too_many_restaurants",
        )
    if await eligible_location_ids(db, body.location_ids) != set(body.location_ids):
        raise _UNAVAILABLE

    profile = await auth_service.get_user_profile_by_sub(db, current_user.cognito_sub)
    request = CateringRequest(
        requester_user_sub=current_user.cognito_sub,
        requester_name=profile.full_name if profile is not None else None,
        requester_email=current_user.email,
        requester_phone=body.requester_phone,
        event_date=body.event_date,
        headcount=body.headcount,
        delivery_or_pickup=body.delivery_or_pickup,
        delivery_city=body.delivery_city,
        delivery_zip=body.delivery_zip,
        notes=body.notes,
        status=REQUEST_OPEN,
        created_at=now,
        expires_at=now + REQUEST_TTL,
        items=[
            CateringRequestItem(
                item_name=i.item_name, size=i.size, quantity=i.quantity, note=i.note
            )
            for i in body.items
        ],
        recipients=[
            CateringRequestRecipient(location_id=lid, status=RECIPIENT_PENDING, created_at=now)
            for lid in body.location_ids
        ],
    )
    db.add(request)
    await db.flush()
    await audit_service.log(
        db,
        table_name="catering_request",
        record_id=request.id,
        action="create",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        new_val={
            "event_date": body.event_date.isoformat(),
            "headcount": body.headcount,
            "location_ids": list(body.location_ids),
        },
    )
    await db.commit()
    return (await _outs(db, [request]))[0]


async def list_my_requests(
    db: AsyncSession, user_sub: str, pagination: Pagination
) -> CateringRequestList:
    await expire_due_requests(db)
    total = (
        await db.execute(
            select(func.count())
            .select_from(CateringRequest)
            .where(CateringRequest.requester_user_sub == user_sub)
        )
    ).scalar_one()
    requests = (
        (
            await db.execute(
                select(CateringRequest)
                .where(CateringRequest.requester_user_sub == user_sub)
                .options(selectinload(CateringRequest.items), selectinload(CateringRequest.recipients))
                .order_by(CateringRequest.created_at.desc(), CateringRequest.id.desc())
                .offset(pagination.offset)
                .limit(pagination.page_size)
            )
        )
        .scalars()
        .all()
    )
    return CateringRequestList(
        results=await _outs(db, list(requests)),
        page=pagination.page,
        page_size=pagination.page_size,
        total=total,
    )


async def _own_request_or_404(db: AsyncSession, user_sub: str, request_id: int) -> CateringRequest:
    request = (
        await db.execute(
            select(CateringRequest)
            .where(CateringRequest.id == request_id, CateringRequest.requester_user_sub == user_sub)
            .options(selectinload(CateringRequest.items), selectinload(CateringRequest.recipients))
        )
    ).scalar_one_or_none()
    if request is None:
        raise AppError(404, "Request not found", "not_found")
    return request


async def get_my_request(db: AsyncSession, user_sub: str, request_id: int) -> CateringRequestOut:
    await expire_due_requests(db)
    request = await _own_request_or_404(db, user_sub, request_id)
    return (await _outs(db, [request]))[0]


async def cancel_my_request(
    db: AsyncSession, current_user, request_id: int
) -> CateringRequestOut:
    await expire_due_requests(db)
    request = await _own_request_or_404(db, current_user.cognito_sub, request_id)
    if request.status == REQUEST_CLOSED:
        raise AppError(409, "This request has already expired", "request_not_open")
    if request.status == REQUEST_OPEN:
        request.status = REQUEST_CANCELLED
        for recipient in request.recipients:
            if recipient.status == RECIPIENT_PENDING:
                recipient.status = RECIPIENT_EXPIRED
        await audit_service.log(
            db,
            table_name="catering_request",
            record_id=request.id,
            action="update",
            actor_id=current_user.cognito_sub,
            actor_role=current_user.role,
            old_val={"status": REQUEST_OPEN},
            new_val={"status": REQUEST_CANCELLED},
        )
        await db.commit()
    return (await _outs(db, [request]))[0]
