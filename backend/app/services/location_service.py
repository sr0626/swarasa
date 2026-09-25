"""restaurant_location CRUD, the /hours sub-resource, and the /photos
sub-resource orchestration — see docs/API_CONTRACTS.md "Locations
(restaurant_location)".
"""
from __future__ import annotations

from decimal import Decimal

from geoalchemy2.functions import ST_MakePoint, ST_SetSRID
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.claim_request import ClaimRequest
from app.models.location_manager import LocationManager
from app.models.location_reopen_request import LocationReopenRequest
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.schemas.cuisine import CuisineTagOut
from app.schemas.hours import HourEntryIn, HoursResponse
from app.schemas.location import (
    GalleryPhotoOut,
    HoursOut,
    LocationCreate,
    LocationCuisineTagsResponse,
    LocationOut,
    LocationUpdate,
)
from app.schemas.photo import PhotoCreate, PhotoOut, PhotoUpdate, UploadUrlResponse
from app.schemas.restaurant import LocationListResponse, LocationSummaryOut
from app.services import (
    audit_service,
    auth_service,
    cuisine_service,
    deal_service,
    hours_service,
    listing_readiness,
    location_slug,
    photo_service,
    s3_service,
)


def _to_decimal(value: float | None) -> Decimal | None:
    return Decimal(str(value)) if value is not None else None


async def _sync_geom(db: AsyncSession, location_id: int, lat: float, lng: float) -> None:
    """Keep `geom` (the column `/search` actually queries) in sync with
    lat/lng on write — docs/DATA_MODEL.md judgment-call note: no DB
    trigger, so every writer path must remember to do this. `ST_MakePoint`
    takes (lng, lat) — PostGIS/GeoJSON x,y order, not (lat, lng).
    """
    await db.execute(
        update(RestaurantLocation)
        .where(RestaurantLocation.id == location_id)
        .values(geom=ST_SetSRID(ST_MakePoint(lng, lat), 4326))
    )


async def _location_to_out(
    db: AsyncSession, location: RestaurantLocation, current_user=None
) -> LocationOut:
    # brand_name: the FK is ON DELETE RESTRICT while any location exists
    # (docs/API_CONTRACTS.md "Restaurants CRUD"), so the parent brand row
    # is always present here -- no None-guard needed.
    brand = await db.get(RestaurantBrand, location.brand_id)

    hours_rows = await hours_service.get_hours_for_location(db, location.id)
    hours_by_day = {row.day_of_week: row for row in hours_rows}
    today = hours_service.today_weekday(location.timezone)
    is_open_now = hours_service.compute_is_open_now(hours_by_day.get(today), location.timezone)

    cover = await photo_service.get_cover_photo(db, location.id)
    gallery = await photo_service.get_gallery_photos(db, location.id, location.is_paid)
    tags = await cuisine_service.get_location_cuisine_tags(db, location.id)

    # Deals — public "fact" (has_deal_today) vs content-gated "detail"
    # (deals_today). See app/services/deal_service.py module docstring and
    # `caller_may_view_deal_content_for_location`'s own docstring for the
    # full reasoning, including the flagged deviation from
    # docs/DECISIONS.md's older "registered users only, not public" entry.
    # One query feeds both lists (today's + the content-gated "other active
    # deals") — no N+1, no second round trip for `upcoming_deals`.
    todays_deals, upcoming = await deal_service.todays_and_upcoming_for_location(
        db, location.id, location.timezone
    )
    has_deal_today = len(todays_deals) > 0
    may_view_deal_content = await deal_service.caller_may_view_deal_content_for_location(
        db, location, current_user
    )
    deals_today = deal_service.deals_to_public_out(todays_deals) if may_view_deal_content else None
    # Same gate as `deals_today`: null (not []) for anyone who can't see deal
    # content, so neither titles nor a count leak to public/anonymous callers.
    upcoming_deals = deal_service.upcoming_to_out(upcoming) if may_view_deal_content else None

    return LocationOut(
        id=location.id,
        brand_id=location.brand_id,
        brand_name=brand.name,
        slug=location.slug,
        brand_slug=brand.slug,
        location_name=location.location_name,
        address_line1=location.address_line1,
        address_line2=location.address_line2,
        city=location.city,
        state=location.state,
        postal_code=location.postal_code,
        country=location.country,
        phone=location.phone,
        about=location.about,
        specialties=location.specialties,
        timezone=location.timezone,
        latitude=float(location.latitude) if location.latitude is not None else None,
        longitude=float(location.longitude) if location.longitude is not None else None,
        is_verified=location.is_verified,
        is_paid=location.is_paid,
        paid_until=location.paid_until,
        status=location.status,
        is_active=location.is_active,
        # Only meaningful while the listing is in setup; empty for every other
        # status so a live/hidden listing never advertises gaps to the public.
        setup_missing=(
            listing_readiness.missing_for_activation(location, brand.name, hours_rows)
            if location.status == RestaurantLocation.STATUS_COMING_SOON
            else []
        ),
        cuisine_tags=[CuisineTagOut.model_validate(t) for t in tags],
        is_open_now=is_open_now,
        hours=[
            HoursOut(
                day_of_week=row.day_of_week,
                open_time=row.open_time,
                close_time=row.close_time,
                is_closed=row.is_closed,
            )
            for row in hours_rows
        ],
        cover_photo_url=s3_service.resolve_media_url(cover.s3_key) if cover else None,
        cover_photo_thumbnail_url=(
            s3_service.resolve_media_url(cover.thumbnail_s3_key or cover.s3_key) if cover else None
        ),
        gallery_photos=[
            GalleryPhotoOut(
                id=photo.id,
                url=s3_service.resolve_media_url(photo.s3_key),
                thumbnail_url=s3_service.resolve_media_url(photo.thumbnail_s3_key or photo.s3_key),
                display_order=photo.display_order,
            )
            for photo in gallery
        ],
        has_deal_today=has_deal_today,
        deals_today=deals_today,
        upcoming_deals=upcoming_deals,
    )


async def _caller_may_view_hidden_location(
    db: AsyncSession, location: RestaurantLocation, current_user
) -> bool:
    """Can `current_user` see this location's detail even though its
    status hides it from the public (docs/PROJECT_PLAN.csv row for this
    task: `GET /locations/{id}` must 404 a hidden location for anyone
    without real access — owner, admin, or an assigned manager, matching
    the task's explicit "still visible to the owner/admin/assigned
    manager" requirement).

    Broader than `_caller_may_see_inactive_locations` below (which backs
    the LIST endpoint and intentionally excludes manager — see that
    function's own docstring): the single-location detail page is exactly
    where an assigned manager legitimately needs to open a location the
    owner has marked `coming_soon` or `owner_deactivated` to keep setting
    it up, so the manager branch is included here. `current_user` is
    `None` for an anonymous caller (always False).
    """
    if current_user is None:
        return False
    if current_user.role == "admin":
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


async def _brand_is_deleted(db: AsyncSession, brand_id: int) -> bool:
    deleted_at = (
        await db.execute(select(RestaurantBrand.deleted_at).where(RestaurantBrand.id == brand_id))
    ).scalar_one_or_none()
    return deleted_at is not None


async def get_location(
    db: AsyncSession, location_id: int, current_user=None
) -> LocationOut:
    """`GET /locations/{id}` — public by default, but now status-aware
    (docs/PROJECT_PLAN.csv row for this task: this endpoint used to return
    a hidden location's full detail to ANY caller regardless of status,
    which is the gap this closes). A hidden location (any status except
    `active`) 404s for a caller without access — never a 403, so a caller
    without rights can't distinguish "doesn't exist" from "exists but
    hidden," same posture as the claim-flow 404/403 pattern in
    `frontend/src/app/portal/locations/[id]/page.tsx`. `current_user` is
    `None` for the (very common) anonymous/public caller.
    """
    location = await get_readable_location_or_404(db, location_id, current_user)
    return await _location_to_out(db, location, current_user)


async def get_readable_location_or_404(
    db: AsyncSession, location_id: int, current_user=None
) -> RestaurantLocation:
    """The visibility gate behind every PUBLIC read of a location's data
    (`GET /locations/{id}`, `GET /locations/{id}/menu`): 404 — never 403 —
    when the location doesn't exist, when its brand is soft-deleted (admin
    excepted), or when it's hidden (any non-`active` status) from a caller
    who is not its owner/admin/assigned manager. Extracted from
    `get_location` unchanged so every public sub-resource applies exactly
    the same rule.
    """
    location = await db.get(RestaurantLocation, location_id)
    if location is None:
        raise AppError(404, "Location not found", "not_found")
    # A location of a soft-deleted brand (`restaurant_brand.deleted_at`)
    # 404s for everyone but an admin — including its owner and assigned
    # managers, who would otherwise pass the hidden-location check below.
    if await _brand_is_deleted(db, location.brand_id) and (
        current_user is None or current_user.role != "admin"
    ):
        raise AppError(404, "Location not found", "not_found")
    if not location.is_active and not await _caller_may_view_hidden_location(
        db, location, current_user
    ):
        raise AppError(404, "Location not found", "not_found")
    return location


async def get_location_or_404(db: AsyncSession, location_id: int) -> RestaurantLocation:
    """Unfiltered internal lookup — used by write paths (update, hours,
    photos, status, manager assignment) that already have their own
    ownership/assignment auth dependency upstream (`require_location_*` in
    `app/dependencies/auth.py`), which checks brand/manager ownership
    regardless of the location's status. Deliberately NOT status-aware —
    only the public-facing `get_location` above hides a location by
    status."""
    location = await db.get(RestaurantLocation, location_id)
    if location is None:
        raise AppError(404, "Location not found", "not_found")
    return location


async def create_location(db: AsyncSession, body: LocationCreate, current_user) -> LocationOut:
    """`POST /locations` — the Add-restaurant / Add-location UI flows.

    Owner (of the brand) or admin. The new location is created in the hidden
    `coming_soon` status (docs/DECISIONS.md "New manual listings start in
    setup"): it isn't public until the owner enters the required info (hours,
    phone, address) and explicitly activates it via `POST
    /locations/{id}/status` — see `update_location_status` and
    `listing_readiness`. Seeded / bulk-imported / claim-approved listings do
    not come through here and keep their own defaults.
    """
    brand = await db.get(RestaurantBrand, body.brand_id)
    if brand is None or brand.deleted_at is not None:
        raise AppError(404, "Restaurant not found", "not_found")

    if current_user.role != "admin":
        owner = await auth_service.get_owner_account_by_sub(db, current_user.cognito_sub)
        if owner is None or brand.owner_id != owner.id:
            raise AppError(
                403, "Not authorized to add a location to this restaurant", "forbidden"
            )

    location = RestaurantLocation(
        brand_id=body.brand_id,
        # Fixed for life (never re-derived on an address edit) — see
        # app/services/location_slug.py.
        slug=await location_slug.assign_location_slug(
            db, body.brand_id, body.city, body.address_line1
        ),
        address_line1=body.address_line1,
        address_line2=body.address_line2,
        city=body.city,
        state=body.state.upper(),
        postal_code=body.postal_code,
        country=body.country.upper(),
        phone=body.phone,
        timezone=body.timezone,
        latitude=_to_decimal(body.latitude),
        longitude=_to_decimal(body.longitude),
        is_paid=False,
        is_verified=False,
        status=RestaurantLocation.STATUS_COMING_SOON,
    )
    db.add(location)
    await db.flush()

    if body.latitude is not None and body.longitude is not None:
        await _sync_geom(db, location.id, body.latitude, body.longitude)

    # Tags are per location. Explicit ids win (`[]` = none); omitted/null =
    # start from a copy of the brand's first existing location's tags (empty
    # for the brand's first location) so an owner adding a branch doesn't
    # retype them.
    if body.cuisine_tag_ids is None:
        tag_names = await cuisine_service.copy_first_location_tags(
            db, body.brand_id, location.id
        )
    else:
        _, tag_names = await cuisine_service.set_location_cuisine_tags(
            db, location.id, body.cuisine_tag_ids
        )

    await audit_service.log(
        db,
        table_name="restaurant_location",
        record_id=location.id,
        action="create",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=None,
        new_val={
            "brand_id": location.brand_id,
            "address_line1": location.address_line1,
            "city": location.city,
            "state": location.state,
            "status": location.status,
            "cuisine_tags": tag_names,
        },
    )
    await db.commit()
    return await get_location(db, location.id, current_user)


_UPDATABLE_FIELDS = (
    "location_name",
    "address_line1",
    "address_line2",
    "city",
    "state",
    "postal_code",
    "country",
    "phone",
    "timezone",
)

# Optional public-profile fields: unlike _UPDATABLE_FIELDS (where an
# explicit null is ignored), sending null/empty here clears the value.
# LocationUpdate's validators already normalise "" / [] to None.
_CLEARABLE_FIELDS = ("about", "specialties")
_AUDITED_FIELDS = _UPDATABLE_FIELDS + _CLEARABLE_FIELDS


async def update_location(
    db: AsyncSession, location_id: int, body: LocationUpdate, current_user
) -> LocationOut:
    location = await get_location_or_404(db, location_id)

    old_val = {field: getattr(location, field) for field in _AUDITED_FIELDS}
    old_val["latitude"] = float(location.latitude) if location.latitude is not None else None
    old_val["longitude"] = float(location.longitude) if location.longitude is not None else None

    data = body.model_dump(exclude_unset=True)
    for field in _UPDATABLE_FIELDS:
        if field in data and data[field] is not None:
            value = data[field]
            if field in ("state", "country"):
                value = value.upper()
            setattr(location, field, value)

    for field in _CLEARABLE_FIELDS:
        if field in data:
            setattr(location, field, data[field])

    lat_changed = "latitude" in data and data["latitude"] is not None
    lng_changed = "longitude" in data and data["longitude"] is not None
    if lat_changed:
        location.latitude = _to_decimal(data["latitude"])
    if lng_changed:
        location.longitude = _to_decimal(data["longitude"])

    await db.flush()

    if lat_changed or lng_changed:
        lat = float(location.latitude) if location.latitude is not None else None
        lng = float(location.longitude) if location.longitude is not None else None
        if lat is not None and lng is not None:
            await _sync_geom(db, location.id, lat, lng)

    new_val = {field: getattr(location, field) for field in _AUDITED_FIELDS}
    new_val["latitude"] = float(location.latitude) if location.latitude is not None else None
    new_val["longitude"] = float(location.longitude) if location.longitude is not None else None

    await audit_service.log(
        db,
        table_name="restaurant_location",
        record_id=location.id,
        action="update",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=old_val,
        new_val=new_val,
    )
    await db.commit()
    # `current_user` passed through (not the public-default `None`) — the
    # caller here already proved write access via `require_location_write_
    # access` upstream, and the location may be in a hidden status (e.g. a
    # manager finishing up a `coming_soon` location), which would otherwise
    # make `get_location`'s own visibility check 404 its own successful
    # write's response.
    return await get_location(db, location.id, current_user)


async def replace_location_cuisine_tags(
    db: AsyncSession, location_id: int, tag_ids: list[int], current_user
) -> LocationCuisineTagsResponse:
    """`PUT /locations/{id}/cuisine-tags` — full replace of THIS location's
    tags only (never its siblings'). Permission is enforced by the route's
    `require_location_write_access` (owner of the brand / assigned manager /
    admin). Audited as a `restaurant_location` update with the before/after
    tag slugs. Works on a hidden (setup) location too — the owner fills tags
    in while finishing setup."""
    location = await get_location_or_404(db, location_id)
    old_names, new_names = await cuisine_service.set_location_cuisine_tags(
        db, location.id, tag_ids
    )
    await audit_service.log(
        db,
        table_name="restaurant_location",
        record_id=location.id,
        action="update",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val={"cuisine_tags": old_names},
        new_val={"cuisine_tags": new_names},
    )
    await db.commit()
    tags = await cuisine_service.get_location_cuisine_tags(db, location.id)
    return LocationCuisineTagsResponse(results=[CuisineTagOut.model_validate(t) for t in tags])


async def delete_location(db: AsyncSession, location_id: int, current_user) -> None:
    """Soft delete — sets status=owner_deactivated via the `is_active`
    backward-compat setter (docs/API_CONTRACTS.md "DELETE /locations/{id}";
    app/models/restaurant_location.py "Location status lifecycle").
    Nothing is actually removed. Unchanged behaviour from before this
    task — this endpoint predates the 4-state model and keeps its old
    "soft-hide, one flag" semantics; the new `update_location_status`
    below is the status-aware entry point for the other three states.
    """
    location = await get_location_or_404(db, location_id)
    old_val = {"status": location.status}
    location.is_active = False
    new_val = {"status": location.status}
    await audit_service.log(
        db,
        table_name="restaurant_location",
        record_id=location.id,
        action="update",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=old_val,
        new_val=new_val,
    )
    await db.commit()


async def update_location_status(
    db: AsyncSession, location_id: int, new_status: str, current_user
) -> LocationOut:
    """`POST /locations/{id}/status` — owner/admin self-service status
    change (docs/API_CONTRACTS.md "POST /locations/{id}/status"). Auth is
    `require_location_owner_or_admin` at the router — no manager path, per
    this task's own instructions ("owner can toggle ... self-service",
    "owner (or admin) marks a NEW location ...").

    The one asymmetric rule in the whole status model lives here: a
    location already `closed_pending_reopen` cannot be moved to anything
    else through this endpoint — reopening requires an admin-approved
    `location_reopen_request` instead (see location_reopen_service.py).
    Re-posting the SAME status is always a harmless no-op (idempotent),
    checked before the lock so retrying an already-applied change never
    409s.
    """
    location = await get_location_or_404(db, location_id)

    if new_status == location.status:
        return await get_location(db, location.id, current_user)

    if location.status == RestaurantLocation.STATUS_CLOSED_PENDING_REOPEN:
        raise AppError(
            409,
            "This location is closed pending admin review — submit a reopen "
            "request instead of changing its status directly.",
            "reopen_requires_admin",
        )

    # Setup gate (docs/DECISIONS.md "New manual listings start in setup"):
    # leaving `coming_soon` for `active` — going live for the first time —
    # requires the listing's required info. Only that transition is gated:
    # un-hiding an `owner_deactivated` listing (or a reopen approval) was
    # already live once, and seeded/imported listings must keep working.
    if (
        new_status == RestaurantLocation.STATUS_ACTIVE
        and location.status == RestaurantLocation.STATUS_COMING_SOON
    ):
        brand = await db.get(RestaurantBrand, location.brand_id)
        hours_rows = await hours_service.get_hours_for_location(db, location.id)
        missing = listing_readiness.missing_for_activation(
            location, brand.name if brand else None, hours_rows
        )
        if missing:
            raise AppError(
                422,
                listing_readiness.incomplete_detail(missing),
                "listing_incomplete",
                extra={"missing": missing},
            )

    old_val = {"status": location.status}
    location.status = new_status
    new_val = {"status": location.status}
    await audit_service.log(
        db,
        table_name="restaurant_location",
        record_id=location.id,
        action="update",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=old_val,
        new_val=new_val,
    )
    await db.commit()
    return await get_location(db, location.id, current_user)


async def remove_location(db: AsyncSession, location_id: int, current_user) -> None:
    """`DELETE /locations/{id}/permanent` — a REAL, irreversible row delete.
    Not to be confused with `delete_location` above (the long-standing
    soft-hide that only flips `status`) — this actually removes the
    `restaurant_location` row, which is what finally lets an owner/admin
    clear `restaurant_brand.locations` and hard-delete a brand via `DELETE
    /restaurants/{id}` (docs/API_CONTRACTS.md "DELETE /restaurants/{id}":
    that route's `ON DELETE RESTRICT` 409 told callers to "remove or
    reassign its locations first," but nothing before this endpoint could
    actually do that removal — see docs/DECISIONS.md "Hard-delete a
    location" for the full gap this closes).

    Auth: owner (owns parent brand) or admin — same
    `require_location_owner_or_admin` dependency as the soft-delete route,
    enforced at the router.

    Guardrails, checked in order, each a clean 409 (never a raw DB
    integrity error, root CLAUDE.md "NEVER expose internal stack
    details"):
      1. The location must already be in a non-`active` status. A live,
         publicly-visible location can't be hard-deleted directly — the
         caller has to hide it first (any of the three hidden statuses is
         fine), which also means they've already seen and accepted that
         it's coming down before the irreversible step.
      2. No active `location_manager` assignment. A manager could be mid-
         session against this location; removing it out from under them
         is a worse failure mode than asking the owner/admin to revoke the
         assignment first (`DELETE /locations/{id}/managers/{manager_id}`).
      3. No `claim_request` in `pending_review` referencing this location
         (via its nullable `location_id` — the phone_verification proof
         path, see `app/models/claim_request.py`). An admin mid-review of
         a claim against this location's phone number shouldn't have the
         location disappear underneath that review.
      4. No `location_reopen_request` in `pending_review` for this
         location. Same reasoning as (3) — don't let a location vanish
         while an admin decision about it is in flight.

    Rows this cascades away via the DB's own FK actions (never done here
    manually — `app/models/*.py` already declares each one, same pattern
    `delete_restaurant` above relies on for its own `ON DELETE RESTRICT`):
    `restaurant_hours` (CASCADE), `restaurant_photo` (CASCADE), `deal`
    (CASCADE), the whole menu — `menu_section` and `menu_item` (both
    `location_id` CASCADE; tests/integration/test_menu.py covers a
    location with menu rows), `location_reopen_request` (CASCADE — safe, guardrail 4 above already
    guarantees none are pending), and ALL `location_manager` rows for this
    location, active or historically-inactive (CASCADE). `claim_request.
    location_id` / `listing_report.location_id` are `SET NULL` — those
    rows survive with their location pointer cleared.

    JUDGMENT CALL (flagged for review): cascading away a location's
    *inactive* `location_manager` history (past assignments/revocations)
    is a real loss of that particular audit trail, even though the
    `audit_log` row this function itself writes survives independently
    (`audit_log` has no FK to `restaurant_location`). Accepted as the
    correct tradeoff for a genuinely-destructive, explicitly-confirmed
    action — the alternative (refusing to hard-delete until every
    historical manager row is manually purged) would make this feature
    unusable for exactly the locations most likely to need it (an
    established listing with manager history). Guardrail 2 above still
    refuses on any *active* assignment, so no currently-working manager
    is ever surprised by this.
    """
    location = await get_location_or_404(db, location_id)

    if location.status == RestaurantLocation.STATUS_ACTIVE:
        raise AppError(
            409,
            "This location is still active. Hide, mark coming soon, or close it "
            "before removing it permanently.",
            "location_still_active",
        )

    active_manager = (
        await db.execute(
            select(LocationManager.id)
            .where(
                LocationManager.location_id == location_id,
                LocationManager.is_active == True,  # noqa: E712
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if active_manager is not None:
        raise AppError(
            409,
            "This location still has an active manager assignment. Remove the "
            "manager before removing the location.",
            "location_has_active_manager",
        )

    pending_claim = (
        await db.execute(
            select(ClaimRequest.id)
            .where(
                ClaimRequest.location_id == location_id,
                ClaimRequest.status == "pending_review",
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if pending_claim is not None:
        raise AppError(
            409,
            "This location has a pending ownership claim under review. Wait for "
            "that review to finish before removing it.",
            "location_has_pending_claim",
        )

    pending_reopen = (
        await db.execute(
            select(LocationReopenRequest.id)
            .where(
                LocationReopenRequest.location_id == location_id,
                LocationReopenRequest.status == "pending_review",
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if pending_reopen is not None:
        raise AppError(
            409,
            "This location has a pending reopen request under review. Wait for "
            "that review to finish before removing it.",
            "location_has_pending_reopen_request",
        )

    old_val = {
        "status": location.status,
        "address_line1": location.address_line1,
        "city": location.city,
        "state": location.state,
        "brand_id": location.brand_id,
    }
    await audit_service.log(
        db,
        table_name="restaurant_location",
        record_id=location.id,
        action="delete",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=old_val,
        new_val=None,
    )
    # A Core-level `delete()`, not `db.delete(location)` (session-level
    # unit-of-work delete) — deliberately. `RestaurantLocation.managers` /
    # `.hours` are plain `relationship()`s with no `passive_deletes=True`
    # (Architect-owned models, out of scope to change here), so a
    # session-level delete makes SQLAlchemy load those collections and
    # proactively try to NULL their FK columns before deleting the parent —
    # which 500s on `location_manager.location_id` / `restaurant_hours.
    # location_id` (both `NOT NULL`) even though the DB's own `ON DELETE
    # CASCADE` (docs/DATA_MODEL.md) would have handled every child row
    # correctly on its own. This bulk `delete()` goes straight to the DB
    # without walking ORM relationships, so the real `ON DELETE
    # CASCADE`/`SET NULL` FK actions do the cascading, exactly as this
    # function's own docstring describes.
    await db.execute(delete(RestaurantLocation).where(RestaurantLocation.id == location.id))
    await db.commit()


async def list_locations_for_brand(
    db: AsyncSession, brand_id: int, pagination, current_user=None
) -> LocationListResponse:
    """`GET /restaurants/{id}/locations` — public by default (active-only,
    unchanged), but additionally surfaces a brand's own deactivated
    locations to the owning owner or an admin caller when `current_user`
    is passed (docs/PROJECT_PLAN.csv "Serialize paid_until/is_active on
    location endpoints + let owner see own deactivated locations"; see
    `_caller_may_see_inactive_locations` below). This is the SAME code
    path the public listing uses — deliberately, per that row's own
    framing ("if you find the two share a code path, add an explicit
    include_inactive-for-owner branch") — there is no separate
    owner-scoped locations-list endpoint today, so the filter branches
    inside this one function rather than forking into two.
    """
    brand = await db.get(RestaurantBrand, brand_id)
    if brand is None:
        raise AppError(404, "Restaurant not found", "not_found")
    # Soft-deleted brand: 404 for everyone but an admin (owner console
    # included) — see `get_location`.
    if brand.deleted_at is not None and (current_user is None or current_user.role != "admin"):
        raise AppError(404, "Restaurant not found", "not_found")

    include_inactive = await _caller_may_see_inactive_locations(db, brand, current_user)

    filters = [RestaurantLocation.brand_id == brand_id]
    if not include_inactive:
        # "Inactive" here still means any non-`active` status — all three
        # hidden statuses (owner_deactivated/coming_soon/closed_pending_
        # reopen) are equally invisible to a caller without access, same
        # as the old boolean (app/models/restaurant_location.py "Location
        # status lifecycle" — there is no partially-visible hidden state).
        filters.append(RestaurantLocation.status == RestaurantLocation.STATUS_ACTIVE)

    total = (
        await db.execute(select(func.count()).select_from(RestaurantLocation).where(*filters))
    ).scalar_one()

    rows = (
        await db.execute(
            select(RestaurantLocation)
            .where(*filters)
            .order_by(RestaurantLocation.id)
            .offset(pagination.offset)
            .limit(pagination.page_size)
        )
    ).scalars().all()

    tags_by_location = await cuisine_service.get_location_cuisine_tags_bulk(
        db, [row.id for row in rows]
    )
    results = []
    for row in rows:
        is_open_now = await hours_service.is_open_now_for_location(db, row.id, row.timezone)
        results.append(
            LocationSummaryOut(
                id=row.id,
                slug=row.slug,
                location_name=row.location_name,
                address_line1=row.address_line1,
                city=row.city,
                state=row.state,
                postal_code=row.postal_code,
                phone=row.phone,
                is_verified=row.is_verified,
                is_paid=row.is_paid,
                paid_until=row.paid_until,
                status=row.status,
                is_active=row.is_active,
                is_open_now=is_open_now,
                cuisine_tags=[
                    CuisineTagOut.model_validate(t) for t in tags_by_location.get(row.id, [])
                ],
            )
        )

    return LocationListResponse(
        results=results, page=pagination.page, page_size=pagination.page_size, total=total
    )


async def _caller_may_see_inactive_locations(db: AsyncSession, brand, current_user) -> bool:
    """`current_user` is `None` for an anonymous caller (the common case —
    always active-only). For an authenticated caller: an admin always
    passes (root CLAUDE.md Permission model, "Admin: full platform
    access" — same admin-parity posture as
    `require_location_write_access`/`require_location_owner_or_admin` in
    `app/dependencies/auth.py`; not explicitly called for by the
    PROJECT_PLAN.csv row that tracks this gap, but consistent with this
    codebase's established pattern elsewhere and flagged here as a
    judgment call for review). An owner passes only if they own THIS
    brand — never trust the JWT role claim alone, re-resolve the local
    `owner_account` row and compare `owner_account.id` to
    `restaurant_brand.owner_id`, same pattern as
    `require_brand_write_access`. Every other role (manager,
    registered_user) still only sees active locations — no use case for
    a manager/registered_user to see a deactivated location here.
    """
    if current_user is None:
        return False
    if current_user.role == "admin":
        return True
    if current_user.role != "owner":
        return False
    owner = await auth_service.get_owner_account_by_sub(db, current_user.cognito_sub)
    return owner is not None and owner.id == brand.owner_id


# ---------------------------------------------------------------------------
# Hours sub-resource
# ---------------------------------------------------------------------------


async def replace_location_hours(
    db: AsyncSession, location_id: int, entries: list[HourEntryIn], current_user
) -> HoursResponse:
    location = await get_location_or_404(db, location_id)
    await hours_service.replace_hours(db, location.id, entries)

    await audit_service.log(
        db,
        table_name="restaurant_location",
        record_id=location.id,
        action="update",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=None,
        new_val={"hours_updated_days": [e.day_of_week for e in entries]},
    )
    await db.commit()

    rows = await hours_service.get_hours_for_location(db, location.id)
    return HoursResponse(
        hours=[
            HoursOut(
                day_of_week=row.day_of_week,
                open_time=row.open_time,
                close_time=row.close_time,
                is_closed=row.is_closed,
            )
            for row in rows
        ]
    )


# ---------------------------------------------------------------------------
# Photos sub-resource — restaurant_photo is not in the audit-required
# table list (docs/API_CONTRACTS.md), so no audit_log write below.
# ---------------------------------------------------------------------------


async def create_photo_upload_url(
    db: AsyncSession, location_id: int, content_type: str
) -> UploadUrlResponse:
    await get_location_or_404(db, location_id)
    url, fields, key, expires_in = s3_service.generate_location_photo_upload_url(
        location_id, content_type
    )
    return UploadUrlResponse(upload_url=url, fields=fields, s3_key=key, expires_in=expires_in)


async def create_location_photo(
    db: AsyncSession, location_id: int, body: PhotoCreate, current_user
) -> PhotoOut:
    """`body.s3_key` (as received from the client) is the RAW upload key
    from `create_photo_upload_url` above — BRD 5.3's steps 3-5 (resize,
    write processed/thumbnails, delete raw/) run asynchronously off the S3
    event, so they will almost certainly NOT have finished by the time
    this call lands right after the client's direct-to-S3 upload
    completes. Rather than block/poll for that, this predicts the
    resize Lambda's eventual `processed/`/`thumbnails/` output keys from
    the raw key (`s3_service.processed_key_for_upload`/
    `thumbnail_key_for_upload` — pure string transforms, see
    app/media/key_transform.py) and stores THOSE immediately. The DB
    record — and the URLs this endpoint returns — are correct from the
    first response; the actual S3 objects typically appear a few seconds
    later (real eventual consistency: e.g. an image requested from
    CloudFront in that narrow window would 404 until the resize Lambda
    finishes). See docs/DECISIONS.md "S3 image resize pipeline:
    predictable key, not read-after-write" for the full reasoning and the
    tradeoffs considered (polling, a status field, synchronous resize in
    the request path — all rejected).
    """
    location = await get_location_or_404(db, location_id)
    processed_key = s3_service.processed_key_for_upload(body.s3_key, location_id)
    thumbnail_key = s3_service.thumbnail_key_for_upload(body.s3_key, location_id)
    stored_body = body.model_copy(update={"s3_key": processed_key})
    photo = await photo_service.create_photo(
        db, location, stored_body, current_user.cognito_sub, thumbnail_s3_key=thumbnail_key
    )
    return photo_service.to_photo_out(photo)


async def update_location_photo(
    db: AsyncSession, location_id: int, photo_id: int, body: PhotoUpdate
) -> PhotoOut:
    location = await get_location_or_404(db, location_id)
    photo = await photo_service.update_photo(db, location, photo_id, body)
    return photo_service.to_photo_out(photo)


async def delete_location_photo(db: AsyncSession, location_id: int, photo_id: int) -> None:
    location = await get_location_or_404(db, location_id)
    await photo_service.delete_photo(db, location, photo_id)
