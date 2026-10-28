"""Unit tests: the `open_now` /search filter core (hours_service) and the
`search_service.search(open_now=...)` post-filter, with a monkeypatched
candidate fetch so no PostGIS SQL runs (same approach as
test_search_service_logic.py)."""
from __future__ import annotations

from datetime import datetime, time, timezone

import pytest

from app.dependencies.pagination import Pagination
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_hours import RestaurantHours
from app.services import hours_service, search_service

# 2026-10-28 is a Wednesday (weekday 2). 18:00 UTC = 13:00 Chicago (CDT),
# 11:00 Los Angeles (PDT), 03:00 next day (Thu) in Tokyo.
NOW_UTC = datetime(2026, 10, 28, 18, 0, tzinfo=timezone.utc)
CHI = "America/Chicago"


def _hours(location_id: int, day: int, open_=time(11, 0), close=time(22, 0), closed=False):
    return RestaurantHours(
        location_id=location_id,
        day_of_week=day,
        open_time=None if closed else open_,
        close_time=None if closed else close,
        is_closed=closed,
    )


def test_open_now_ids_open_closed_and_unknown():
    cands = [(1, CHI), (2, CHI), (3, CHI), (4, CHI)]
    today = {
        1: _hours(1, 2),  # 11-22, 13:00 local -> open
        2: _hours(2, 2, open_=time(17, 0), close=time(22, 0)),  # opens later -> closed
        3: _hours(3, 2, closed=True),  # closed all day
        # 4: no row -> unknown
    }
    assert hours_service.open_now_location_ids(cands, today, NOW_UTC) == {1}


def test_open_now_unknown_when_is_closed_null_or_times_missing():
    unknown_flag = RestaurantHours(location_id=1, day_of_week=2, is_closed=None)
    missing_times = RestaurantHours(location_id=2, day_of_week=2, is_closed=False)
    assert hours_service.open_now_location_ids(
        [(1, CHI), (2, CHI)], {1: unknown_flag, 2: missing_times}, NOW_UTC
    ) == set()


def test_open_now_uses_each_locations_own_timezone():
    # Same 10:00-12:00 hours: open at 11:00 Los Angeles, closed at 13:00 Chicago.
    cands = [(1, "America/Los_Angeles"), (2, CHI)]
    today = {
        1: _hours(1, 2, open_=time(10, 0), close=time(12, 0)),
        2: _hours(2, 2, open_=time(10, 0), close=time(12, 0)),
    }
    assert hours_service.open_now_location_ids(cands, today, NOW_UTC) == {1}


def test_open_now_overnight_hours_and_bad_timezone_falls_back():
    late = _hours(1, 2, open_=time(12, 0), close=time(2, 0))  # 12:00 -> 02:00
    assert hours_service.open_now_location_ids([(1, "Not/AZone")], {1: late}, NOW_UTC) == {1}


class _FakeResult:
    def __init__(self, items):
        self._items = items

    def scalars(self):
        return self

    def all(self):
        return self._items


class _FakeSession:
    """search() with open_now and no deals: deals query first, then brands."""

    def __init__(self, brands):
        self._brands = brands
        self._n = 0

    async def execute(self, _stmt):
        self._n += 1
        return _FakeResult([] if self._n == 1 else self._brands)


def _row(**kw):
    d = dict(
        location_id=1, brand_id=1, slug="x", address_line1="1 Main", city="Plano",
        state="TX", postal_code="75024", phone=None, is_verified=False, is_paid=False,
        timezone=CHI, distance_mi=5.0,
    )
    d.update(kw)
    return search_service._CandidateRow(**d)


@pytest.fixture(autouse=True)
def _stubs(monkeypatch):
    async def _no_tags(db, ids):
        return {i: [] for i in ids}

    async def _status(db, lid, tz):
        return hours_service.TodayStatus(None, None, None, None)

    async def _cover(db, lid):
        return None

    monkeypatch.setattr(search_service.cuisine_service, "get_location_cuisine_tags_bulk", _no_tags)
    monkeypatch.setattr(search_service.hours_service, "today_status_for_location", _status)
    monkeypatch.setattr(search_service.photo_service, "get_cover_photo", _cover)


def _install(monkeypatch, rows, open_ids):
    async def _fetch(*a, **k):
        return rows

    async def _hours_map(db, pairs):
        return {}

    monkeypatch.setattr(search_service, "_fetch_candidates", _fetch)
    monkeypatch.setattr(search_service.hours_service, "get_today_hours_for_candidates", _hours_map)
    monkeypatch.setattr(
        search_service.hours_service, "open_now_location_ids", lambda pairs, hours, now=None: open_ids
    )


async def _run(db, **kw):
    return await search_service.search(
        db, 32.8, -96.9, 15, None, None, None, Pagination(page=1, page_size=20), **kw
    )


def _brand(i, name):
    return RestaurantBrand(id=i, name=name, slug=name.lower(), is_claimed=True, owner_id=None)


@pytest.mark.asyncio
async def test_open_now_filters_per_location_nearest_becomes_nearest_open(monkeypatch):
    rows = [
        _row(location_id=1, brand_id=1, distance_mi=2.0),  # closed sibling, nearer
        _row(location_id=2, brand_id=1, distance_mi=6.0),  # open
        _row(location_id=3, brand_id=2, distance_mi=1.0),  # closed brand
    ]
    _install(monkeypatch, rows, {2})
    results, total = await _run(_FakeSession([_brand(1, "Alpha"), _brand(2, "Beta")]), open_now=True)
    assert total == 1
    assert results[0].nearest_location.location_id == 2
    assert results[0].location_count_nearby == 1


@pytest.mark.asyncio
async def test_open_now_with_nothing_open_returns_empty(monkeypatch):
    _install(monkeypatch, [_row()], set())
    assert await _run(_FakeSession([]), open_now=True) == ([], 0)


@pytest.mark.asyncio
async def test_open_now_omitted_does_not_touch_hours(monkeypatch):
    async def _fetch(*a, **k):
        return [_row()]

    async def _boom(*a, **k):
        raise AssertionError("hours must not be queried without open_now")

    monkeypatch.setattr(search_service, "_fetch_candidates", _fetch)
    monkeypatch.setattr(search_service.hours_service, "get_today_hours_for_candidates", _boom)
    _results, total = await _run(_FakeSession([_brand(1, "Alpha")]))
    assert total == 1


def test_activity_payload_records_open_now():
    from app.services import activity_service

    p = activity_service.build_search_payload(
        q=None, cuisine=None, dietary=None, type_=None, loc=None,
        has_deals_today=None, open_now=True, result_count=3,
    )
    assert p == {"open_now": True, "result_count": 3}
