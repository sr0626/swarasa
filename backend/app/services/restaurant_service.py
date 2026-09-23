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
from app.schemas.cuisine import CuisineTagOut
from app.schemas.restaurant import (
    RestaurantCreate,
    RestaurantListResponse,
    RestaurantOut,
    RestaurantUpdate,
)
from app.services import audit_service, auth_service, cuisine_service


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


async def _brand_to_out(db: AsyncSession, brand: RestaurantBrand) -> RestaurantOut:
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
    )


async def get_restaurant(db: AsyncSession, id_or_slug: str) -> RestaurantOut:
    """`id_or_slug` resolves either the numeric `restaurant_brand.id` or its
    `slug` (docs/API_CONTRACTS.md "GET /restaurants/{id}"): all-digits ->
    id lookup, otherwise -> slug lookup.
    """
    if id_or_slug.isdigit():
        brand = await db.get(RestaurantBrand, int(id_or_slug))
    else:
        result = await db.execute(select(RestaurantBrand).where(RestaurantBrand.slug == id_or_slug))
        brand = result.scalar_one_or_none()
    if brand is None:
        raise AppError(404, "Restaurant not found", "not_found")
    return await _brand_to_out(db, brand)


async def get_brand_or_404(db: AsyncSession, brand_id: int) -> RestaurantBrand:
    brand = await db.get(RestaurantBrand, brand_id)
    if brand is None:
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
    """
    if current_user.role == "admin":
        effective_owner_id = owner_id_param
    else:
        effective_owner_id = current_user.owner_account_id
        owner_email = name = status = is_paid = city = is_claimed = None

    filters = []
    if effective_owner_id is not None:
        filters.append(RestaurantBrand.owner_id == effective_owner_id)

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

    rows = (
        await db.execute(
            select(RestaurantBrand)
            .where(*filters)
            .order_by(RestaurantBrand.id)
            .offset(pagination.offset)
            .limit(pagination.page_size)
        )
    ).scalars().all()

    results = [await _brand_to_out(db, row) for row in rows]

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

    return await _brand_to_out(db, brand)


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
    return await _brand_to_out(db, brand)


async def delete_restaurant(db: AsyncSession, brand_id: int, current_user) -> None:
    """restaurant_location.brand_id has ON DELETE RESTRICT — the DB refuses
    this delete while any location rows still reference the brand
    (docs/API_CONTRACTS.md "DELETE /restaurants/{id}"). Caught below and
    surfaced as a clean 409 rather than a leaked DB integrity error (root
    CLAUDE.md "NEVER expose internal stack details").
    """
    brand = await get_brand_or_404(db, brand_id)

    await audit_service.log(
        db,
        table_name="restaurant_brand",
        record_id=brand.id,
        action="delete",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val={"name": brand.name, "slug": brand.slug},
        new_val=None,
    )
    await db.delete(brand)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise AppError(
            409,
            "Cannot delete a restaurant that still has locations. Remove or reassign its locations first.",
            "brand_has_locations",
        )
