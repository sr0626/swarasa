"""GET /search — PostGIS geo search, brand-level grouped results.

See docs/API_CONTRACTS.md "GET /search" for the exact response shape and
DECISIONS.md "Brand-level search results", "Search default sort", "Default
search radius: 15 miles".

JUDGMENT CALL (flagged for review): `docs/API_CONTRACTS.md` says an
omitted lat/lng "falls back to the admin-configured DFW city bounding
box", but no such admin-configurable bounding-box table/row exists
anywhere in `docs/DATA_MODEL.md`'s Phase 1 schema (that's Architect's to
add, not something Backend Dev can create — root CLAUDE.md "NEVER touch
/backend/app/models"). Falls back to a hardcoded DFW center point (Dallas,
TX) instead — functionally equivalent for a single-city Phase 1 launch,
but not admin-configurable yet. Flag to Architect if a real
admin-configurable default is wanted before Phase 2.

Grouping/sorting is done in Python after one filtered/geo-scoped location
query, not in SQL — acceptable at Phase 1 scale (~500 seeded restaurants,
DECISIONS.md "Data seeding"; "dozens of concurrent users") and keeps the
brand-rollup logic readable. Revisit with a SQL-side window function if
volume grows.
"""
from __future__ import annotations

from dataclasses import dataclass

from geoalchemy2.functions import ST_DWithin, ST_Distance, ST_MakePoint, ST_SetSRID
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_cuisine import RestaurantCuisine
from app.models.cuisine_tag import CuisineTag
from app.models.restaurant_location import RestaurantLocation
from app.schemas.cuisine import CuisineTagOut
from app.schemas.search import NearestLocationOut, SearchResultOut
from app.services import cuisine_service, deal_service, hours_service, photo_service, s3_service

_METERS_PER_MILE = 1609.34

# DFW default fallback (Dallas, TX city center) — see module docstring
# judgment call. No admin-configurable bounding box exists in the Phase 1
# schema.
_DEFAULT_LAT = 32.7767
_DEFAULT_LNG = -96.7970


def _escape_like(value: str) -> str:
    """Escapes LIKE wildcards so a user typing `%` or `_` matches literally."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _distance_key(distance_mi: float | None) -> float:
    """Sort key: a location with no coordinates sorts after every located one."""
    return float("inf") if distance_mi is None else distance_mi


@dataclass
class _CandidateRow:
    location_id: int
    brand_id: int
    address_line1: str
    city: str
    state: str
    postal_code: str
    phone: str | None
    is_verified: bool
    is_paid: bool
    timezone: str
    # None for a location with no coordinates -- only ever returned for a
    # text (`q`) search, which does not require a geocoded location.
    distance_mi: float | None


async def _fetch_candidates(
    db: AsyncSession,
    lat: float,
    lng: float,
    radius_mi: float,
    cuisine: list[str] | None,
    dietary: list[str] | None,
    type_: list[str] | None,
    q: str | None = None,
) -> list[_CandidateRow]:
    point = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
    radius_m = radius_mi * _METERS_PER_MILE
    distance_expr = ST_Distance(RestaurantLocation.geom, point) / _METERS_PER_MILE

    stmt = (
        select(
            RestaurantLocation.id.label("location_id"),
            RestaurantLocation.brand_id,
            RestaurantLocation.address_line1,
            RestaurantLocation.city,
            RestaurantLocation.state,
            RestaurantLocation.postal_code,
            RestaurantLocation.phone,
            RestaurantLocation.is_verified,
            RestaurantLocation.is_paid,
            RestaurantLocation.timezone,
            distance_expr.label("distance_mi"),
        )
        # Excludes every hidden status (owner_deactivated/coming_soon/
        # closed_pending_reopen), not just an old plain "inactive" flag —
        # app/models/restaurant_location.py "Location status lifecycle".
        # `RestaurantLocation.is_active` is a hybrid property equivalent to
        # `status == 'active'`, so this filter is unchanged in SQL and
        # correct against the new 4-state model with no edit required —
        # verified via the model's own hybrid `.expression`, not assumed.
        .where(RestaurantLocation.is_active == True)  # noqa: E712
        # Belt-and-suspenders for soft-deleted brands (`deleted_at`): a
        # brand delete already deactivates its locations, but a location
        # re-enabled while its brand is still deleted must not resurface.
        .where(
            RestaurantLocation.brand_id.in_(
                select(RestaurantBrand.id).where(RestaurantBrand.deleted_at.is_(None))
            )
        )
    )
    if q:
        # Text search (restaurant name; or a cuisine tag whose name EXACTLY
        # equals the text, e.g. "hyderabadi") deliberately
        # does NOT require coordinates or a radius: someone typing a
        # restaurant's name expects to find it wherever it is, and a
        # location that failed geocoding would otherwise be unfindable even
        # by its exact name. Such rows come back with distance_mi = NULL.
        needle = q.strip()
        pattern = "%" + _escape_like(needle) + "%"
        matching_brands = select(RestaurantBrand.id).where(
            RestaurantBrand.name.ilike(pattern, escape="\\")
        )
        matching_tag_brands = (
            select(RestaurantCuisine.brand_id)
            .join(CuisineTag, CuisineTag.id == RestaurantCuisine.cuisine_tag_id)
            .where(
                or_(
                    func.lower(CuisineTag.display_name) == needle.lower(),
                    func.lower(CuisineTag.name) == needle.lower(),
                )
            )
        )
        stmt = stmt.where(
            or_(
                RestaurantLocation.brand_id.in_(matching_brands),
                RestaurantLocation.brand_id.in_(matching_tag_brands),
            )
        )
    else:
        stmt = stmt.where(RestaurantLocation.geom.isnot(None)).where(
            ST_DWithin(RestaurantLocation.geom, point, radius_m)
        )

    # cuisine[]/dietary[]/type[] are independent facets — AND across
    # provided facets, OR within a facet's own tag list (docs/API_CONTRACTS.md
    # "GET /search" query params). All join through the brand-level
    # restaurant_cuisine table (tags are brand-level, not per-location —
    # docs/DATA_MODEL.md "restaurant_cuisine" judgment call).
    for names in (cuisine, dietary, type_):
        if names:
            stmt = stmt.where(
                RestaurantLocation.brand_id.in_(
                    select(RestaurantCuisine.brand_id)
                    .join(CuisineTag, CuisineTag.id == RestaurantCuisine.cuisine_tag_id)
                    .where(CuisineTag.name.in_(names))
                )
            )

    result = await db.execute(stmt)
    return [_CandidateRow(**row._mapping) for row in result.all()]


@dataclass
class _BrandCard:
    brand: RestaurantBrand
    nearest: _CandidateRow
    location_count_nearby: int


async def search(
    db: AsyncSession,
    lat: float | None,
    lng: float | None,
    radius_mi: float,
    cuisine: list[str] | None,
    dietary: list[str] | None,
    type_: list[str] | None,
    pagination,
    q: str | None = None,
    has_deals_today: bool | None = None,
) -> tuple[list[SearchResultOut], int]:
    effective_lat = lat if lat is not None else _DEFAULT_LAT
    effective_lng = lng if lng is not None else _DEFAULT_LNG

    candidates = await _fetch_candidates(
        db, effective_lat, effective_lng, radius_mi, cuisine, dietary, type_, q
    )
    if not candidates:
        return [], 0

    # Deals — bulk-fetched once for every candidate location (not just the
    # eventual "nearest per brand" subset), because the `has_deals_today`
    # filter below is brand-level: "ANY of this brand's candidate
    # locations has an active deal matching today," not just its nearest
    # one (docs/API_CONTRACTS.md "GET /search" "has_deals_today"). Public
    # content is never exposed here — only the boolean is ever surfaced on
    # a search card (see NearestLocationOut.has_deal_today); see
    # app/services/deal_service.py for the content-gated path used by
    # `GET /locations/{id}` instead.
    deals_by_location = await deal_service.get_active_deals_map(
        db, [row.location_id for row in candidates]
    )
    has_deal_today_by_location: dict[int, bool] = {
        row.location_id: any(
            deal_service.deal_matches_today(d, row.timezone)
            for d in deals_by_location.get(row.location_id, [])
        )
        for row in candidates
    }

    by_brand: dict[int, list[_CandidateRow]] = {}
    for row in candidates:
        by_brand.setdefault(row.brand_id, []).append(row)

    if has_deals_today:
        by_brand = {
            brand_id: rows
            for brand_id, rows in by_brand.items()
            if any(has_deal_today_by_location[row.location_id] for row in rows)
        }
        if not by_brand:
            return [], 0

    brand_ids = list(by_brand.keys())
    brands_result = await db.execute(select(RestaurantBrand).where(RestaurantBrand.id.in_(brand_ids)))
    brands_by_id = {b.id: b for b in brands_result.scalars().all()}

    cards: list[_BrandCard] = []
    for brand_id, rows in by_brand.items():
        brand = brands_by_id.get(brand_id)
        if brand is None:
            continue
        nearest = min(rows, key=lambda r: _distance_key(r.distance_mi))
        cards.append(_BrandCard(brand=brand, nearest=nearest, location_count_nearby=len(rows)))

    # Default sort: paid first, then verified, then distance, then
    # alphabetical (DECISIONS.md "Search default sort"). Paid placement is
    # labeled "Featured" on the card, per the BRD's promoted-placement rule.
    cards.sort(
        key=lambda c: (
            not c.nearest.is_paid,
            not c.nearest.is_verified,
            _distance_key(c.nearest.distance_mi),
            c.brand.name.lower(),
        )
    )

    total = len(cards)
    start = pagination.offset
    end = start + pagination.page_size
    page_cards = cards[start:end]

    tags_by_brand = await cuisine_service.get_brand_cuisine_tags_bulk(
        db, [c.brand.id for c in page_cards]
    )

    results: list[SearchResultOut] = []
    for card in page_cards:
        nearest = card.nearest
        today = await hours_service.today_status_for_location(
            db, nearest.location_id, nearest.timezone
        )
        cover = await photo_service.get_cover_photo(db, nearest.location_id)
        results.append(
            SearchResultOut(
                brand_id=card.brand.id,
                name=card.brand.name,
                slug=card.brand.slug,
                is_claimed=card.brand.is_claimed,
                cuisine_tags=[
                    CuisineTagOut.model_validate(t) for t in tags_by_brand.get(card.brand.id, [])
                ],
                nearest_location=NearestLocationOut(
                    location_id=nearest.location_id,
                    distance_mi=round(nearest.distance_mi, 2) if nearest.distance_mi is not None else None,
                    address_line1=nearest.address_line1,
                    city=nearest.city,
                    state=nearest.state,
                    postal_code=nearest.postal_code,
                    phone=nearest.phone,
                    is_verified=nearest.is_verified,
                    is_paid=nearest.is_paid,
                    is_open_now=today.is_open_now,
                    open_time=today.open_time,
                    close_time=today.close_time,
                    is_closed=today.is_closed,
                    has_deal_today=has_deal_today_by_location[nearest.location_id],
                ),
                location_count_nearby=card.location_count_nearby,
                cover_photo_url=s3_service.resolve_media_url(cover.s3_key) if cover else None,
                cover_photo_thumbnail_url=(
                    s3_service.resolve_media_url(cover.thumbnail_s3_key or cover.s3_key)
                    if cover
                    else None
                ),
            )
        )

    return results, total
