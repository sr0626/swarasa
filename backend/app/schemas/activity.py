"""Registered-user activity tracking (searches + restaurant-tile clicks) —
see docs/API_CONTRACTS.md "Activity tracking (`/activity`)" and
docs/DECISIONS.md "Registered-user activity tracking (searches + tile
clicks)".
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

# The UI surface a tile was clicked on. A closed set (not free text) so a
# client can't stuff arbitrary strings into the log via this field.
ActivitySource = Literal["search_results", "homepage", "favourites"]

ActivityEventType = Literal["search", "tile_click"]


class TileClickIn(BaseModel):
    brand_id: int = Field(gt=0)
    # Optional: the favourites grid is brand-level and has no location to
    # report. When present it must belong to `brand_id`.
    location_id: int | None = Field(default=None, gt=0)
    source: ActivitySource


class ActivityEventOut(BaseModel):
    id: int
    event_type: str
    created_at: datetime
    # The stored (already size-bounded) payload. `search`: `q`, `cuisine`,
    # `dietary`, `type`, `loc`, `has_deals_today`, `result_count` (keys
    # omitted when empty). `tile_click`: `brand_id`, `location_id`, `source`.
    payload: dict[str, Any]
    # tile_click only, resolved at read time (null = restaurant/location
    # since removed, or not a tile_click).
    brand_name: str | None = None
    location_label: str | None = None


class UserActivityResponse(BaseModel):
    results: list[ActivityEventOut]
    page: int
    page_size: int
    total: int
    # The retention window applied to this listing, in days — surfaced so
    # the admin UI can state it without hardcoding a second copy.
    retention_days: int
