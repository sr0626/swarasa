"""location_manager business logic for `/locations/{id}/managers` — see
docs/API_CONTRACTS.md "Location Managers".

`assert_can_add_active_manager` (the paid-tier 2-active-manager cap check,
DECISIONS.md "Assignable location managers capped at 2") was written ahead
of the contract that wires it to a live endpoint; that contract now exists
and `assign_manager` below is the wiring.

Extended 2026-09-22 (docs/DECISIONS.md "Symmetric manager-location cap",
"Manager scoped to one owner at a time"):
  - Both cap numbers (managers-per-location, locations-per-manager) now
    read from the `platform_config` table (`platform_config_service`)
    instead of a hardcoded constant — an admin can change either without a
    code deploy. The module constants below are the fallback DEFAULT used
    only if the config row is somehow missing, and the value the seed
    migration writes — not the source of truth anymore.
  - `assert_manager_not_over_location_cap` is the new symmetric check:
    same paid-tier-only gating philosophy as the existing location-side
    cap, applied from the manager's side (see its own docstring for the
    exact scoping reasoning).
  - `assert_manager_belongs_to_same_owner` enforces that a manager being
    assigned is not currently active on a different owner's location.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.location_manager import LocationManager
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.services import (
    audit_service,
    cognito_service,
    follow_service,
    hours_service,
    platform_config_service,
)

# Fallback defaults / seed values only — see module docstring. The live
# cap numbers are read from `platform_config` on every check.
MAX_ACTIVE_MANAGERS_PER_LOCATION_PAID = 2
MAX_ACTIVE_LOCATIONS_PER_MANAGER_PAID = 2

CONFIG_KEY_MAX_MANAGERS_PER_LOCATION = "max_active_managers_per_location"
CONFIG_KEY_MAX_LOCATIONS_PER_MANAGER = "max_active_locations_per_manager"


async def count_active_managers(db: AsyncSession, location_id: int) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(LocationManager)
        .where(LocationManager.location_id == location_id, LocationManager.is_active == True)  # noqa: E712
    )
    return result.scalar_one()


async def assert_can_add_active_manager(db: AsyncSession, location: RestaurantLocation) -> None:
    """Raise 409 if adding one more active manager would exceed the cap.

    Only enforced on the paid tier (DECISIONS.md "Assignable location
    managers capped at 2 per location on paid tier") — no cap on free tier.
    Cap value now comes from `platform_config` (see module docstring),
    falling back to `MAX_ACTIVE_MANAGERS_PER_LOCATION_PAID` if unset.
    """
    if not location.is_paid:
        return
    cap = await platform_config_service.get_config_int(
        db, CONFIG_KEY_MAX_MANAGERS_PER_LOCATION, MAX_ACTIVE_MANAGERS_PER_LOCATION_PAID
    )
    current = await count_active_managers(db, location.id)
    if current >= cap:
        raise AppError(
            409,
            f"This location already has the maximum of {cap} active managers allowed on the paid tier",
            "manager_cap_reached",
        )


def _location_display_name(location_name: str | None, brand_name: str) -> str:
    return location_name or brand_name


async def _paid_active_assignments_for_manager(
    db: AsyncSession, manager_sub: str, *, exclude_location_id: int | None = None
) -> list[tuple[int, str, str]]:
    """(location_id, display_name, city) for each of this manager's
    current active assignments on `is_paid=true` locations — used both to
    count against the symmetric cap and to name the locations in the
    409's error message (task requirement: name the locations, not just
    the count).

    `exclude_location_id` leaves out the location currently being assigned
    to — relevant only for the (rare) case where the manager is already
    actively assigned to THAT SAME location and this is really a duplicate
    assignment attempt: without the exclusion, that location would count
    itself toward "other locations", which could misreport
    `manager_location_cap_reached` right at the cap boundary instead of
    letting the more specific `already_active_manager` check (the unique
    index catch in `assign_manager`) surface. Callers computing/displaying
    a manager's *existing* portfolio in general (not mid-assignment) pass
    nothing here.
    """
    filters = [
        LocationManager.user_id == manager_sub,
        LocationManager.is_active == True,  # noqa: E712
        RestaurantLocation.is_paid == True,  # noqa: E712
        # A soft-deleted brand's locations no longer count toward a
        # manager's cap (`restaurant_brand.deleted_at`).
        RestaurantBrand.deleted_at.is_(None),
    ]
    if exclude_location_id is not None:
        filters.append(RestaurantLocation.id != exclude_location_id)
    rows = (
        await db.execute(
            select(
                RestaurantLocation.id,
                RestaurantLocation.location_name,
                RestaurantBrand.name,
                RestaurantLocation.city,
            )
            .select_from(LocationManager)
            .join(RestaurantLocation, RestaurantLocation.id == LocationManager.location_id)
            .join(RestaurantBrand, RestaurantBrand.id == RestaurantLocation.brand_id)
            .where(*filters)
            .order_by(RestaurantLocation.id)
        )
    ).all()
    return [
        (location_id, _location_display_name(location_name, brand_name), city)
        for location_id, location_name, brand_name, city in rows
    ]


async def assert_manager_not_over_location_cap(
    db: AsyncSession, manager_sub: str, location: RestaurantLocation
) -> None:
    """Symmetric counterpart to `assert_can_add_active_manager`: raise 409
    if this manager already manages the cap number of *other* locations.

    SCOPING JUDGMENT CALL (Architect, flagged for review): applies the
    exact same paid-tier-only gating philosophy as the location-side cap,
    from the manager's side. DECISIONS.md "Assignable location managers
    capped at 2 per location on paid tier" caps per-location because that
    cap exists to keep the *paid* owner/manager permission surface small
    and reviewable; DECISIONS.md "No location cap for free tier" is
    explicit that free-tier assignments are deliberately uncapped
    ("per-location billing makes the cap concept redundant... no
    artificial limit"). Symmetric treatment therefore means:
      - Skip the check entirely when the location being assigned to is
        free tier (`is_paid=false`) — same trigger as the location-side
        cap, so a manager can be assigned to unlimited free locations.
      - When the location IS paid, count only the manager's *other*
        active assignments that are ALSO on paid locations — a manager
        who already manages 5 free-tier locations plus 1 paid one is not
        blocked from taking on a 2nd paid one; a manager already at the
        paid cap is blocked regardless of how many free locations they
        also manage. This keeps "the paid-tier permission surface" (the
        thing the original cap protects) as the one thing both caps
        actually bound, rather than inventing an unrelated free-tier
        rule the rest of the schema doesn't have.
    """
    if not location.is_paid:
        return
    cap = await platform_config_service.get_config_int(
        db, CONFIG_KEY_MAX_LOCATIONS_PER_MANAGER, MAX_ACTIVE_LOCATIONS_PER_MANAGER_PAID
    )
    current = await _paid_active_assignments_for_manager(
        db, manager_sub, exclude_location_id=location.id
    )
    if len(current) >= cap:
        names = ", ".join(f"{name} ({city})" for _, name, city in current[:cap])
        raise AppError(
            409,
            f"This person already manages {cap} locations: {names}",
            "manager_location_cap_reached",
        )


async def assert_manager_belongs_to_same_owner(
    db: AsyncSession, manager_sub: str, owner_id: int | None
) -> None:
    """Raise 409 if `manager_sub` currently holds an active assignment on
    ANY location owned by a DIFFERENT owner than `owner_id`.

    INVARIANT JUDGMENT CALL (Architect, flagged for review): root
    CLAUDE.md's ownership hierarchy is `owner_account (1) ->
    restaurant_brand (N) -> restaurant_location (N) -> location_manager
    (N)` with no `owner_id` column anywhere on `location_manager` or a
    "manager account" table (see `app/models/location_manager.py`'s own
    JUDGMENT CALL docstring: `user_id` is a bare Cognito `sub`, identity
    lives entirely in Cognito, not a local owner-scoped profile). Nothing
    in the schema or DECISIONS.md already states "a manager belongs to
    one owner" as a stored fact — this task asks for it as a *runtime*
    invariant, checked at assignment time, not a schema constraint. The
    chosen invariant: a manager's *active* assignments (across ALL
    locations, ALL brands) must all trace back to the SAME owner_id via
    `location_manager -> restaurant_location -> restaurant_brand.owner_id`.
    Scoped to ACTIVE rows only (same "is_active=true is what's live"
    posture the paid-tier cap and the partial unique index both already
    use) — a manager's history with a PRIOR owner (now all soft-removed)
    does not block a fresh assignment to a new owner; only a currently
    live assignment elsewhere does. This is a business-process guard, not
    a data-integrity one — deliberately not a DB constraint (no
    generalized cross-table CHECK across three tables is practical in
    Postgres), same reasoning `assert_can_add_active_manager`'s cap check
    already documents for itself.
    """
    if owner_id is None:
        # Defensive only — `assign_manager`'s caller (`require_location_
        # owner_only`) always populates `current_user.owner_account_id`
        # before this runs. Nothing meaningful to compare against.
        return
    result = await db.execute(
        select(RestaurantBrand.owner_id)
        .select_from(LocationManager)
        .join(RestaurantLocation, RestaurantLocation.id == LocationManager.location_id)
        .join(RestaurantBrand, RestaurantBrand.id == RestaurantLocation.brand_id)
        .where(
            LocationManager.user_id == manager_sub,
            LocationManager.is_active == True,  # noqa: E712
            RestaurantBrand.owner_id.is_not(None),
            RestaurantBrand.owner_id != owner_id,
        )
        .limit(1)
    )
    if result.scalar_one_or_none() is not None:
        raise AppError(
            409,
            "This person is already an active manager for a different restaurant owner's "
            "account. A manager can only be assigned within one owner's account at a time.",
            "manager_different_owner",
        )


def _to_out(manager: LocationManager):
    # Sync, not async — same posture as `s3_service`'s boto3 calls, called
    # directly (no `await`) from async service code elsewhere in this app;
    # `cognito_service` wraps blocking boto3 the same way `s3_service`
    # does, so this mapper stays sync too rather than faking an `await`
    # that never actually yields.
    #
    # Local import avoids a hard import-time dependency from this service
    # module onto the schemas package for the (uncommon) case something
    # ever needs this service without the API layer.
    from app.schemas.location_manager import LocationManagerOut

    return LocationManagerOut(
        id=manager.id,
        location_id=manager.location_id,
        user_id=manager.user_id,
        email=cognito_service.find_email_by_sub(manager.user_id),
        is_active=manager.is_active,
        assigned_by_owner_id=manager.assigned_by_owner_id,
        assigned_at=manager.assigned_at,
        revoked_at=manager.revoked_at,
    )


async def assign_manager(
    db: AsyncSession, location: RestaurantLocation, current_user, manager_email: str
):
    """POST /locations/{id}/managers.

    Order matters, cheapest/most-fundamental rejection first so we never
    do wasted work ahead of a check that was going to fail anyway:
      1. Resolve the email to a Cognito `sub` (a `404 manager_not_found` —
         "unknown email" — should not be preceded by any DB work at all).
         No invite email is sent and no Cognito user is created on a miss
         (SES/email is Phase-2-deferred, root CLAUDE.md "Email: AWS
         SES (deferred)") — this stays a clear, immediate error. The
         "auto-invite a not-yet-registered email + auto-link on their
         later signup" flow is an explicit, intentionally NOT built here,
         backlog item (see this task's PR description).
      2. Cross-owner check (`assert_manager_belongs_to_same_owner`) — a
         manager scoped to a different owner is rejected before either
         cap check runs (an identity/ownership violation, not a capacity
         one; no reason to compute cap state first).
      3. The existing paid-tier location-side cap
         (`assert_can_add_active_manager`).
      4. The new symmetric paid-tier manager-side cap
         (`assert_manager_not_over_location_cap`).
      5. Attempt the insert — the partial unique index
         (`uq_location_manager_active_user`, docs/DATA_MODEL.md) is the
         last line of defense against a concurrent duplicate active
         assignment and is caught below rather than leaking a raw DB
         integrity error (same pattern as
         `restaurant_service.delete_restaurant`'s `ON DELETE RESTRICT`
         catch).
    """
    sub = cognito_service.find_sub_by_email(manager_email)
    if sub is None:
        raise AppError(
            404,
            "No registered user exists with this email",
            "manager_not_found",
        )

    await assert_manager_belongs_to_same_owner(db, sub, current_user.owner_account_id)
    await assert_can_add_active_manager(db, location)
    await assert_manager_not_over_location_cap(db, sub, location)

    manager = LocationManager(
        location_id=location.id,
        user_id=sub,
        assigned_by_owner_id=current_user.owner_account_id,
        is_active=True,
    )
    db.add(manager)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise AppError(
            409,
            "This user already has an active manager assignment on this location",
            "already_active_manager",
        )

    await audit_service.log(
        db,
        table_name="location_manager",
        record_id=manager.id,
        action="create",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=None,
        new_val={
            "location_id": manager.location_id,
            "user_id": manager.user_id,
            "is_active": manager.is_active,
        },
    )
    await db.commit()
    return _to_out(manager)


async def list_managers(db: AsyncSession, location_id: int, active_only: bool):
    """GET /locations/{id}/managers."""
    stmt = select(LocationManager).where(LocationManager.location_id == location_id)
    if active_only:
        stmt = stmt.where(LocationManager.is_active == True)  # noqa: E712
    stmt = stmt.order_by(LocationManager.id)
    rows = (await db.execute(stmt)).scalars().all()
    return [_to_out(row) for row in rows]


async def list_managed_locations(db: AsyncSession, current_user, pagination):
    """GET /auth/me/managed-locations — see docs/API_CONTRACTS.md
    "GET /auth/me/managed-locations".

    Any authenticated caller can call this (no role check in the router
    dependency) — it is inherently scoped to "my own" active assignments
    via `LocationManager.user_id == current_user.cognito_sub`, so an
    owner/admin/registered_user with no `location_manager` rows just gets
    an empty page rather than a 403. This is the discovery endpoint a
    manager needs before they can call `GET /locations/{id}/managers`,
    which requires a location id up front (docs/PROJECT_PLAN.csv "User
    profile / account details page" backlog note).

    Only `is_active=true` assignment rows on `is_active=true` (not
    soft-deleted) locations are returned — a manager's own removal/
    relisting history isn't relevant here, unlike the owner/admin-facing
    `GET /locations/{id}/managers?active_only=false`.
    """
    from app.schemas.location_manager import ManagedLocationListResponse, ManagedLocationOut

    base_filter = (
        LocationManager.user_id == current_user.cognito_sub,
        LocationManager.is_active == True,  # noqa: E712
        RestaurantLocation.is_active == True,  # noqa: E712
        # Manager console hides a soft-deleted brand's locations even if one
        # were re-enabled (`restaurant_brand.deleted_at`).
        RestaurantBrand.deleted_at.is_(None),
    )

    total = (
        await db.execute(
            select(func.count())
            .select_from(RestaurantLocation)
            .join(LocationManager, LocationManager.location_id == RestaurantLocation.id)
            .join(RestaurantBrand, RestaurantBrand.id == RestaurantLocation.brand_id)
            .where(*base_filter)
        )
    ).scalar_one()

    rows = (
        (
            await db.execute(
                select(RestaurantLocation)
                .join(LocationManager, LocationManager.location_id == RestaurantLocation.id)
                .join(RestaurantBrand, RestaurantBrand.id == RestaurantLocation.brand_id)
                .where(*base_filter)
                .order_by(RestaurantLocation.id)
                .offset(pagination.offset)
                .limit(pagination.page_size)
            )
        )
        .scalars()
        .all()
    )

    results = []
    for row in rows:
        is_open_now = await hours_service.is_open_now_for_location(db, row.id, row.timezone)
        follower_count = await follow_service.count_followers_for_brand(db, row.brand_id)
        brand = await db.get(RestaurantBrand, row.brand_id)
        results.append(
            ManagedLocationOut(
                id=row.id,
                brand_name=brand.name if brand else "",
                slug=row.slug,
                brand_slug=brand.slug if brand else "",
                location_name=row.location_name,
                address_line1=row.address_line1,
                city=row.city,
                state=row.state,
                postal_code=row.postal_code,
                phone=row.phone,
                is_verified=row.is_verified,
                is_paid=row.is_paid,
                is_open_now=is_open_now,
                follower_count=follower_count,
            )
        )

    return ManagedLocationListResponse(
        results=results, page=pagination.page, page_size=pagination.page_size, total=total
    )


async def deactivate_manager(
    db: AsyncSession, location_id: int, manager_id: int, current_user
) -> None:
    """DELETE /locations/{id}/managers/{manager_id}.

    Soft-deactivate only — sets `is_active=false` + `revoked_at=now()`,
    never deletes the row (docs/API_CONTRACTS.md). Idempotent for an
    already-inactive row: returns with no error and no side effect (no
    audit row, no `revoked_at` overwrite) rather than 404/409 — plain
    REST-delete idempotency, per the contract. A `manager_id` that never
    existed for this location is a genuine 404, not a no-op.
    """
    manager = await db.get(LocationManager, manager_id)
    if manager is None or manager.location_id != location_id:
        raise AppError(404, "Manager assignment not found", "not_found")

    if not manager.is_active:
        return

    old_val = {"is_active": manager.is_active, "revoked_at": None}
    manager.is_active = False
    manager.revoked_at = datetime.now(timezone.utc)
    new_val = {"is_active": manager.is_active, "revoked_at": manager.revoked_at.isoformat()}

    await audit_service.log(
        db,
        table_name="location_manager",
        record_id=manager.id,
        action="update",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=old_val,
        new_val=new_val,
    )
    await db.commit()
