"""Contact admin — business logic for `POST /contact-admin` and the admin
inbox (`GET /admin/messages`, `PATCH /admin/messages/{id}`). See
docs/API_CONTRACTS.md "Contact admin".

Rules enforced here (server-side, never trusting the client or the JWT
alone):
- Only owners and managers send (router dependency); the sender's email,
  role and `sub` come from the verified token, the display name from the
  local profile (`owner_account.full_name` / `user_profile.full_name`).
- Rate limit: at most `MAX_MESSAGES_PER_HOUR` per sender in a rolling hour,
  counted from `admin_message` itself (no extra store). Beyond that -> 429.
- `related_location_id` is optional. An owner may only attach a location
  under one of their own brands; a manager only a location they are
  actively assigned to (`location_manager` queried — never the JWT). Any
  failure (nonexistent, someone else's, unassigned) is the SAME generic
  400 so the endpoint cannot be used to probe which location ids exist.

NOT built (flagged in the PR): email/SES notification to admins — SES is
deferred (root CLAUDE.md); admins find messages in the inbox and the
overview "open messages" count.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import AppError
from app.dependencies.pagination import Pagination
from app.models.admin_message import AdminMessage
from app.models.location_manager import LocationManager
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.schemas.admin_message import (
    AdminMessageListResponse,
    AdminMessageOut,
    ContactAdminCreate,
)
from app.services import audit_service, auth_service

MAX_MESSAGES_PER_HOUR = 5
RATE_WINDOW = timedelta(hours=1)

_INVALID_LOCATION = AppError(400, "Invalid location", "invalid_location")


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def _sender_name(db: AsyncSession, current_user) -> str | None:
    if current_user.role == "owner":
        owner = await auth_service.get_owner_account_by_sub(db, current_user.cognito_sub)
        return owner.full_name if owner is not None else None
    profile = await auth_service.get_user_profile_by_sub(db, current_user.cognito_sub)
    return profile.full_name if profile is not None else None


async def _assert_location_attachable(
    db: AsyncSession, current_user, location_id: int
) -> None:
    if current_user.role == "owner":
        stmt = (
            select(RestaurantLocation.id)
            .join(RestaurantBrand, RestaurantBrand.id == RestaurantLocation.brand_id)
            .where(
                RestaurantLocation.id == location_id,
                RestaurantBrand.owner_id == current_user.owner_account_id,
            )
        )
    else:
        stmt = select(LocationManager.id).where(
            LocationManager.location_id == location_id,
            LocationManager.user_id == current_user.cognito_sub,
            LocationManager.is_active == True,  # noqa: E712
        )
    if (await db.execute(stmt)).first() is None:
        raise _INVALID_LOCATION


async def create_message(db: AsyncSession, current_user, body: ContactAdminCreate) -> AdminMessage:
    if not current_user.email:
        # The inbox needs a reply-to address; without an email claim there
        # is nothing an admin could act on.
        raise AppError(400, "Your account has no email address on file", "email_required")

    now = datetime.now(timezone.utc)
    recent = (
        await db.execute(
            select(func.count())
            .select_from(AdminMessage)
            .where(
                AdminMessage.sender_cognito_sub == current_user.cognito_sub,
                AdminMessage.created_at >= now - RATE_WINDOW,
            )
        )
    ).scalar_one()
    if recent >= MAX_MESSAGES_PER_HOUR:
        raise AppError(
            429,
            "You've sent several messages recently. Please wait a while before sending another.",
            "rate_limited",
        )

    if body.related_location_id is not None:
        await _assert_location_attachable(db, current_user, body.related_location_id)

    message = AdminMessage(
        sender_cognito_sub=current_user.cognito_sub,
        sender_role=current_user.role,
        sender_email=current_user.email,
        sender_name=await _sender_name(db, current_user),
        subject=body.subject,
        body=body.body,
        related_location_id=body.related_location_id,
        status="open",
        created_at=now,
    )
    db.add(message)
    await db.commit()
    return message


def _location_label(location: RestaurantLocation) -> str:
    name = location.brand.name
    if location.location_name:
        name = f"{name} — {location.location_name}"
    return f"{name}, {location.address_line1}, {location.city}, {location.state}"


def to_message_out(message: AdminMessage) -> AdminMessageOut:
    location = message.location
    return AdminMessageOut(
        message_id=message.id,
        sender_role=message.sender_role,
        sender_email=message.sender_email,
        sender_name=message.sender_name,
        subject=message.subject,
        body=message.body,
        related_location_id=message.related_location_id,
        related_location_label=_location_label(location) if location is not None else None,
        related_location_brand_slug=location.brand.slug if location is not None else None,
        related_location_slug=location.slug if location is not None else None,
        status=message.status,
        created_at=message.created_at,
        resolved_at=message.resolved_at,
        resolved_by=message.resolved_by,
    )


_LOAD_OPTIONS = (selectinload(AdminMessage.location).selectinload(RestaurantLocation.brand),)


async def count_open(db: AsyncSession) -> int:
    return (
        await db.execute(
            select(func.count()).select_from(AdminMessage).where(AdminMessage.status == "open")
        )
    ).scalar_one()


async def list_messages(
    db: AsyncSession,
    pagination: Pagination,
    status: str | None,
    q: str | None,
) -> AdminMessageListResponse:
    conditions = []
    if status is not None:
        conditions.append(AdminMessage.status == status)
    if q:
        pattern = f"%{_escape_like(q.strip().lower())}%"
        conditions.append(
            or_(
                func.lower(AdminMessage.subject).like(pattern, escape="\\"),
                func.lower(AdminMessage.body).like(pattern, escape="\\"),
                func.lower(AdminMessage.sender_email).like(pattern, escape="\\"),
                func.lower(func.coalesce(AdminMessage.sender_name, "")).like(
                    pattern, escape="\\"
                ),
            )
        )

    total = (
        await db.execute(select(func.count()).select_from(AdminMessage).where(*conditions))
    ).scalar_one()

    # Open queue reads oldest-first (work the backlog in order); resolved /
    # "all" read newest-first — same convention as /reports.
    if status == "open":
        order = (AdminMessage.created_at.asc(), AdminMessage.id.asc())
    else:
        order = (AdminMessage.created_at.desc(), AdminMessage.id.desc())

    rows = (
        (
            await db.execute(
                select(AdminMessage)
                .options(*_LOAD_OPTIONS)
                .where(*conditions)
                .order_by(*order)
                .offset(pagination.offset)
                .limit(pagination.page_size)
            )
        )
        .scalars()
        .all()
    )
    return AdminMessageListResponse(
        results=[to_message_out(m) for m in rows],
        page=pagination.page,
        page_size=pagination.page_size,
        total=total,
        open_count=await count_open(db),
    )


async def update_message_status(
    db: AsyncSession, message_id: int, admin_sub: str, status: str
) -> AdminMessage:
    message = (
        await db.execute(
            select(AdminMessage).options(*_LOAD_OPTIONS).where(AdminMessage.id == message_id)
        )
    ).scalar_one_or_none()
    if message is None:
        raise AppError(404, "Message not found", "not_found")

    old_status = message.status
    message.status = status
    if status == "resolved":
        message.resolved_at = datetime.now(timezone.utc)
        message.resolved_by = admin_sub
    else:
        message.resolved_at = None
        message.resolved_by = None

    if old_status != status:
        await audit_service.log(
            db,
            table_name="admin_message",
            record_id=message.id,
            action="update",
            actor_id=admin_sub,
            actor_role="admin",
            old_val={"status": old_status},
            new_val={"status": status},
        )
    await db.commit()
    return message
