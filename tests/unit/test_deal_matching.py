"""Unit test: `app/services/deal_service.py::deal_matches_today` — the core
"is this deal live right now" predicate used by both `GET /search` and
`GET /locations/{id}`. Pure logic, no DB (mirrors tests/CLAUDE.md's
`test_is_paid.py` pattern — a factory-built in-memory model instance,
`now` passed explicitly rather than depending on the real clock, so these
tests never flake around midnight/week boundaries).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.services import deal_service

from factories import DealFactory

_TZ = "America/Chicago"

# A fixed Tuesday at noon Central (2026-09-22 was a Tuesday), used as the
# reference "now" for every test below instead of the real clock.
_TUESDAY_NOON_UTC = datetime(2026, 9, 22, 17, 0, tzinfo=timezone.utc)  # noon CDT


def test_inactive_deal_never_matches_regardless_of_dates():
    deal = DealFactory(is_active=False)
    assert deal_service.deal_matches_today(deal, _TZ, now=_TUESDAY_NOON_UTC) is False


def test_deal_with_no_restrictions_matches_every_day():
    deal = DealFactory(is_active=True, applicable_days=None, start_at=None, end_at=None)
    assert deal_service.deal_matches_today(deal, _TZ, now=_TUESDAY_NOON_UTC) is True


def test_applicable_days_matches_when_today_is_in_the_list():
    # 2026-09-22 is a Tuesday -> weekday 1 (0=Monday..6=Sunday).
    deal = DealFactory(is_active=True, applicable_days=[1])
    assert deal_service.deal_matches_today(deal, _TZ, now=_TUESDAY_NOON_UTC) is True


def test_applicable_days_does_not_match_when_today_is_not_in_the_list():
    deal = DealFactory(is_active=True, applicable_days=[2, 3])  # Wed, Thu
    assert deal_service.deal_matches_today(deal, _TZ, now=_TUESDAY_NOON_UTC) is False


def test_start_at_in_the_future_does_not_match_yet():
    deal = DealFactory(is_active=True, start_at=_TUESDAY_NOON_UTC + timedelta(days=1))
    assert deal_service.deal_matches_today(deal, _TZ, now=_TUESDAY_NOON_UTC) is False


def test_start_at_already_passed_matches():
    deal = DealFactory(is_active=True, start_at=_TUESDAY_NOON_UTC - timedelta(days=1))
    assert deal_service.deal_matches_today(deal, _TZ, now=_TUESDAY_NOON_UTC) is True


def test_end_at_already_passed_does_not_match():
    """The core "eventual consistency in is_active, exact consistency in
    what's displayed" guarantee — deal_matches_today must return False the
    INSTANT end_at passes, without waiting for the 5-minute expiry cron to
    flip is_active (docs/DATA_MODEL.md "deal" section)."""
    deal = DealFactory(is_active=True, end_at=_TUESDAY_NOON_UTC - timedelta(minutes=1))
    assert deal_service.deal_matches_today(deal, _TZ, now=_TUESDAY_NOON_UTC) is False


def test_end_at_exactly_now_does_not_match():
    """`end_at <= now` is the expiry boundary (matches DECISIONS.md's cron
    SQL exactly) — the instant of expiry itself no longer matches."""
    deal = DealFactory(is_active=True, end_at=_TUESDAY_NOON_UTC)
    assert deal_service.deal_matches_today(deal, _TZ, now=_TUESDAY_NOON_UTC) is False


def test_end_at_in_the_future_matches():
    deal = DealFactory(is_active=True, end_at=_TUESDAY_NOON_UTC + timedelta(days=1))
    assert deal_service.deal_matches_today(deal, _TZ, now=_TUESDAY_NOON_UTC) is True


def test_bounded_window_and_applicable_days_combine_with_and_semantics():
    # Within the date window AND today is in applicable_days -> matches.
    deal = DealFactory(
        is_active=True,
        applicable_days=[1],  # Tuesday
        start_at=_TUESDAY_NOON_UTC - timedelta(days=7),
        end_at=_TUESDAY_NOON_UTC + timedelta(days=7),
    )
    assert deal_service.deal_matches_today(deal, _TZ, now=_TUESDAY_NOON_UTC) is True

    # Same window, but today is NOT in applicable_days -> does not match.
    deal_wrong_day = DealFactory(
        is_active=True,
        applicable_days=[2],  # Wednesday
        start_at=_TUESDAY_NOON_UTC - timedelta(days=7),
        end_at=_TUESDAY_NOON_UTC + timedelta(days=7),
    )
    assert deal_service.deal_matches_today(deal_wrong_day, _TZ, now=_TUESDAY_NOON_UTC) is False
