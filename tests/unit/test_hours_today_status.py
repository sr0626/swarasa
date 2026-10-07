"""`hours_service.compute_today_status` — the server-computed inputs behind the
public open/closed pill ("Open now · until 10pm" / "Closed now · opens 10am" /
"Closed now" / "Closed today"). `now` is injected (already in the location's
timezone) so the before-open / open / after-close phases are deterministic.
"""
from __future__ import annotations

from datetime import datetime, time

from app.models.restaurant_hours import RestaurantHours
from app.services import hours_service

TZ = "America/Chicago"


def _row(**kw) -> RestaurantHours:
    return RestaurantHours(location_id=1, day_of_week=0, **kw)


def _at(hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 9, 24, hour, minute)


def _day(open_t: time, close_t: time) -> RestaurantHours:
    return _row(is_closed=False, open_time=open_t, close_time=close_t)


def test_before_opening_is_closed_now_and_opens_later():
    s = hours_service.compute_today_status(_day(time(10, 0), time(22, 0)), TZ, _at(9, 30))
    assert s.is_open_now is False
    assert s.opens_later_today is True
    assert (s.open_time, s.close_time, s.is_closed) == (time(10, 0), time(22, 0), False)


def test_within_hours_is_open_now():
    s = hours_service.compute_today_status(_day(time(10, 0), time(22, 0)), TZ, _at(15))
    assert s.is_open_now is True
    assert s.opens_later_today is None


def test_boundaries_inclusive_of_open_and_close():
    row = _day(time(10, 0), time(22, 0))
    assert hours_service.compute_today_status(row, TZ, _at(10, 0)).is_open_now is True
    assert hours_service.compute_today_status(row, TZ, _at(22, 0)).is_open_now is True


def test_after_closing_is_closed_now_and_not_opening_later():
    s = hours_service.compute_today_status(_day(time(10, 0), time(22, 0)), TZ, _at(22, 30))
    assert s.is_open_now is False
    assert s.opens_later_today is False
    # Times still exposed so the pill can say "Closed now" (not "Closed today").
    assert s.is_closed is False and s.open_time == time(10, 0)


def test_closed_all_day_has_no_opens_later():
    s = hours_service.compute_today_status(_row(is_closed=True), TZ, _at(12))
    assert s.is_closed is True
    assert s.is_open_now is False
    assert s.opens_later_today is None
    assert s.open_time is None and s.close_time is None


def test_unknown_hours_are_all_none():
    for row in (None, _row(is_closed=None)):
        s = hours_service.compute_today_status(row, TZ, _at(12))
        assert (s.is_open_now, s.is_closed, s.opens_later_today) == (None, None, None)


def test_open_day_with_missing_times_never_guesses():
    s = hours_service.compute_today_status(_row(is_closed=False, open_time=time(9, 0)), TZ, _at(12))
    assert s.is_open_now is None
    assert s.opens_later_today is None
    assert s.open_time is None and s.close_time is None


def test_overnight_hours_open_until_after_midnight():
    row = _day(time(18, 0), time(2, 0))
    late = hours_service.compute_today_status(row, TZ, _at(23, 30))
    assert late.is_open_now is True and late.opens_later_today is None
    after_midnight = hours_service.compute_today_status(row, TZ, _at(1, 0))
    assert after_midnight.is_open_now is True


def test_overnight_hours_daytime_gap_opens_later():
    s = hours_service.compute_today_status(_day(time(18, 0), time(2, 0)), TZ, _at(10, 0))
    assert s.is_open_now is False
    assert s.opens_later_today is True
