"""Catering quote requests. See docs/API_CONTRACTS.md "Catering quote requests".

Requester (registered_user only): `/catering/config`, `/catering/restaurants`,
`/catering/eligibility/{id}` (public), `/catering/requests` (+ cancel).
Restaurant side (owner / assigned manager / admin): `/catering/inbox`,
`/catering/inbox/{recipient_id}` (+ `/response`), and the per-location
opt-in `/locations/{id}/catering-settings`.
Admin: `GET /admin/catering`, `PUT /admin/locations/{id}/subscription`.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.dependencies.auth import (
    CurrentUser,
    get_current_user,
    require_admin,
    require_location_write_access,
    require_registered_user,
)
from app.dependencies.db import get_db
from app.dependencies.pagination import Pagination, pagination_params
from app.schemas.catering import (
    SEARCH_MAX,
    AdminCateringList,
    CateringConfigOut,
    CateringRequestCreate,
    CateringRequestList,
    CateringRequestOut,
    CateringResponseIn,
    CateringSettingsIn,
    CateringSettingsOut,
    EligibilityOut,
    EligibleRestaurantList,
    InboxDetailOut,
    InboxList,
    RequestStatus,
    SubscriptionIn,
    SubscriptionOut,
)
from app.services import (
    admin_catering_service,
    catering_inbox_service,
    catering_service,
    subscription_service,
)

router = APIRouter(tags=["catering"])


async def require_catering_staff(
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """owner / manager / admin. Row-level scoping (which locations) is done
    in `catering_inbox_service` against the DB on every call."""
    if current_user.role not in ("owner", "manager", "admin"):
        raise AppError(403, "Not authorized", "forbidden")
    return current_user


# --- requester ------------------------------------------------------------
@router.get("/catering/config", response_model=CateringConfigOut)
async def catering_config(
    db: AsyncSession = Depends(get_db),
    _user: CurrentUser = Depends(require_registered_user),
) -> CateringConfigOut:
    """Auth: registered_user. `max_restaurants` per request (configurable)."""
    return await catering_service.get_config(db)


@router.get("/catering/restaurants", response_model=EligibleRestaurantList)
async def catering_restaurants(
    city: str | None = Query(default=None, max_length=SEARCH_MAX),
    q: str | None = Query(default=None, max_length=SEARCH_MAX),
    pagination: Pagination = Depends(pagination_params),
    db: AsyncSession = Depends(get_db),
    _user: CurrentUser = Depends(require_registered_user),
) -> EligibleRestaurantList:
    """Auth: registered_user. ONLY subscribed + opted-in public locations."""
    return await catering_service.list_eligible_restaurants(db, pagination, city=city, q=q)


@router.get("/catering/eligibility/{location_id}", response_model=EligibilityOut)
async def catering_eligibility(
    location_id: int,
    db: AsyncSession = Depends(get_db),
) -> EligibilityOut:
    """PUBLIC (no auth) — a single boolean, nothing else. Drives the 'Get
    catering quotes' link / sign-in prompt on a location page;
    `eligible=false` for anything not selectable (unknown, hidden, free,
    lapsed, not opted in — indistinguishable)."""
    return await catering_service.check_eligibility(db, location_id)


@router.post("/catering/requests", response_model=CateringRequestOut, status_code=status.HTTP_201_CREATED)
async def create_catering_request(
    body: CateringRequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_registered_user),
) -> CateringRequestOut:
    """Auth: registered_user only (owner/manager/admin get 403). 5/day."""
    return await catering_service.create_request(db, current_user, body)


@router.get("/catering/requests", response_model=CateringRequestList)
async def list_my_catering_requests(
    pagination: Pagination = Depends(pagination_params),
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_registered_user),
) -> CateringRequestList:
    """Auth: registered_user. Own requests only, newest first."""
    return await catering_service.list_my_requests(db, current_user.cognito_sub, pagination)


@router.get("/catering/requests/{request_id}", response_model=CateringRequestOut)
async def get_my_catering_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_registered_user),
) -> CateringRequestOut:
    return await catering_service.get_my_request(db, current_user.cognito_sub, request_id)


@router.post("/catering/requests/{request_id}/cancel", response_model=CateringRequestOut)
async def cancel_my_catering_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_registered_user),
) -> CateringRequestOut:
    """Auth: registered_user, own request. Idempotent on an already-cancelled one."""
    return await catering_service.cancel_my_request(db, current_user, request_id)


# --- restaurant side -------------------------------------------------------
@router.get("/catering/inbox", response_model=InboxList)
async def catering_inbox(
    location_id: int | None = Query(default=None, ge=1),
    pagination: Pagination = Depends(pagination_params),
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_catering_staff),
) -> InboxList:
    """Auth: owner / manager / admin. Only requests addressed to the caller's own locations."""
    return await catering_inbox_service.list_inbox(
        db, current_user, pagination, location_id=location_id
    )


@router.get("/catering/inbox/{recipient_id}", response_model=InboxDetailOut)
async def catering_inbox_detail(
    recipient_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_catering_staff),
) -> InboxDetailOut:
    """Marks the request viewed (owner/manager). Requester email/phone only after a quote."""
    return await catering_inbox_service.get_inbox_detail(db, current_user, recipient_id)


@router.put("/catering/inbox/{recipient_id}/response", response_model=InboxDetailOut)
async def catering_inbox_respond(
    recipient_id: int,
    body: CateringResponseIn,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_catering_staff),
) -> InboxDetailOut:
    """Submit (or edit) a quote, or decline, until the request expires."""
    return await catering_inbox_service.respond(db, current_user, recipient_id, body)


@router.get("/locations/{location_id}/catering-settings", response_model=CateringSettingsOut)
async def get_catering_settings(
    location_id: int,
    db: AsyncSession = Depends(get_db),
    _user: CurrentUser = Depends(require_location_write_access),
) -> CateringSettingsOut:
    return await catering_inbox_service.get_settings(db, location_id)


@router.put("/locations/{location_id}/catering-settings", response_model=CateringSettingsOut)
async def set_catering_settings(
    location_id: int,
    body: CateringSettingsIn,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_location_write_access),
) -> CateringSettingsOut:
    """Owner / assigned manager / admin: opt a location in/out of catering requests."""
    return await catering_inbox_service.set_settings(
        db, location_id, body.accepts_catering, current_user
    )


# --- admin -----------------------------------------------------------------
@router.get("/admin/catering", response_model=AdminCateringList)
async def admin_catering(
    q: str | None = Query(default=None, max_length=SEARCH_MAX),
    status_filter: RequestStatus | None = Query(default=None, alias="status"),
    pagination: Pagination = Depends(pagination_params),
    db: AsyncSession = Depends(get_db),
    _admin: CurrentUser = Depends(require_admin),
) -> AdminCateringList:
    """Auth: admin. Read-only; `q` searches requester email / name."""
    return await admin_catering_service.list_requests(db, pagination, q=q, status=status_filter)


@router.put("/admin/locations/{location_id}/subscription", response_model=SubscriptionOut)
async def set_manual_subscription(
    location_id: int,
    body: SubscriptionIn,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_admin),
) -> SubscriptionOut:
    """Auth: admin only. MANUAL paid flag (no payment taken) used as
    'subscribed' until a payment processor exists. Audited with note 'manual'."""
    return await subscription_service.set_manual_subscription(
        db,
        location_id,
        is_paid=body.is_paid,
        paid_until=body.paid_until,
        actor_sub=current_user.cognito_sub,
    )
