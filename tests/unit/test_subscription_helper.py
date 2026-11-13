"""Unit test: `is_location_subscribed` — the ONE definition of "subscribed"
(is_paid AND paid_until NULL-or-future). Pure logic, no DB."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.services.subscription_service import is_location_subscribed
from factories import RestaurantLocationFactory


def _loc(**kw):
    return RestaurantLocationFactory(**kw)


def test_not_paid_is_never_subscribed():
    assert is_location_subscribed(_loc(is_paid=False, paid_until=None)) is False
    # A stale future paid_until on an unpaid row still does not count.
    future = datetime.now(timezone.utc) + timedelta(days=5)
    assert is_location_subscribed(_loc(is_paid=False, paid_until=future)) is False


def test_paid_with_no_end_date_is_subscribed():
    assert is_location_subscribed(_loc(is_paid=True, paid_until=None)) is True


def test_paid_with_future_end_date_is_subscribed():
    future = datetime.now(timezone.utc) + timedelta(days=5)
    assert is_location_subscribed(_loc(is_paid=True, paid_until=future)) is True


def test_paid_with_past_end_date_is_not_subscribed():
    past = datetime.now(timezone.utc) - timedelta(seconds=1)
    assert is_location_subscribed(_loc(is_paid=True, paid_until=past)) is False


def test_naive_datetimes_are_read_as_utc():
    naive_future = (datetime.now(timezone.utc) + timedelta(days=1)).replace(tzinfo=None)
    naive_past = (datetime.now(timezone.utc) - timedelta(days=1)).replace(tzinfo=None)
    assert is_location_subscribed(_loc(is_paid=True, paid_until=naive_future)) is True
    assert is_location_subscribed(_loc(is_paid=True, paid_until=naive_past)) is False


def test_now_can_be_injected():
    paid_until = datetime(2030, 1, 1, tzinfo=timezone.utc)
    loc = _loc(is_paid=True, paid_until=paid_until)
    assert is_location_subscribed(loc, now=datetime(2029, 12, 31, tzinfo=timezone.utc)) is True
    assert is_location_subscribed(loc, now=datetime(2030, 1, 2, tzinfo=timezone.utc)) is False
