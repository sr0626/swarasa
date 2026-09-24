"""restaurant_brand CRUD — see docs/API_CONTRACTS.md "Restaurants
(restaurant_brand)".
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.dependencies.pagination import Pagination
from app.models.claim_request import ClaimRequest
from app.models.owner_account import OwnerAccount
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.models.user_follow import UserFollow
from app.schemas.cuisine import CuisineTagOut
from app.schemas.location import LocationOut
from app.schemas.restaurant import (
    BrandLocationCardOut,
    LocationPageOut,
    PublicLocationIndexItem,
    PublicLocationIndexResponse,
    RestaurantCreate,
    RestaurantListResponse,
    RestaurantOut,
    RestaurantPublicOut,
    RestaurantUpdate,
)
from app.services import (
    audit_service,
    auth_service,
    cuisine_service,
    deal_service,
    follow_service,
    hours_service,
    location_service,
    photo_service,
    s3_service,
)


# `GET /restaurants?status=deleted` pseudo-status — see `list_restaurants`.
DELETED_STATUS_FILTER = "deleted"


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return slug or "restaurant"


def _escape_like(value: str) -> str:
    """Escapes LIKE wildcards so a user typing `%` or `_` matches
    literally. Same helper as `search_service._escape_like` — duplicated
    rather than imported to keep the two services independent (no
    precedent for a shared text-util module in this codebase yet)."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def _unique_slug(db: AsyncSession, base_slug: str) -> str:
    slug = base_slug
    suffix = 2
    while True:
        result = await db.execute(select(RestaurantBrand.id).where(RestaurantBrand.slug == slug))
        if result.scalar_one_or_none() is None:
            return slug
        slug = f"{base_slug}-{suffix}"
        suffix += 1


def _caller_may_view_follower_count(brand: RestaurantBrand, current_user) -> bool:
    """Dashboard-only stat, never public (task: "in their dashboard for
    their restaurants only" — see RestaurantOut.follower_count's own
    docstring). `current_user` is `None` for the public
    `GET /restaurants/{id}` route (that endpoint has no auth dependency
    at all — see `get_restaurant` below), so this always returns `False`
    for that path regardless of who's asking, same caller-aware-gating
    shape as `location_service._caller_may_view_hidden_location`/
    `_caller_may_see_inactive_locations`.

    Every OTHER call site that passes a real `current_user` here
    (`list_restaurants`, `create_restaurant`, `update_restaurant`) has
    already proven, upstream, that the caller is an admin or the owner of
    THIS exact brand before `_brand_to_out` is ever called for that row —
    `list_restaurants` hard-filters its query to the caller's own
    `owner_id` (or an admin's explicit filter), and `create_restaurant`/
    `update_restaurant` only run after `require_owner`/
    `require_brand_write_access` has already verified ownership of this
    brand specifically. So this check is a second, defense-in-depth gate
    on role, not a fresh ownership re-check — kept here rather than
    silently trusting every caller who passes a non-None `current_user`.
    """
    if current_user is None:
        return False
    return current_user.role in ("owner", "admin")


async def _brand_to_out(db: AsyncSession, brand: RestaurantBrand, current_user=None) -> RestaurantOut:
    tags = await cuisine_service.get_brand_cuisine_tags(db, brand.id)
    count_result = await db.execute(
        select(func.count())
        .select_from(RestaurantLocation)
        .where(RestaurantLocation.brand_id == brand.id, RestaurantLocation.is_active == True)  # noqa: E712
    )
    location_count = count_result.scalar_one()
    pending_result = await db.execute(
        select(ClaimRequest.id)
        .where(ClaimRequest.brand_id == brand.id, ClaimRequest.status == "pending_review")
        .limit(1)
    )
    has_pending_claim = pending_result.scalar_one_or_none() is not None

    follower_count = None
    if _caller_may_view_follower_count(brand, current_user):
        follower_count = await follow_service.count_followers_for_brand(db, brand.id)

    return RestaurantOut(
        id=brand.id,
        name=brand.name,
        slug=brand.slug,
        description=brand.description,
        website=brand.website,
        is_claimed=brand.is_claimed,
        has_pending_claim=has_pending_claim,
        owner_id=brand.owner_id,
        cuisine_tags=[CuisineTagOut.model_validate(t) for t in tags],
        location_count=location_count,
        follower_count=follower_count,
        deleted_at=brand.deleted_at,
    )


async def get_restaurant(db: AsyncSession, id_or_slug: str) -> RestaurantOut:
    """`id_or_slug` resolves either the numeric `restaurant_brand.id` or its
    `slug` (docs/API_CONTRACTS.md "GET /restaurants/{id}"): all-digits ->
    id lookup, otherwise -> slug lookup.

    Public — no `current_user` here, by design (the router has no auth
    dependency at all for this route). `_brand_to_out`'s `follower_count`
    therefore always comes back `null`: this endpoint must never leak a
    brand's follower count to the public, including to the owner
    themselves browsing their own public page or a different owner
    probing another brand's id/slug (see `_caller_may_view_follower_count`).
    """
    if id_or_slug.isdigit():
        brand = await db.get(RestaurantBrand, int(id_or_slug))
    else:
        result = await db.execute(select(RestaurantBrand).where(RestaurantBrand.slug == id_or_slug))
        brand = result.scalar_one_or_none()
    # A soft-deleted listing is indistinguishable from a nonexistent one
    # for this public route (docs/API_CONTRACTS.md "DELETE /restaurants/{id}").
    if brand is None or brand.deleted_at is not None:
        raise AppError(404, "Restaurant not found", "not_found")
    return await _brand_to_out(db, brand)


async def _brand_by_slug(db: AsyncSession, brand_slug: str) -> RestaurantBrand | None:
    result = await db.execute(select(RestaurantBrand).where(RestaurantBrand.slug == brand_slug))
    return result.scalar_one_or_none()


async def _active_location_cards(db: AsyncSession, brand_id: int) -> list[BrandLocationCardOut]:
    """The brand's ACTIVE locations as landing-page cards, ordered by city
    (case-insensitive) then id — a stable order that does not depend on when a
    location was added. Batched: one query each for the locations, hours,
    cover photos and deals, regardless of how many locations the brand has (no
    N+1). `has_deal_today` uses `deal_service.deal_matches_today` in each
    location's own timezone — the same predicate as `/search`."""
    rows = (
        (
            await db.execute(
                select(RestaurantLocation)
                .where(
                    RestaurantLocation.brand_id == brand_id,
                    RestaurantLocation.status == RestaurantLocation.STATUS_ACTIVE,
                )
                .order_by(func.lower(RestaurantLocation.city), RestaurantLocation.id)
            )
        )
        .scalars()
        .all()
    )
    ids = [row.id for row in rows]
    hours_by_location = await hours_service.get_hours_map_for_locations(db, ids)
    covers = await photo_service.get_cover_photos_bulk(db, ids)
    deals_by_location = await deal_service.get_active_deals_map(db, ids)

    cards: list[BrandLocationCardOut] = []
    for row in rows:
        today = hours_service.today_weekday(row.timezone)
        today_row = next(
            (h for h in hours_by_location.get(row.id, []) if h.day_of_week == today), None
        )
        status = hours_service.compute_today_status(today_row, row.timezone)
        cover = covers.get(row.id)
        cards.append(
            BrandLocationCardOut(
                location_id=row.id,
                slug=row.slug,
                location_name=row.location_name,
                distance_mi=None,
                address_line1=row.address_line1,
                city=row.city,
                state=row.state,
                postal_code=row.postal_code,
                phone=row.phone,
                is_verified=row.is_verified,
                is_paid=row.is_paid,
                is_open_now=status.is_open_now,
                open_time=status.open_time,
                close_time=status.close_time,
                is_closed=status.is_closed,
                has_deal_today=any(
                    deal_service.deal_matches_today(d, row.timezone)
                    for d in deals_by_location.get(row.id, [])
                ),
                cover_photo_url=s3_service.resolve_media_url(cover.s3_key) if cover else None,
                cover_photo_thumbnail_url=(
                    s3_service.resolve_media_url(cover.thumbnail_s3_key or cover.s3_key)
                    if cover
                    else None
                ),
            )
        )
    return cards


async def get_public_restaurant_by_slug(db: AsyncSession, brand_slug: str) -> RestaurantPublicOut:
    """`GET /restaurants/by-slug/{brand_slug}` — public. The brand plus its
    ACTIVE locations (one round trip for the public brand page). A
    nonexistent or soft-deleted brand is a 404 for everyone, admin included
    (same as `get_restaurant`); a brand with no active location is still
    returned, with `locations: []`."""
    brand = await _brand_by_slug(db, brand_slug)
    if brand is None or brand.deleted_at is not None:
        raise AppError(404, "Restaurant not found", "not_found")
    base = await _brand_to_out(db, brand)
    return RestaurantPublicOut(
        **base.model_dump(), locations=await _active_location_cards(db, brand.id)
    )


async def get_location_page_by_slugs(
    db: AsyncSession, brand_slug: str, location_slug: str, current_user=None
) -> LocationPageOut:
    """`GET /restaurants/by-slug/{brand_slug}/locations/{location_slug}` —
    public, viewer-aware. Resolves (brand slug, location slug) to a location
    id, then applies EXACTLY the visibility gate of `GET /locations/{id}`
    (`location_service.get_location`): 404 for an unknown pair, a soft-deleted
    brand (admin excepted), or a hidden location the caller has no access to
    (owner/admin/assigned manager may preview it) — never a 403, so a caller
    can't tell "hidden" from "doesn't exist"."""
    brand = await _brand_by_slug(db, brand_slug)
    if brand is None:
        raise AppError(404, "Location not found", "not_found")
    location_id = (
        await db.execute(
            select(RestaurantLocation.id).where(
                RestaurantLocation.brand_id == brand.id, RestaurantLocation.slug == location_slug
            )
        )
    ).scalar_one_or_none()
    if location_id is None:
        raise AppError(404, "Location not found", "not_found")
    location: LocationOut = await location_service.get_location(db, location_id, current_user)
    return LocationPageOut(restaurant=await _brand_to_out(db, brand), location=location)


async def list_public_location_index(
    db: AsyncSession, pagination: Pagination
) -> PublicLocationIndexResponse:
    """`GET /sitemap/locations` — every ACTIVE location of every live brand,
    one row each, in (brand id, location id) order, with the brand's
    active-location count (a window count over the filtered rows, so it is
    right even when a brand straddles a page boundary)."""
    live_brands = select(RestaurantBrand.id).where(RestaurantBrand.deleted_at.is_(None))
    filters = (
        RestaurantLocation.status == RestaurantLocation.STATUS_ACTIVE,
        RestaurantLocation.brand_id.in_(live_brands),
    )
    total = (
        await db.execute(select(func.count()).select_from(RestaurantLocation).where(*filters))
    ).scalar_one()
    rows = (
        await db.execute(
            select(
                RestaurantBrand.slug,
                RestaurantLocation.slug,
                func.count().over(partition_by=RestaurantLocation.brand_id),
                RestaurantLocation.updated_at,
            )
            .join(RestaurantBrand, RestaurantBrand.id == RestaurantLocation.brand_id)
            .where(*filters)
            .order_by(RestaurantLocation.brand_id, RestaurantLocation.id)
            .offset(pagination.offset)
            .limit(pagination.page_size)
        )
    ).all()
    return PublicLocationIndexResponse(
        results=[
            PublicLocationIndexItem(
                brand_slug=brand_slug,
                location_slug=location_slug,
                active_location_count=count,
                updated_at=updated_at,
            )
            for brand_slug, location_slug, count, updated_at in rows
        ],
        page=pagination.page,
        page_size=pagination.page_size,
        total=total,
    )


async def get_brand_or_404(
    db: AsyncSession, brand_id: int, *, include_deleted: bool = False
) -> RestaurantBrand:
    """`include_deleted=False` (default): a soft-deleted brand 404s, same
    as a nonexistent one — every owner/manager write path goes through here.
    Only the admin delete/restore actions pass `include_deleted=True`."""
    brand = await db.get(RestaurantBrand, brand_id)
    if brand is None or (brand.deleted_at is not None and not include_deleted):
        raise AppError(404, "Restaurant not found", "not_found")
    return brand


async def list_restaurants(
    db: AsyncSession,
    current_user,
    owner_id_param: int | None,
    pagination: Pagination,
    *,
    owner_email: str | None = None,
    name: str | None = None,
    status: str | None = None,
    is_paid: bool | None = None,
    city: str | None = None,
    is_claimed: bool | None = None,
    sort: str | None = None,
) -> RestaurantListResponse:
    """`GET /restaurants` — docs/API_CONTRACTS.md "Owner-scoped restaurant
    list". Auth is owner or admin (`require_owner_or_admin`).

    Security-sensitive: an owner caller is hard-filtered server-side to
    their own `owner_id` — `owner_id_param` is only ever consulted for an
    admin caller. There is deliberately no code path where a non-admin
    caller's `owner_id_param` reaches the query, no matter what value is
    passed (docs/API_CONTRACTS.md: "No query param can widen this — never
    trust a client-supplied owner filter for a non-admin caller").

    `owner_email`/`name`/`status`/`is_paid`/`city`/`is_claimed` (added for
    the admin listings management page) follow the exact same
    admin-only rule: every one of them is silently ignored for a
    non-admin caller, same as `owner_id_param` above — an owner's list
    stays exactly "my own brands," never narrowed or widened by a filter
    param meant for the admin moderation UI. All provided filters combine
    with AND, matching `search_service`'s "independent facets AND
    together" convention (docs/API_CONTRACTS.md "GET /search").

    `sort` (added for the admin listings "Most followed" control,
    docs/API_CONTRACTS.md "GET /restaurants"): omitted keeps the existing
    default order (`restaurant_brand.id` ascending, unchanged).
    `sort="followers"` orders by follower count descending, ties broken by
    `id` ascending. No extra role gating beyond this endpoint's existing
    `require_owner_or_admin` — an owner sorting their own (owner-filtered)
    list by followers is no more sensitive than the `follower_count` field
    itself, which they already see for their own brands.
    """
    if current_user.role == "admin":
        effective_owner_id = owner_id_param
    else:
        effective_owner_id = current_user.owner_account_id
        owner_email = name = status = is_paid = city = is_claimed = None

    filters = []
    if effective_owner_id is not None:
        filters.append(RestaurantBrand.owner_id == effective_owner_id)

    # Soft-deleted listings (migration 0011) are hidden from every list by
    # default — the owner console never sees them, and neither does the
    # default admin view. `status="deleted"` (admin only — `status` is
    # already forced to None above for a non-admin caller) flips this to
    # "only deleted listings," which is how the admin panel finds one to
    # restore. It is a pseudo-status: it is NOT a `restaurant_location.status`
    # value, so it must not reach the location-status filter below.
    if status == DELETED_STATUS_FILTER:
        filters.append(RestaurantBrand.deleted_at.is_not(None))
        status = None
    else:
        filters.append(RestaurantBrand.deleted_at.is_(None))

    if owner_email:
        pattern = "%" + _escape_like(owner_email.strip()) + "%"
        filters.append(
            RestaurantBrand.owner_id.in_(
                select(OwnerAccount.id).where(OwnerAccount.email.ilike(pattern, escape="\\"))
            )
        )

    if name:
        pattern = "%" + _escape_like(name.strip()) + "%"
        filters.append(RestaurantBrand.name.ilike(pattern, escape="\\"))

    if is_claimed is not None:
        filters.append(RestaurantBrand.is_claimed == is_claimed)

    # status/is_paid/city all live on restaurant_location, not
    # restaurant_brand, and a brand can have several locations — each
    # matches a brand if ANY of its locations satisfies the filter
    # (documented judgment call, docs/API_CONTRACTS.md "GET /restaurants":
    # a brand with locations in both Plano and Dallas matches
    # `city=plano` AND `city=dallas` as two separate requests, same "any
    # location" rule `is_paid`/`status` use here).
    if status is not None:
        filters.append(
            RestaurantBrand.id.in_(
                select(RestaurantLocation.brand_id).where(RestaurantLocation.status == status)
            )
        )

    if is_paid is not None:
        filters.append(
            RestaurantBrand.id.in_(
                select(RestaurantLocation.brand_id).where(RestaurantLocation.is_paid == is_paid)
            )
        )

    if city:
        filters.append(
            RestaurantBrand.id.in_(
                select(RestaurantLocation.brand_id).where(
                    func.lower(RestaurantLocation.city) == city.strip().lower()
                )
            )
        )

    total = (
        await db.execute(select(func.count()).select_from(RestaurantBrand).where(*filters))
    ).scalar_one()

    # Default order stays `RestaurantBrand.id` ascending (unchanged).
    # `sort="followers"` adds a correlated per-brand follower-count
    # subquery, descending, with `id` as the stable tiebreak — same
    # `count(user_follow) WHERE brand_id = ...` query
    # `follow_service.count_followers_for_brand` runs per-brand, just
    # inlined as a scalar subquery so it can drive ORDER BY directly
    # instead of N+1 Python-side sorting after the fact.
    order_by_clauses = [RestaurantBrand.id]
    if sort == "followers":
        follower_count_expr = (
            select(func.count())
            .select_from(UserFollow)
            .where(UserFollow.brand_id == RestaurantBrand.id)
            .correlate(RestaurantBrand)
            .scalar_subquery()
        )
        order_by_clauses = [follower_count_expr.desc(), RestaurantBrand.id]

    rows = (
        await db.execute(
            select(RestaurantBrand)
            .where(*filters)
            .order_by(*order_by_clauses)
            .offset(pagination.offset)
            .limit(pagination.page_size)
        )
    ).scalars().all()

    results = [await _brand_to_out(db, row, current_user) for row in rows]

    return RestaurantListResponse(
        results=results, page=pagination.page, page_size=pagination.page_size, total=total
    )


async def create_restaurant(db: AsyncSession, body: RestaurantCreate, current_user) -> RestaurantOut:
    owner = await auth_service.get_or_create_owner_account(
        db, current_user.cognito_sub, current_user.email
    )
    base_slug = slugify(body.name)
    slug = await _unique_slug(db, base_slug)

    brand = RestaurantBrand(
        owner_id=owner.id,
        name=body.name,
        slug=slug,
        description=body.description,
        website=body.website,
        is_claimed=True,
        claimed_at=datetime.now(timezone.utc),
    )
    db.add(brand)
    await db.flush()

    if body.cuisine_tag_ids:
        await cuisine_service.set_brand_cuisine_tags(db, brand.id, body.cuisine_tag_ids)

    await audit_service.log(
        db,
        table_name="restaurant_brand",
        record_id=brand.id,
        action="create",
        actor_id=current_user.cognito_sub,
        actor_role="owner",
        old_val=None,
        new_val={"name": brand.name, "slug": brand.slug, "owner_id": brand.owner_id},
    )

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise AppError(409, "A restaurant with a conflicting slug already exists", "slug_conflict")

    # `current_user` passed through — they're the owner who just created
    # this brand (require_owner), so they're always entitled to see its
    # follower_count (0, for a brand-new brand) same as the owner-scoped
    # list. See `_caller_may_view_follower_count`.
    return await _brand_to_out(db, brand, current_user)


async def update_restaurant(
    db: AsyncSession, brand_id: int, body: RestaurantUpdate, current_user
) -> RestaurantOut:
    brand = await get_brand_or_404(db, brand_id)

    old_val = {"name": brand.name, "description": brand.description, "website": brand.website}

    if body.name is not None:
        brand.name = body.name
    if body.description is not None:
        brand.description = body.description
    if body.website is not None:
        brand.website = body.website
    if body.cuisine_tag_ids is not None:
        await cuisine_service.set_brand_cuisine_tags(db, brand.id, body.cuisine_tag_ids)

    new_val = {"name": brand.name, "description": brand.description, "website": brand.website}

    await audit_service.log(
        db,
        table_name="restaurant_brand",
        record_id=brand.id,
        action="update",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=old_val,
        new_val=new_val,
    )
    await db.commit()
    # `current_user` passed through — `require_brand_write_access` already
    # verified they own this exact brand (or are admin), same reasoning as
    # `create_restaurant` above.
    return await _brand_to_out(db, brand, current_user)


async def delete_restaurant(db: AsyncSession, brand_id: int, current_user) -> None:
    """`DELETE /restaurants/{id}` — admin only. SOFT delete (docs/API_CONTRACTS.md
    "DELETE /restaurants/{id}"): stamps `restaurant_brand.deleted_at`, keeps
    the row (slug stays reserved), and deactivates the brand's locations —
    all in ONE transaction, so a failure part-way leaves nothing half-done.

    Which locations change: every `active` location is set to
    `owner_deactivated` — the one self-service, freely-reversible hidden
    status (app/models/restaurant_location.py "Location status lifecycle"),
    exactly what `delete_location` / the `is_active=False` setter already
    produce. Locations already hidden are LEFT ALONE, deliberately:
    `closed_pending_reopen` must keep requiring an admin-approved reopen (a
    bulk overwrite here would let the owner sidestep that after a restore)
    and `coming_soon` keeps its meaning. They are hidden anyway — every read
    path also checks the brand's `deleted_at`.

    Audit (root CLAUDE.md "ALWAYS write an audit_log entry"): one
    `restaurant_brand` row plus one `restaurant_location` row per location
    actually changed, actor = the admin.

    Idempotent: deleting an already-deleted brand is a no-op 204 (no second
    audit row, `deleted_at` not re-stamped). Never 409s — the old
    "locations attached" refusal is gone.
    """
    brand = await get_brand_or_404(db, brand_id, include_deleted=True)
    if brand.deleted_at is not None:
        return

    now = datetime.now(timezone.utc)
    brand.deleted_at = now

    active_locations = (
        (
            await db.execute(
                select(RestaurantLocation)
                .where(
                    RestaurantLocation.brand_id == brand.id,
                    RestaurantLocation.status == RestaurantLocation.STATUS_ACTIVE,
                )
                .order_by(RestaurantLocation.id)
            )
        )
        .scalars()
        .all()
    )
    for location in active_locations:
        location.status = RestaurantLocation.STATUS_OWNER_DEACTIVATED
        await audit_service.log(
            db,
            table_name="restaurant_location",
            record_id=location.id,
            action="update",
            actor_id=current_user.cognito_sub,
            actor_role=current_user.role,
            old_val={"status": RestaurantLocation.STATUS_ACTIVE},
            new_val={
                "status": RestaurantLocation.STATUS_OWNER_DEACTIVATED,
                "reason": "brand_deleted",
            },
        )

    await audit_service.log(
        db,
        table_name="restaurant_brand",
        record_id=brand.id,
        action="update",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val={"deleted_at": None},
        new_val={
            "deleted_at": now.isoformat(),
            "locations_deactivated": [loc.id for loc in active_locations],
        },
    )
    await db.commit()


async def restore_restaurant(db: AsyncSession, brand_id: int, current_user) -> RestaurantOut:
    """`POST /restaurants/{id}/restore` — admin only. Clears `deleted_at`.

    The brand's locations are NOT reactivated: they stay `owner_deactivated`
    (or whatever they were) until re-enabled through their normal path
    (`POST /locations/{id}/status`), so restoring a listing never silently
    republishes locations the admin hasn't looked at. Idempotent on an
    already-live brand (no audit row, returns the brand). Slug is unchanged
    (it was reserved the whole time).
    """
    brand = await get_brand_or_404(db, brand_id, include_deleted=True)
    if brand.deleted_at is not None:
        old_deleted_at = brand.deleted_at
        brand.deleted_at = None
        await audit_service.log(
            db,
            table_name="restaurant_brand",
            record_id=brand.id,
            action="update",
            actor_id=current_user.cognito_sub,
            actor_role=current_user.role,
            old_val={"deleted_at": old_deleted_at.isoformat()},
            new_val={"deleted_at": None},
        )
        await db.commit()
    return await _brand_to_out(db, brand, current_user)
