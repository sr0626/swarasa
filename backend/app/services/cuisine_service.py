"""cuisine_tag / location_cuisine helpers.

Tags are PER LOCATION (docs/DECISIONS.md "Cuisine/dietary tags are per
location", table `location_cuisine`, migration 0016). The old brand-level
`restaurant_cuisine` table is deprecated and never read or written here. No
public write API for `cuisine_tag` itself (admin-panel/seed only, per
`docs/DATA_MODEL.md`) — only the location<->tag link is written here, via
`PUT /locations/{id}/cuisine-tags` (and `POST /locations`, which seeds a new
location's tags).

A brand has no tags of its own. Where a brand-level summary is still shown
(owner/admin listings, the public brand payload, JSON-LD) its `cuisine_tags`
is the UNION of its locations' tags — `get_brand_union_tags_bulk`.
"""
from __future__ import annotations

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.models.cuisine_tag import CuisineTag
from app.models.location_cuisine import LocationCuisine
from app.models.restaurant_location import RestaurantLocation


async def list_active_cuisine_tags(
    db: AsyncSession, category: str | None = None
) -> list[CuisineTag]:
    """`GET /cuisine-tags` (docs/API_CONTRACTS.md) — public read list.
    `is_active=true` rows only; an optional `category` filter narrows to
    one of `cuisine_tag.category`'s valid values. No pagination — see
    `CuisineTagListResponse`.
    """
    filters = [CuisineTag.is_active == True]  # noqa: E712
    if category is not None:
        filters.append(CuisineTag.category == category)
    result = await db.execute(
        select(CuisineTag).where(*filters).order_by(CuisineTag.category, CuisineTag.display_name)
    )
    return list(result.scalars().all())


_TAG_ORDER = (CuisineTag.category, CuisineTag.display_name)


async def get_location_cuisine_tags(db: AsyncSession, location_id: int) -> list[CuisineTag]:
    return (await get_location_cuisine_tags_bulk(db, [location_id])).get(location_id, [])


async def get_location_cuisine_tags_bulk(
    db: AsyncSession, location_ids: list[int]
) -> dict[int, list[CuisineTag]]:
    """One query for any number of locations (no N+1). Every requested id is
    present in the result (empty list when untagged). Ordered by category
    then display name, the same order everywhere tags are shown."""
    by_location: dict[int, list[CuisineTag]] = {lid: [] for lid in location_ids}
    if not location_ids:
        return by_location
    result = await db.execute(
        select(LocationCuisine.location_id, CuisineTag)
        .join(CuisineTag, LocationCuisine.cuisine_tag_id == CuisineTag.id)
        .where(LocationCuisine.location_id.in_(location_ids))
        .order_by(*_TAG_ORDER)
    )
    for location_id, tag in result.all():
        by_location.setdefault(location_id, []).append(tag)
    return by_location


async def get_brand_union_tags_bulk(
    db: AsyncSession, brand_ids: list[int], *, only_active: bool = True
) -> dict[int, list[CuisineTag]]:
    """A brand's `cuisine_tags` summary = the distinct UNION of its
    locations' tags (a brand has no tags of its own any more).

    `only_active=True` (public callers): only ACTIVE locations contribute, so
    a hidden/coming-soon branch never advertises its tags on the public brand
    payload. `only_active=False` (owner/admin callers): every location
    contributes, so a brand still being set up shows its tags in listings.
    One query for all brands.
    """
    by_brand: dict[int, list[CuisineTag]] = {bid: [] for bid in brand_ids}
    if not brand_ids:
        return by_brand
    stmt = (
        select(RestaurantLocation.brand_id, CuisineTag)
        .join(LocationCuisine, LocationCuisine.location_id == RestaurantLocation.id)
        .join(CuisineTag, LocationCuisine.cuisine_tag_id == CuisineTag.id)
        .where(RestaurantLocation.brand_id.in_(brand_ids))
        .distinct()
        .order_by(*_TAG_ORDER)
    )
    if only_active:
        stmt = stmt.where(RestaurantLocation.status == RestaurantLocation.STATUS_ACTIVE)
    for brand_id, tag in (await db.execute(stmt)).all():
        by_brand.setdefault(brand_id, []).append(tag)
    return by_brand


async def get_brand_union_tags(
    db: AsyncSession, brand_id: int, *, only_active: bool = True
) -> list[CuisineTag]:
    return (await get_brand_union_tags_bulk(db, [brand_id], only_active=only_active)).get(
        brand_id, []
    )


def location_has_any_tag(names: list[str]) -> ColumnElement[bool]:
    """SQL predicate: this `restaurant_location` row carries at least one of
    the tags named `names` (`cuisine_tag.name` slugs). Per-LOCATION on
    purpose — `GET /search` and the admin filters must only match the
    branches that actually have the tag, never a sibling branch of the same
    brand."""
    return RestaurantLocation.id.in_(
        select(LocationCuisine.location_id)
        .join(CuisineTag, CuisineTag.id == LocationCuisine.cuisine_tag_id)
        .where(CuisineTag.name.in_(names))
    )


def location_has_tag_named(needle: str) -> ColumnElement[bool]:
    """SQL predicate for the text search: this location carries a tag whose
    `name` or `display_name` EXACTLY equals `needle` (case-insensitive)."""
    lowered = needle.lower()
    return RestaurantLocation.id.in_(
        select(LocationCuisine.location_id)
        .join(CuisineTag, CuisineTag.id == LocationCuisine.cuisine_tag_id)
        .where(
            or_(
                func.lower(CuisineTag.display_name) == lowered,
                func.lower(CuisineTag.name) == lowered,
            )
        )
    )


async def set_location_cuisine_tags(
    db: AsyncSession, location_id: int, tag_ids: list[int]
) -> tuple[list[str], list[str]]:
    """Full replace of ONE location's tag links. Silently ignores ids that
    don't correspond to an active tag (a stale frontend id shouldn't fail the
    whole write) and de-duplicates. Returns `(old_names, new_names)` — the
    sorted `cuisine_tag.name` slugs before/after — for the caller's audit row.
    Flushes but does not commit (the caller owns the transaction)."""
    old_names = sorted(t.name for t in await get_location_cuisine_tags(db, location_id))

    valid: dict[int, str] = {}
    if tag_ids:
        result = await db.execute(
            select(CuisineTag.id, CuisineTag.name).where(
                CuisineTag.id.in_(set(tag_ids)), CuisineTag.is_active == True  # noqa: E712
            )
        )
        valid = {row[0]: row[1] for row in result.all()}

    await db.execute(delete(LocationCuisine).where(LocationCuisine.location_id == location_id))
    for tag_id in dict.fromkeys(tag_ids):
        if tag_id in valid:
            db.add(LocationCuisine(location_id=location_id, cuisine_tag_id=tag_id))
    await db.flush()
    return old_names, sorted(valid.values())


async def copy_first_location_tags(
    db: AsyncSession, brand_id: int, new_location_id: int
) -> list[str]:
    """New-location default: start with a COPY of the tags of the brand's
    first existing location (lowest id, any status, excluding the new one),
    so an owner adding a branch doesn't retype them; empty when there is no
    other location. Returns the copied `cuisine_tag.name` slugs. Flushes, no
    commit."""
    first_id = (
        await db.execute(
            select(RestaurantLocation.id)
            .where(
                RestaurantLocation.brand_id == brand_id,
                RestaurantLocation.id != new_location_id,
            )
            .order_by(RestaurantLocation.id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if first_id is None:
        return []
    tags = [t for t in await get_location_cuisine_tags(db, first_id) if t.is_active]
    for tag in tags:
        db.add(LocationCuisine(location_id=new_location_id, cuisine_tag_id=tag.id))
    await db.flush()
    return sorted(t.name for t in tags)
