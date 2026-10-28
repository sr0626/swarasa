"""Public city index + per-city location listing — powers the SEO city landing
pages (`/indian-restaurants/{city-slug}`). See docs/API_CONTRACTS.md "Cities".

VISIBILITY: identical to /search and /sitemap/locations — `status = 'active'`
(so owner_deactivated / coming_soon / closed_pending_reopen are all excluded)
AND the brand is not soft-deleted.

CITY SLUG RULES (judgment call, flagged in the PR):
  * slug = the city name lower-cased, ASCII-folded, runs of non-alphanumerics
    collapsed to one hyphen ("Fort Worth" -> "fort-worth"). Case/whitespace/
    state-case variants of the same city ("Irving", "IRVING", state "tx")
    merge into ONE city.
  * Collisions: when the same slug exists in more than one state (Springfield
    IL vs MO), EVERY colliding city gets the lower-cased state appended
    ("springfield-il", "springfield-mo") so each URL is unambiguous. A city
    that doesn't collide keeps the plain slug — so today's DFW slugs
    ("irving", "plano") are stable until a second state shows up.
  * No schema change / index: the city list is one GROUP BY over the active
    locations (hundreds of rows at Phase 1 scale, like search's in-Python
    grouping); the per-city listing filters on the exact raw (city, state)
    spellings that resolved to the slug.
"""
from __future__ import annotations

import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.schemas.city import CityListResponse, CityOut, CityRestaurantsResponse
from app.schemas.cuisine import CuisineTagOut
from app.schemas.search import NearestLocationOut, SearchResultOut
from app.services import cuisine_service, deal_service, hours_service, photo_service, s3_service

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def slugify_city(city: str) -> str:
    """'Fort Worth' -> 'fort-worth'. Empty string when nothing alphanumeric."""
    folded = unicodedata.normalize("NFKD", city).encode("ascii", "ignore").decode("ascii")
    return _NON_ALNUM.sub("-", folded.lower()).strip("-")


@dataclass
class _CityGroup:
    slug: str = ""
    state: str = ""
    count: int = 0
    # Raw spellings seen in the DB (used to filter the per-city listing) and
    # how many locations use each (the most common becomes the display name).
    raw_cities: Counter = field(default_factory=Counter)
    raw_states: set[str] = field(default_factory=set)


def _visible_filters():
    return (
        RestaurantLocation.status == RestaurantLocation.STATUS_ACTIVE,
        RestaurantLocation.brand_id.in_(
            select(RestaurantBrand.id).where(RestaurantBrand.deleted_at.is_(None))
        ),
    )


async def _load_city_groups(db: AsyncSession) -> list[_CityGroup]:
    rows = (
        await db.execute(
            select(RestaurantLocation.city, RestaurantLocation.state, func.count())
            .where(*_visible_filters())
            .group_by(RestaurantLocation.city, RestaurantLocation.state)
        )
    ).all()

    # 1) merge spelling/case variants of the same (slug, STATE).
    merged: dict[tuple[str, str], _CityGroup] = {}
    for raw_city, raw_state, count in rows:
        base = slugify_city(raw_city or "")
        if not base:
            continue
        state = (raw_state or "").strip().upper()
        group = merged.setdefault((base, state), _CityGroup(slug=base, state=state))
        group.count += count
        group.raw_cities[raw_city] += count
        group.raw_states.add(raw_state)

    # 2) a slug shared by several states gets the state suffix on each.
    states_per_slug: dict[str, set[str]] = defaultdict(set)
    for base, state in merged:
        states_per_slug[base].add(state)
    groups: list[_CityGroup] = []
    for (base, state), group in merged.items():
        if len(states_per_slug[base]) > 1:
            suffix = slugify_city(state)
            group.slug = f"{base}-{suffix}" if suffix else base
        groups.append(group)

    groups.sort(key=lambda g: (-g.count, g.raw_cities.most_common(1)[0][0].lower(), g.slug))
    return groups


def _city_out(group: _CityGroup) -> CityOut:
    return CityOut(
        slug=group.slug,
        city=group.raw_cities.most_common(1)[0][0].strip(),
        state=group.state,
        location_count=group.count,
    )


async def list_cities(db: AsyncSession, pagination) -> CityListResponse:
    groups = await _load_city_groups(db)
    page = groups[pagination.offset : pagination.offset + pagination.page_size]
    return CityListResponse(
        results=[_city_out(g) for g in page],
        page=pagination.page,
        page_size=pagination.page_size,
        total=len(groups),
    )


async def list_city_restaurants(db: AsyncSession, slug: str, pagination) -> CityRestaurantsResponse:
    group = next((g for g in await _load_city_groups(db) if g.slug == slug), None)
    if group is None:
        # Unknown slug (or a city with no publicly visible location) -> real 404.
        raise AppError(404, "City not found", "not_found")

    filters = (
        *_visible_filters(),
        RestaurantLocation.city.in_(list(group.raw_cities)),
        RestaurantLocation.state.in_(list(group.raw_states)),
    )
    # Brand's TOTAL active-location count (over ALL its visible locations, not
    # just this city) — see CityRestaurantsResponse.
    brand_total = (
        select(
            RestaurantLocation.brand_id.label("brand_id"),
            func.count().label("n"),
        )
        .where(*_visible_filters())
        .group_by(RestaurantLocation.brand_id)
        .subquery()
    )
    rows = (
        await db.execute(
            select(RestaurantLocation, RestaurantBrand, brand_total.c.n)
            .join(RestaurantBrand, RestaurantBrand.id == RestaurantLocation.brand_id)
            .join(brand_total, brand_total.c.brand_id == RestaurantLocation.brand_id)
            .where(*filters)
            # Neutral, stable order: verified first, then name. Deliberately
            # NOT paid-first: promoted placement is a deferred paid feature.
            .order_by(
                RestaurantLocation.is_verified.desc(),
                func.lower(RestaurantBrand.name),
                RestaurantLocation.id,
            )
            .offset(pagination.offset)
            .limit(pagination.page_size)
        )
    ).all()

    location_ids = [loc.id for loc, _brand, _n in rows]
    tags_by_location = await cuisine_service.get_location_cuisine_tags_bulk(db, location_ids)
    covers = await photo_service.get_cover_photos_bulk(db, location_ids)
    hours_map = await hours_service.get_hours_map_for_locations(db, location_ids)
    deals_map = await deal_service.get_active_deals_map(db, location_ids)

    results: list[SearchResultOut] = []
    for loc, brand, brand_count in rows:
        weekday = hours_service.today_weekday(loc.timezone)
        today_row = next((h for h in hours_map.get(loc.id, []) if h.day_of_week == weekday), None)
        today = hours_service.compute_today_status(today_row, loc.timezone)
        cover = covers.get(loc.id)
        results.append(
            SearchResultOut(
                brand_id=brand.id,
                name=brand.name,
                slug=brand.slug,
                is_claimed=brand.is_claimed,
                cuisine_tags=[
                    CuisineTagOut.model_validate(t) for t in tags_by_location.get(loc.id, [])
                ],
                nearest_location=NearestLocationOut(
                    location_id=loc.id,
                    slug=loc.slug,
                    distance_mi=None,
                    address_line1=loc.address_line1,
                    city=loc.city,
                    state=loc.state,
                    postal_code=loc.postal_code,
                    phone=loc.phone,
                    is_verified=loc.is_verified,
                    is_paid=loc.is_paid,
                    is_open_now=today.is_open_now,
                    open_time=today.open_time,
                    close_time=today.close_time,
                    is_closed=today.is_closed,
                    opens_later_today=today.opens_later_today,
                    # Content-free signal only (same rule as /search tiles).
                    has_deal_today=any(
                        deal_service.deal_matches_today(d, loc.timezone)
                        for d in deals_map.get(loc.id, [])
                    ),
                ),
                location_count_nearby=brand_count,
                cover_photo_url=s3_service.resolve_media_url(cover.s3_key) if cover else None,
                cover_photo_thumbnail_url=(
                    s3_service.resolve_media_url(cover.thumbnail_s3_key or cover.s3_key)
                    if cover
                    else None
                ),
            )
        )

    return CityRestaurantsResponse(
        city=_city_out(group),
        results=results,
        page=pagination.page,
        page_size=pagination.page_size,
        total=group.count,
    )
