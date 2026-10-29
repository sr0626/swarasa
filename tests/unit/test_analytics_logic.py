"""Unit tests: pure period math / gap-filling / percent-change helpers behind
the owner analytics endpoints (app/services/analytics_service.py)."""
from __future__ import annotations

from datetime import date

from app.schemas.analytics import MetricTotals
from app.services import analytics_service as svc


def test_period_bounds_are_adjacent_equal_length_windows():
    start, end, prev_start, prev_end = svc.period_bounds(date(2026, 10, 28), 7)
    assert (start, end) == (date(2026, 10, 22), date(2026, 10, 28))
    assert (prev_start, prev_end) == (date(2026, 10, 15), date(2026, 10, 21))
    assert (end - start).days == (prev_end - prev_start).days == 6


def test_period_bounds_cross_month_and_year():
    start, end, prev_start, prev_end = svc.period_bounds(date(2027, 1, 3), 30)
    assert start == date(2026, 12, 5)
    assert prev_end == date(2026, 12, 4)
    assert prev_start == date(2026, 11, 5)


def test_percent_change():
    assert svc.percent_change(15, 10) == 50.0
    assert svc.percent_change(5, 10) == -50.0
    assert svc.percent_change(10, 10) == 0.0
    assert svc.percent_change(1, 3) == -66.7
    # Undefined when there is no previous data.
    assert svc.percent_change(5, 0) is None
    assert svc.percent_change(0, 0) is None


def test_fill_series_zero_fills_gaps_in_order():
    rows = {date(2026, 10, 2): {"page_views": 4, "phone_clicks": 1}}
    points = svc.fill_series(rows, date(2026, 10, 1), 3)
    assert [p.date for p in points] == [date(2026, 10, 1), date(2026, 10, 2), date(2026, 10, 3)]
    assert [p.page_views for p in points] == [0, 4, 0]
    assert points[1].phone_clicks == 1
    assert points[0].tile_clicks == 0


def test_sum_totals_and_change():
    rows = {
        date(2026, 10, 1): {"page_views": 3, "deal_views": 1},
        date(2026, 10, 2): {"page_views": 2},
    }
    totals = svc.sum_totals(svc.fill_series(rows, date(2026, 10, 1), 2))
    assert totals.page_views == 5 and totals.deal_views == 1
    change = svc.compute_change(totals, MetricTotals(page_views=4))
    assert change.page_views == 25.0
    assert change.deal_views is None


def test_event_vocabulary_matches_model_columns():
    from app.models.location_daily_stat import LocationDailyStat

    for column in svc.EVENT_COLUMNS.values():
        assert hasattr(LocationDailyStat, column)
    assert set(svc.METRICS) == set(MetricTotals.model_fields)
