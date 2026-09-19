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
sort (paid desc, verified desc, distance asc, name asc), and pagination slicing.
"""
from __future__ import annotations

from datetime import time

import pytest

from app.dependencies.pagination import Pagination
from app.models.restaurant_brand import RestaurantBrand
from app.services import hours_service, search_service


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
        phone="+14695551234",
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
    return hours_service.TodayStatus(None, None, None, None)


async def _no_cover(db, location_id):
    return None


@pytest.fixture(autouse=True)
def _stub_side_lookups(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(search_service.cuisine_service, "get_brand_cuisine_tags_bulk", _no_tags)
    monkeypatch.setattr(search_service.hours_service, "today_status_for_location", _not_open)
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
    assert results[0].nearest_location.phone == "+14695551234"


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
async def test_paid_takes_precedence_over_verified_and_distance(monkeypatch: pytest.MonkeyPatch):
    # Brand 1: verified, unpaid, 1 mi — nearest and verified, but unpaid.
    # Brand 2: paid, unverified, 12 mi — must still lead (paid precedence).
    # Brand 3: paid + verified, 14 mi — leads brand 2 (verified tie-break).
    # Brand 4: paid + verified, 14 mi, name "Aroma" — beats brand 3 on name.
    rows = [
        _row(location_id=1, brand_id=1, distance_mi=1.0, is_verified=True, is_paid=False),
        _row(location_id=2, brand_id=2, distance_mi=12.0, is_verified=False, is_paid=True),
        _row(location_id=3, brand_id=3, distance_mi=14.0, is_verified=True, is_paid=True),
        _row(location_id=4, brand_id=4, distance_mi=14.0, is_verified=True, is_paid=True),
    ]

    async def _fake_fetch(*args, **kwargs):
        return rows

    monkeypatch.setattr(search_service, "_fetch_candidates", _fake_fetch)
    db = _FakeSession(
        brands=[_brand(1, "Near"), _brand(2, "Paid Only"), _brand(3, "Zest"), _brand(4, "Aroma")]
    )

    results, _ = await search_service.search(
        db, 32.8, -96.9, 15, None, None, None, Pagination(page=1, page_size=20)
    )
    assert [r.name for r in results] == ["Aroma", "Zest", "Paid Only", "Near"]


@pytest.mark.asyncio
async def test_today_hours_are_passed_through_to_nearest_location(monkeypatch: pytest.MonkeyPatch):
    async def _open_today(db, location_id, tz):
        return hours_service.TodayStatus(True, time(11, 0), time(21, 30), False)

    monkeypatch.setattr(search_service.hours_service, "today_status_for_location", _open_today)

    async def _fake_fetch(*args, **kwargs):
        return [_row(location_id=1, brand_id=1)]

    monkeypatch.setattr(search_service, "_fetch_candidates", _fake_fetch)
    db = _FakeSession(brands=[_brand(1, "Spice Route")])

    results, _ = await search_service.search(
        db, 32.8, -96.9, 15, None, None, None, Pagination(page=1, page_size=20)
    )
    loc = results[0].nearest_location
    assert loc.is_open_now is True
    assert loc.open_time == time(11, 0)
    assert loc.close_time == time(21, 30)
    assert loc.is_closed is False


def test_compute_today_status_variants():
    from app.models.restaurant_hours import RestaurantHours

    tz = "America/Chicago"
    unknown = hours_service.compute_today_status(None, tz)
    assert (unknown.open_time, unknown.close_time, unknown.is_closed) == (None, None, None)

    closed = hours_service.compute_today_status(
        RestaurantHours(location_id=1, day_of_week=0, is_closed=True), tz
    )
    assert closed.is_closed is True and closed.open_time is None and closed.is_open_now is False

    partial = hours_service.compute_today_status(
        RestaurantHours(location_id=1, day_of_week=0, is_closed=False, open_time=time(9, 0)), tz
    )
    assert partial.open_time is None and partial.is_closed is False

    full = hours_service.compute_today_status(
        RestaurantHours(
            location_id=1, day_of_week=0, is_closed=False, open_time=time(9, 0), close_time=time(17, 0)
        ),
        tz,
    )
    assert (full.open_time, full.close_time, full.is_closed) == (time(9, 0), time(17, 0), False)


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

    async def _fake_fetch(db, lat, lng, radius_mi, cuisine, dietary, type_, q=None):
        captured["lat"] = lat
        captured["lng"] = lng
        return []

    monkeypatch.setattr(search_service, "_fetch_candidates", _fake_fetch)

    await search_service.search(
        _FakeSession(brands=[]), None, None, 15, None, None, None, Pagination(page=1, page_size=20)
    )
    assert captured["lat"] == search_service._DEFAULT_LAT
    assert captured["lng"] == search_service._DEFAULT_LNG


# --- text search (`q`) ---------------------------------------------------------
from sqlalchemy.dialects import postgresql


def test_escape_like_makes_wildcards_literal():
    assert search_service._escape_like("100%_off") == "100\\%\\_off"


def test_distance_key_sorts_unlocated_after_located():
    assert search_service._distance_key(None) > search_service._distance_key(9999.0)


class _CapturingSession:
    """Captures the statement `_fetch_candidates` executes, returns no rows."""

    def __init__(self):
        self.stmt = None

    async def execute(self, stmt):
        self.stmt = stmt

        class _Result:
            def all(self):
                return []

        return _Result()


@pytest.mark.asyncio
async def test_text_search_matches_name_or_tag_and_drops_geo_requirement():
    db = _CapturingSession()
    await search_service._fetch_candidates(db, 32.8, -96.9, 15, None, None, None, "katha")
    sql = str(db.stmt.compile(dialect=postgresql.dialect())).lower()
    assert "ilike" in sql  # name / tag match
    assert "st_dwithin" not in sql  # radius not required for a name search
    assert "geom is not null" not in sql  # un-geocoded restaurants stay findable


@pytest.mark.asyncio
async def test_without_q_the_geo_radius_filter_is_still_applied():
    db = _CapturingSession()
    await search_service._fetch_candidates(db, 32.8, -96.9, 15, None, None, None, None)
    sql = str(db.stmt.compile(dialect=postgresql.dialect())).lower()
    assert "st_dwithin" in sql and "geom is not null" in sql
    assert "ilike" not in sql


@pytest.mark.asyncio
async def test_unlocated_text_hit_is_returned_with_null_distance(monkeypatch: pytest.MonkeyPatch):
    rows = [
        _row(location_id=1, brand_id=1, distance_mi=None),
        _row(location_id=2, brand_id=2, distance_mi=4.0),
    ]

    async def _fake_fetch(*args, **kwargs):
        return rows

    monkeypatch.setattr(search_service, "_fetch_candidates", _fake_fetch)
    db = _FakeSession(brands=[_brand(1, "Katha Kitchen"), _brand(2, "Spice Route")])

    results, total = await search_service.search(
        db, 32.8, -96.9, 15, None, None, None, Pagination(page=1, page_size=20), "kitchen"
    )
    assert total == 2
    by_name = {r.name: r for r in results}
    assert by_name["Katha Kitchen"].nearest_location.distance_mi is None
    assert by_name["Spice Route"].nearest_location.distance_mi == 4.0
    assert [r.name for r in results] == ["Spice Route", "Katha Kitchen"]  # located first
