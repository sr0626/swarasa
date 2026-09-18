"""Unit test: `app/services/search_service.py`'s brand-rollup / sort /
pagination logic — the parts of GET /search that are plain Python, not
PostGIS SQL.

`_fetch_candidates` (the actual `ST_DWithin` radius query) is monkeypatched
out here with canned `_CandidateRow` data, because that function's SQL only
runs against a real Postgres+PostGIS database — see
tests/integration/test_search_api.py (guarded, needs real Postgres+PostGIS,
not available in this sandbox) for the actual "within 15 miles" / "excludes
beyond radius" behavior. What IS proven here, against the real
`search_service.search()` code, is everything downstream of that SQL query:
brand-level grouping (DECISIONS.md "Brand-level search results"), default
sort (verified desc, distance asc, name asc), and pagination slicing.
"""
from __future__ import annotations

import pytest

from app.dependencies.pagination import Pagination
from app.models.restaurant_brand import RestaurantBrand
from app.services import search_service


class _FakeResult:
    def __init__(self, items):
        self._items = items

    def scalars(self):
        return self

    def all(self):
        return self._items


class _FakeSession:
    """Only ever asked for the brand rollup query in these tests —
    `_fetch_candidates` is monkeypatched out, so no geo SQL is executed."""

    def __init__(self, brands: list[RestaurantBrand]):
        self._brands = brands

    async def execute(self, _stmt):
        return _FakeResult(self._brands)


def _row(**overrides) -> "search_service._CandidateRow":
    defaults = dict(
        location_id=1,
        brand_id=1,
        address_line1="123 Main St",
        city="Plano",
        state="TX",
        postal_code="75024",
        is_verified=False,
        is_paid=False,
        timezone="America/Chicago",
        distance_mi=5.0,
    )
    defaults.update(overrides)
    return search_service._CandidateRow(**defaults)


def _brand(id_: int, name: str) -> RestaurantBrand:
    return RestaurantBrand(id=id_, name=name, slug=name.lower(), is_claimed=True, owner_id=None)


async def _no_tags(db, brand_ids):
    return {bid: [] for bid in brand_ids}


async def _not_open(db, location_id, tz):
    return None


async def _no_cover(db, location_id):
    return None


@pytest.fixture(autouse=True)
def _stub_side_lookups(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(search_service.cuisine_service, "get_brand_cuisine_tags_bulk", _no_tags)
    monkeypatch.setattr(search_service.hours_service, "is_open_now_for_location", _not_open)
    monkeypatch.setattr(search_service.photo_service, "get_cover_photo", _no_cover)


@pytest.mark.asyncio
async def test_no_candidates_returns_empty_without_querying_brands(monkeypatch: pytest.MonkeyPatch):
    async def _empty(*args, **kwargs):
        return []

    monkeypatch.setattr(search_service, "_fetch_candidates", _empty)

    class _ExplodingSession:
        async def execute(self, _stmt):
            raise AssertionError("should not query brands when there are no candidates")

    results, total = await search_service.search(
        _ExplodingSession(), None, None, 15, None, None, None, Pagination(page=1, page_size=20)
    )
    assert results == []
    assert total == 0


@pytest.mark.asyncio
async def test_multiple_locations_same_brand_roll_up_with_nearest_and_count(
    monkeypatch: pytest.MonkeyPatch,
):
    rows = [
        _row(location_id=1, brand_id=1, distance_mi=8.0),
        _row(location_id=2, brand_id=1, distance_mi=3.0, address_line1="4900 W Park Blvd"),  # nearer — should win
        _row(location_id=3, brand_id=1, distance_mi=9.0),
    ]

    async def _fake_fetch(*args, **kwargs):
        return rows

    monkeypatch.setattr(search_service, "_fetch_candidates", _fake_fetch)
    db = _FakeSession(brands=[_brand(1, "Spice Route")])

    results, total = await search_service.search(
        db, 32.8, -96.9, 15, None, None, None, Pagination(page=1, page_size=20)
    )
    assert total == 1
    assert results[0].location_count_nearby == 3
    assert results[0].nearest_location.location_id == 2
    assert results[0].nearest_location.distance_mi == 3.0
    # Real gap found live 2026-09-18: search cards had no way to show a
    # full address (only city/state) or link out to Google Maps.
    assert results[0].nearest_location.address_line1 == "4900 W Park Blvd"
    assert results[0].nearest_location.postal_code == "75024"


@pytest.mark.asyncio
async def test_default_sort_verified_then_distance_then_name(monkeypatch: pytest.MonkeyPatch):
    # Brand 2: unverified, 2 mi, "Zaika" — would win on distance alone but
    # must lose to any verified brand.
    # Brand 1: verified, 10 mi, "Biryani House".
    # Brand 3: verified, 5 mi, "Andhra Spice" — verified + nearer than
    # brand 1, and alphabetically should not matter here since distance
    # already differentiates it from brand 1.
    rows = [
        _row(location_id=1, brand_id=1, distance_mi=10.0, is_verified=True),
        _row(location_id=2, brand_id=2, distance_mi=2.0, is_verified=False),
        _row(location_id=3, brand_id=3, distance_mi=5.0, is_verified=True),
    ]

    async def _fake_fetch(*args, **kwargs):
        return rows

    monkeypatch.setattr(search_service, "_fetch_candidates", _fake_fetch)
    db = _FakeSession(
        brands=[_brand(1, "Biryani House"), _brand(2, "Zaika"), _brand(3, "Andhra Spice")]
    )

    results, total = await search_service.search(
        db, 32.8, -96.9, 15, None, None, None, Pagination(page=1, page_size=20)
    )
    assert total == 3
    ordered_names = [r.name for r in results]
    # Verified brands (Andhra Spice @5mi, Biryani House @10mi) before the
    # unverified-but-nearer Zaika @2mi.
    assert ordered_names == ["Andhra Spice", "Biryani House", "Zaika"]


@pytest.mark.asyncio
async def test_pagination_slices_sorted_results(monkeypatch: pytest.MonkeyPatch):
    rows = [_row(location_id=i, brand_id=i, distance_mi=float(i)) for i in range(1, 4)]

    async def _fake_fetch(*args, **kwargs):
        return rows

    monkeypatch.setattr(search_service, "_fetch_candidates", _fake_fetch)
    db = _FakeSession(brands=[_brand(i, f"Brand {i}") for i in range(1, 4)])

    results, total = await search_service.search(
        db, 32.8, -96.9, 15, None, None, None, Pagination(page=2, page_size=1)
    )
    assert total == 3
    assert len(results) == 1
    assert results[0].name == "Brand 2"  # second-nearest, page 2 of page_size 1


@pytest.mark.asyncio
async def test_omitted_lat_lng_uses_dallas_default(monkeypatch: pytest.MonkeyPatch):
    captured = {}

    async def _fake_fetch(db, lat, lng, radius_mi, cuisine, dietary, type_):
        captured["lat"] = lat
        captured["lng"] = lng
        return []

    monkeypatch.setattr(search_service, "_fetch_candidates", _fake_fetch)

    await search_service.search(
        _FakeSession(brands=[]), None, None, 15, None, None, None, Pagination(page=1, page_size=20)
    )
    assert captured["lat"] == search_service._DEFAULT_LAT
    assert captured["lng"] == search_service._DEFAULT_LNG
