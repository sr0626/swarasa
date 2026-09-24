"""Unit test: `deal_service.next_occurrence_date` / `split_today_and_upcoming`
— the "other active deals" logic behind `LocationOut.upcoming_deals`. Pure
logic, `now` injected (same approach as test_deal_matching.py) so nothing
depends on the real clock or weekday.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.services import deal_service

from factories import DealFactory

_TZ = "America/Chicago"

# Tuesday 2026-09-22, noon CDT (17:00 UTC). weekday() == 1.
_NOW = datetime(2026, 9, 22, 17, 0, tzinfo=timezone.utc)


def _deal(**kw):
    kw.setdefault("id", 1)
    return DealFactory(**kw)


def test_recurring_deal_on_another_weekday_is_upcoming_with_next_date():
    deal = _deal(applicable_days=[4])  # Friday
    assert deal_service.next_occurrence_date(deal, _TZ, now=_NOW) == date(2026, 9, 25)


def test_next_occurrence_wraps_to_next_week():
    deal = _deal(applicable_days=[0])  # Monday -> 2026-09-28
    assert deal_service.next_occurrence_date(deal, _TZ, now=_NOW) == date(2026, 9, 28)


def test_future_start_date_is_upcoming_on_start_day_for_every_day_deal():
    start = _NOW + timedelta(days=10)
    deal = _deal(applicable_days=None, start_at=start)
    assert deal_service.next_occurrence_date(deal, _TZ, now=_NOW) == date(2026, 10, 2)


def test_future_start_with_weekday_restriction_uses_first_matching_weekday_after_start():
    start = datetime(2026, 10, 1, 17, 0, tzinfo=timezone.utc)  # Thursday
    deal = _deal(applicable_days=[1], start_at=start)  # Tuesdays -> 2026-10-06
    assert deal_service.next_occurrence_date(deal, _TZ, now=_NOW) == date(2026, 10, 6)


def test_expired_deal_has_no_next_occurrence():
    deal = _deal(end_at=_NOW - timedelta(minutes=1))
    assert deal_service.next_occurrence_date(deal, _TZ, now=_NOW) is None


def test_weekday_deal_that_ends_before_its_next_occurrence_is_dropped():
    # Tuesday-only, but the window closes Wednesday -> next Tuesday is past end.
    deal = _deal(applicable_days=[1], end_at=_NOW + timedelta(days=1))
    # It matches today (Tuesday, in window) so the split handles it as "today"...
    todays, upcoming = deal_service.split_today_and_upcoming([deal], _TZ, now=_NOW)
    assert todays == [deal] and upcoming == []
    # ...and a Friday-only deal ending Thursday never occurs again.
    friday = _deal(id=2, applicable_days=[4], end_at=_NOW + timedelta(days=2))
    assert deal_service.next_occurrence_date(friday, _TZ, now=_NOW) is None


def test_split_excludes_todays_and_expired_and_sorts_by_next_date_then_title():
    today_deal = _deal(id=1, title="Today thing", applicable_days=[1])
    friday = _deal(id=2, title="Friday fish", applicable_days=[4])
    thursday_b = _deal(id=3, title="Bravo thursday", applicable_days=[3])
    thursday_a = _deal(id=4, title="alpha thursday", applicable_days=[3])
    expired = _deal(id=5, title="Old", end_at=_NOW - timedelta(days=1))
    future = _deal(id=6, title="Grand opening", start_at=_NOW + timedelta(days=20))

    todays, upcoming = deal_service.split_today_and_upcoming(
        [friday, expired, thursday_b, today_deal, future, thursday_a], _TZ, now=_NOW
    )
    assert [d.id for d in todays] == [1]
    assert [d.id for d, _ in upcoming] == [4, 3, 2, 6]  # Thu (alpha, Bravo), Fri, then future
    assert [n for _, n in upcoming][:3] == [date(2026, 9, 24), date(2026, 9, 24), date(2026, 9, 25)]


def test_next_occurrence_uses_location_timezone_not_utc():
    # 2026-09-23 03:00 UTC is still Tuesday 22nd 22:00 in Chicago.
    late = datetime(2026, 9, 23, 3, 0, tzinfo=timezone.utc)
    deal = _deal(applicable_days=[1])  # Tuesday -> still "today" locally
    assert deal_service.deal_matches_today(deal, _TZ, now=late) is True
    other = _deal(id=2, applicable_days=[2])  # Wednesday -> tomorrow locally
    assert deal_service.next_occurrence_date(other, _TZ, now=late) == date(2026, 9, 23)


def test_naive_stored_datetimes_are_treated_as_utc():
    # SQLite (test DB) returns naive datetimes; must not raise TypeError.
    deal = _deal(applicable_days=None, start_at=datetime(2026, 10, 2, 5, 0), end_at=datetime(2026, 10, 9, 5, 0))
    assert deal_service.next_occurrence_date(deal, _TZ, now=_NOW) == date(2026, 10, 2)
