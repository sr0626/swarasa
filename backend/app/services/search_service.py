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
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_cuisine import RestaurantCuisine
from app.models.cuisine_tag import CuisineTag
from app.models.restaurant_location import RestaurantLocation
from app.schemas.cuisine import CuisineTagOut
from app.schemas.search import NearestLocationOut, SearchResultOut
from app.services import cuisine_service, hours_service, photo_service, s3_service

_METERS_PER_MILE = 1609.34

# DFW default fallback (Dallas, TX city center) — see module docstring
# judgment call. No admin-configurable bounding box exists in the Phase 1
# schema.
_DEFAULT_LAT = 32.7767
_DEFAULT_LNG = -96.7970


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
    distance_mi: float


async def _fetch_candidates(
    db: AsyncSession,
    lat: float,
    lng: float,
    radius_mi: float,
    cuisine: list[str] | None,
    dietary: list[str] | None,
    type_: list[str] | None,
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
        .where(RestaurantLocation.is_active == True)  # noqa: E712
        .where(RestaurantLocation.geom.isnot(None))
        .where(ST_DWithin(RestaurantLocation.geom, point, radius_m))
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
) -> tuple[list[SearchResultOut], int]:
    effective_lat = lat if lat is not None else _DEFAULT_LAT
    effective_lng = lng if lng is not None else _DEFAULT_LNG

    candidates = await _fetch_candidates(
        db, effective_lat, effective_lng, radius_mi, cuisine, dietary, type_
    )
    if not candidates:
        return [], 0

    by_brand: dict[int, list[_CandidateRow]] = {}
    for row in candidates:
        by_brand.setdefault(row.brand_id, []).append(row)

    brand_ids = list(by_brand.keys())
    brands_result = await db.execute(select(RestaurantBrand).where(RestaurantBrand.id.in_(brand_ids)))
    brands_by_id = {b.id: b for b in brands_result.scalars().all()}

    cards: list[_BrandCard] = []
    for brand_id, rows in by_brand.items():
        brand = brands_by_id.get(brand_id)
        if brand is None:
            continue
        nearest = min(rows, key=lambda r: r.distance_mi)
        cards.append(_BrandCard(brand=brand, nearest=nearest, location_count_nearby=len(rows)))

    # Default sort: verified first, then distance, then alphabetical
    # (DECISIONS.md "Search default sort").
    cards.sort(key=lambda c: (not c.nearest.is_verified, c.nearest.distance_mi, c.brand.name.lower()))

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
        is_open_now = await hours_service.is_open_now_for_location(
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
                    distance_mi=round(nearest.distance_mi, 2),
                    address_line1=nearest.address_line1,
                    city=nearest.city,
                    state=nearest.state,
                    postal_code=nearest.postal_code,
                    phone=nearest.phone,
                    is_verified=nearest.is_verified,
                    is_paid=nearest.is_paid,
                    is_open_now=is_open_now,
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
