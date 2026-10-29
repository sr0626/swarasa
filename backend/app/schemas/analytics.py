"""Owner analytics (counters) -- docs/API_CONTRACTS.md "Owner analytics".

Counters only; nothing here identifies a visitor.
"""
from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field


class TrackEventIn(BaseModel):
    # A plain string, not a Literal: an event name this server doesn't know
    # is IGNORED (204, nothing recorded) rather than 422'd, so an older or
    # newer client can never surface an error to a visitor.
    event: str = Field(max_length=32)


class MetricTotals(BaseModel):
    page_views: int = 0
    tile_clicks: int = 0
    deal_views: int = 0
    website_clicks: int = 0
    directions_clicks: int = 0
    phone_clicks: int = 0


class MetricChange(BaseModel):
    """Percentage change vs the previous period of equal length, per metric.
    `null` = undefined (previous period was 0)."""

    page_views: float | None = None
    tile_clicks: float | None = None
    deal_views: float | None = None
    website_clicks: float | None = None
    directions_clicks: float | None = None
    phone_clicks: float | None = None


class DailyPoint(MetricTotals):
    date: date


class AnalyticsOut(BaseModel):
    days: int
    # UTC calendar dates, inclusive. `end_date` is today (a partial day).
    start_date: date
    end_date: date
    timezone: str = "UTC"
    # One entry per day in the window, oldest first, gaps filled with zeros.
    series: list[DailyPoint]
    totals: MetricTotals
    previous_totals: MetricTotals
    change_pct: MetricChange
    # First day with any recorded data for this scope; null = nothing yet.
    data_since: date | None = None
    # CURRENT brand-level follower count (follows are brand-level; every
    # location of a brand reports the same number).
    follower_count: int
    # Deals currently switched on and not past their end date.
    active_deal_count: int


class LocationAnalyticsOut(AnalyticsOut):
    location_id: int


class BrandLocationTotals(BaseModel):
    location_id: int
    label: str
    totals: MetricTotals


class BrandAnalyticsOut(AnalyticsOut):
    brand_id: int
    location_count: int
    by_location: list[BrandLocationTotals]
