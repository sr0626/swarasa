"""deal CRUD + the public "today" matching / content-visibility logic.

See docs/API_CONTRACTS.md "Deals (deal)" and app/models/deal.py's module
docstring for the schema design. This module owns three separable things:

1. Owner/manager/admin CRUD (`create_deal`/`list_deals_for_location`/
   `update_deal`/`delete_deal`) — access control itself is enforced
   upstream by the router's `require_location_write_access` dependency
   (same pattern as photos/hours), not re-checked here; this module trusts
   that a `current_user` reaching it is already authorized to write this
   location.
2. `deal_matches_today` — the core "is this deal live right now" predicate,
   used by both the public read paths (search, location detail) and (in
   spirit) the expiry cron, though the cron only needs the `end_at` half of
   this (see app/lambda_handlers/deal_expiry.py).
3. The public content-visibility gate
   (`caller_may_view_deal_content_for_location`) — the FACT of a deal
   (`has_deal_today: bool`) is unconditionally public; the CONTENT
   (title/description) is gated to a signed-in registered_user, admin, or
   the location's own owner/manager. See that function's own docstring for
   the full reasoning, including the explicit deviation from
   docs/DECISIONS.md's older "Deals visible to registered users only (not
   public)" entry — flagged there and in docs/DECISIONS.md's follow-up
   entry for human confirmation, not silently assumed.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.deal import Deal
from app.models.location_manager import LocationManager
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.schemas.deal import DealCreate, DealOut, DealPublicOut, DealUpcomingOut, DealUpdate
from app.services import audit_service, auth_service, hours_service

_AUDITED_FIELDS = (
    "deal_type",
    "title",
    "description",
    "applicable_days",
    "start_at",
    "end_at",
    "is_active",
)

# Fields on DealUpdate that are non-nullable on the model — an explicit
# `null` for one of these is a 400, not a "clear this field" (same posture
# as LocationUpdate.phone; see app/schemas/deal.py DealUpdate docstring).
_NON_NULLABLE_FIELDS = ("deal_type", "title", "is_active")


def _aware(value: datetime) -> datetime:
    """Stored timestamps are timestamptz (aware) in Postgres; SQLite (the
    test DB) hands back naive values. Treat naive as UTC so comparisons
    never raise TypeError."""
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _snapshot(deal: Deal) -> dict:
    """JSON-safe before/after snapshot for audit_log.old_val/new_val."""
    data = {field: getattr(deal, field) for field in _AUDITED_FIELDS}
    if data.get("start_at") is not None:
        data["start_at"] = data["start_at"].isoformat()
    if data.get("end_at") is not None:
        data["end_at"] = data["end_at"].isoformat()
    return data


def _deal_to_out(deal: Deal) -> DealOut:
    return DealOut(
        id=deal.id,
        location_id=deal.location_id,
        deal_type=deal.deal_type,
        title=deal.title,
        description=deal.description,
        applicable_days=deal.applicable_days,
        start_at=deal.start_at,
        end_at=deal.end_at,
        is_active=deal.is_active,
        created_at=deal.created_at,
        updated_at=deal.updated_at,
    )


def _deal_to_public_out(deal: Deal) -> DealPublicOut:
    return DealPublicOut(
        id=deal.id,
        deal_type=deal.deal_type,
        title=deal.title,
        description=deal.description,
    )


async def get_deal_or_404(db: AsyncSession, location_id: int, deal_id: int) -> Deal:
    deal = await db.get(Deal, deal_id)
    if deal is None or deal.location_id != location_id:
        raise AppError(404, "Deal not found", "not_found")
    return deal


# ---------------------------------------------------------------------------
# Owner/manager/admin CRUD (management view — always full content,
# including inactive deals; access already checked upstream by the router).
# ---------------------------------------------------------------------------


async def list_deals_for_location(db: AsyncSession, location_id: int) -> list[DealOut]:
    result = await db.execute(
        select(Deal).where(Deal.location_id == location_id).order_by(Deal.created_at.desc())
    )
    return [_deal_to_out(d) for d in result.scalars().all()]


async def create_deal(
    db: AsyncSession, location_id: int, body: DealCreate, current_user
) -> DealOut:
    location = await db.get(RestaurantLocation, location_id)
    if location is None:
        raise AppError(404, "Location not found", "not_found")

    deal = Deal(
        location_id=location_id,
        deal_type=body.deal_type,
        title=body.title,
        description=body.description,
        applicable_days=body.applicable_days,
        start_at=body.start_at,
        end_at=body.end_at,
        is_active=body.is_active,
    )
    db.add(deal)
    await db.flush()

    await audit_service.log(
        db,
        table_name="deal",
        record_id=deal.id,
        action="create",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=None,
        new_val=_snapshot(deal),
    )
    await db.commit()
    await db.refresh(deal)
    return _deal_to_out(deal)


async def update_deal(
    db: AsyncSession, location_id: int, deal_id: int, body: DealUpdate, current_user
) -> DealOut:
    deal = await get_deal_or_404(db, location_id, deal_id)
    old_val = _snapshot(deal)

    data = body.model_dump(exclude_unset=True)
    # `ongoing` is a request-only flag (see DealUpdate) — never a column.
    # `true` means "explicitly no end date", i.e. clear end_at.
    if data.pop("ongoing", False):
        data["end_at"] = None
    for field in data:
        if data[field] is None and field in _NON_NULLABLE_FIELDS:
            raise AppError(
                400, f"{field} cannot be cleared to null", "bad_request"
            )

    for field in _AUDITED_FIELDS:
        if field in data:
            setattr(deal, field, data[field])

    if (
        deal.start_at is not None
        and deal.end_at is not None
        and _aware(deal.start_at) >= _aware(deal.end_at)
    ):
        raise AppError(400, "start_at must be before end_at", "bad_request")

    await db.flush()
    new_val = _snapshot(deal)

    await audit_service.log(
        db,
        table_name="deal",
        record_id=deal.id,
        action="update",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=old_val,
        new_val=new_val,
    )
    await db.commit()
    await db.refresh(deal)
    return _deal_to_out(deal)


async def delete_deal(db: AsyncSession, location_id: int, deal_id: int, current_user) -> None:
    """Real, hard delete — see app/models/deal.py module docstring ("no
    downstream FK dependents") for why a soft-delete/is_active toggle
    wasn't chosen instead. `is_active=false` already means "hidden,
    deactivated, kept for history" via the CRUD PATCH endpoint; DELETE is
    for actually removing a mistaken/no-longer-wanted row."""
    deal = await get_deal_or_404(db, location_id, deal_id)
    old_val = _snapshot(deal)
    deal_id_val = deal.id

    await db.delete(deal)
    await audit_service.log(
        db,
        table_name="deal",
        record_id=deal_id_val,
        action="delete",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=old_val,
        new_val=None,
    )
    await db.commit()


# ---------------------------------------------------------------------------
# Public "today" matching + content-visibility gating.
# ---------------------------------------------------------------------------


def deal_matches_today(deal: Deal, tz_name: str, *, now: datetime | None = None) -> bool:
    """Does this deal apply RIGHT NOW, in the location's own timezone?

    Deliberately re-checks `start_at`/`end_at` against the current instant
    here, on top of the `is_active` flag — not just `is_active` alone. The
    expiry cron (app/lambda_handlers/deal_expiry.py) only runs every 5
    minutes (docs/DECISIONS.md), so a deal whose `end_at` has just passed
    but hasn't been flipped to `is_active=false` yet must still stop
    matching "today" immediately for a caller hitting search/location-detail
    in that window — eventual consistency in the STORED flag, but exact
    consistency in what's actually displayed.

    `now` defaults to the real current instant (UTC) but can be injected
    for deterministic tests (tests/unit/test_deal_matching.py). Weekday is
    deliberately derived from THIS SAME `now`, converted into the
    location's timezone via `hours_service.safe_zone` — NOT via
    `hours_service.today_weekday(tz_name)`, which independently calls the
    real wall clock and would silently ignore an injected `now`, making
    this function's day-of-week branch untestable/non-deterministic on any
    day that isn't the real day a test happens to run on (a real bug this
    module's own tests caught).
    """
    if not deal.is_active:
        return False
    now = now or datetime.now(timezone.utc)
    if deal.start_at is not None and now < _aware(deal.start_at):
        return False
    if deal.end_at is not None and now >= _aware(deal.end_at):
        return False
    if deal.applicable_days:
        today = now.astimezone(hours_service.safe_zone(tz_name)).weekday()
        if today not in deal.applicable_days:
            return False
    return True


async def get_active_deals_map(
    db: AsyncSession, location_ids: list[int]
) -> dict[int, list[Deal]]:
    """All `is_active=True` deal rows for these locations, grouped by
    location_id — NOT yet filtered to "matches today" (the timezone that
    matters is per-location, so callers apply `deal_matches_today`
    themselves with each location's own tz). Same two-step shape as
    `hours_service.get_hours_map_for_locations` + `compute_today_status`.
    """
    if not location_ids:
        return {}
    result = await db.execute(
        select(Deal).where(Deal.location_id.in_(location_ids), Deal.is_active == True)  # noqa: E712
    )
    by_location: dict[int, list[Deal]] = {lid: [] for lid in location_ids}
    for row in result.scalars().all():
        by_location.setdefault(row.location_id, []).append(row)
    return by_location


async def deals_today_for_location(
    db: AsyncSession, location_id: int, tz_name: str
) -> list[Deal]:
    """Convenience single-location lookup — used by `GET /locations/{id}`,
    which doesn't otherwise need the bulk map (mirrors
    `hours_service.today_status_for_location`'s relationship to
    `get_hours_map_for_locations`)."""
    by_location = await get_active_deals_map(db, [location_id])
    return [d for d in by_location.get(location_id, []) if deal_matches_today(d, tz_name)]


def next_occurrence_date(
    deal: Deal, tz_name: str, *, now: datetime | None = None
) -> date | None:
    """The next calendar date (in the LOCATION's timezone) on which this
    deal is offered, counting today only if some part of today's offering is
    still ahead of `now` — or None when it will never be offered again (e.g.
    a Tuesday-only deal whose `end_at` falls before next Tuesday, or a deal
    already past `end_at`).

    Scans at most 7 candidate days starting at the later of "today" and the
    deal's start date (a weekday list always recurs within 7 days, so the
    scan is bounded regardless of how far in the future `start_at` is). A
    candidate day counts when its weekday is applicable AND the day's
    [00:00, 24:00) span overlaps the deal's [start_at, end_at) window in a
    way that still ends after `now`.
    """
    now = now or datetime.now(timezone.utc)
    zone = hours_service.safe_zone(tz_name)
    start = _aware(deal.start_at) if deal.start_at is not None else None
    end = _aware(deal.end_at) if deal.end_at is not None else None

    first = now.astimezone(zone).date()
    if start is not None:
        first = max(first, start.astimezone(zone).date())

    for offset in range(7):
        day = first + timedelta(days=offset)
        if deal.applicable_days and day.weekday() not in deal.applicable_days:
            continue
        day_start = datetime.combine(day, time.min, tzinfo=zone)
        day_end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=zone)
        eff_start = max(day_start, start) if start is not None else day_start
        eff_end = min(day_end, end) if end is not None else day_end
        if eff_start < eff_end and eff_end > now:
            return day
    return None


def split_today_and_upcoming(
    deals: list[Deal], tz_name: str, *, now: datetime | None = None
) -> tuple[list[Deal], list[tuple[Deal, date]]]:
    """Partition a location's ACTIVE deals (the single `get_active_deals_map`
    result — no extra query) into (deals that apply today, other deals that
    still have a future occurrence with the date of that occurrence).

    "Other" = not matching today, not expired (`end_at` still ahead), and
    with at least one remaining offering day. Sorted soonest-first by next
    occurrence date, then title (case-insensitive), then id, so the list a
    diner reads is "what can I get next" rather than creation order.
    """
    now = now or datetime.now(timezone.utc)
    todays: list[Deal] = []
    upcoming: list[tuple[Deal, date]] = []
    for deal in deals:
        if deal_matches_today(deal, tz_name, now=now):
            todays.append(deal)
            continue
        nxt = next_occurrence_date(deal, tz_name, now=now)
        if nxt is not None:
            upcoming.append((deal, nxt))
    upcoming.sort(key=lambda pair: (pair[1], pair[0].title.casefold(), pair[0].id))
    return todays, upcoming


async def todays_and_upcoming_for_location(
    db: AsyncSession, location_id: int, tz_name: str, *, now: datetime | None = None
) -> tuple[list[Deal], list[tuple[Deal, date]]]:
    """One query, both lists — used by `GET /locations/{id}` so the new
    `upcoming_deals` field costs no extra round trip."""
    by_location = await get_active_deals_map(db, [location_id])
    return split_today_and_upcoming(by_location.get(location_id, []), tz_name, now=now)


async def caller_may_view_deal_content_for_location(
    db: AsyncSession, location: RestaurantLocation, current_user
) -> bool:
    """The public-facing deal CONTENT gate (title/description) — distinct
    from `has_deal_today`, which is unconditionally public regardless of
    this. Same caller-aware-gating shape as
    `location_service._caller_may_view_hidden_location`.

    JUDGMENT CALL (flagged for review): docs/DECISIONS.md's pre-existing
    "Deals visible to registered users only (not public)" entry (May 2026)
    reads as an all-or-nothing public/registered split with no boolean
    "fact of a deal" carve-out. This task's own instructions (2026-09-23)
    explicitly specify a different, more granular design: the FACT that a
    location has a deal today is public (search badge, `has_deal_today`),
    while only the CONTENT (title/description) stays gated to a signed-in
    registered_user — plus, newly, the location's own owner/manager/admin
    (not covered by the original May 2026 decision at all, which predates
    the owner/manager portal). Implemented exactly as this task specified,
    NOT re-derived from the older decision, since the newer instruction is
    explicit and detailed ("this is the core product requirement, get it
    right") — but this is a real, documented deviation from a prior
    DECISIONS.md entry, not a reconciled continuation of it. See
    docs/DECISIONS.md's follow-up entry for this same flag, surfaced for
    human confirmation rather than assumed correct.

    True for: a signed-in `registered_user`, an `admin`, the `owner` of
    this location's brand, or a `manager` with an active
    `location_manager` row for this exact location. False for anonymous
    and for any other authenticated caller (public caller, a different
    owner/manager, or an owner/manager not signed in as themselves).
    """
    if current_user is None:
        return False
    if current_user.role in ("registered_user", "admin"):
        return True
    if current_user.role == "owner":
        owner = await auth_service.get_owner_account_by_sub(db, current_user.cognito_sub)
        brand = await db.get(RestaurantBrand, location.brand_id)
        return owner is not None and brand is not None and brand.owner_id == owner.id
    if current_user.role == "manager":
        result = await db.execute(
            select(LocationManager).where(
                LocationManager.user_id == current_user.cognito_sub,
                LocationManager.location_id == location.id,
                LocationManager.is_active == True,  # noqa: E712
            )
        )
        return result.scalar_one_or_none() is not None
    return False


def deals_to_public_out(deals: list[Deal]) -> list[DealPublicOut]:
    return [_deal_to_public_out(d) for d in deals]


def upcoming_to_out(pairs: list[tuple[Deal, date]]) -> list[DealUpcomingOut]:
    return [
        DealUpcomingOut(
            id=d.id,
            deal_type=d.deal_type,
            title=d.title,
            description=d.description,
            applicable_days=d.applicable_days,
            start_at=d.start_at,
            end_at=d.end_at,
            next_occurrence=nxt,
        )
        for d, nxt in pairs
    ]
