"""Unit tests for the dev-only random-hours generator
(app/scripts/seed_random_hours.py) -- pure logic, no DB."""
from __future__ import annotations

from app.scripts.seed_random_hours import MONDAY, TUESDAY, generate_weekly_hours


def test_generates_seven_days_zero_through_six():
    rows = generate_weekly_hours(1)
    assert [r["day_of_week"] for r in rows] == list(range(7))


def test_is_deterministic_per_location_id():
    assert generate_weekly_hours(42) == generate_weekly_hours(42)


def test_only_monday_or_tuesday_is_ever_closed_and_at_most_one_day():
    for location_id in range(1, 200):
        closed = [r["day_of_week"] for r in generate_weekly_hours(location_id) if r["is_closed"]]
        assert len(closed) <= 1
        assert set(closed) <= {MONDAY, TUESDAY}


def test_open_days_have_sane_times_and_closed_days_have_none():
    for location_id in range(1, 100):
        for r in generate_weekly_hours(location_id):
            if r["is_closed"]:
                assert r["open_time"] is None and r["close_time"] is None
            else:
                assert r["open_time"] < r["close_time"]
                assert r["open_time"].hour in (10, 11)


def test_the_mix_includes_monday_closed_tuesday_closed_and_open_all_week():
    kinds = set()
    for location_id in range(1, 60):
        closed = {r["day_of_week"] for r in generate_weekly_hours(location_id) if r["is_closed"]}
        kinds.add(frozenset(closed))
    assert kinds == {frozenset({MONDAY}), frozenset({TUESDAY}), frozenset()}
