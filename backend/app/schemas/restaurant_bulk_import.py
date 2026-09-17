"""Request/response shapes for `POST /admin/restaurants/bulk-import` and
the `bulk_import_restaurants` management command
(`app/services/restaurant_bulk_import_service.py`).

`RestaurantBasicDetailIn` deliberately mirrors `app/schemas/location.py`'s
`LocationCreate` field-for-field for the location half (same validation
constraints, same field names/types as `RestaurantLocation` requires) plus
the `restaurant_brand` fields a bulk row also needs (`name`, `description`).
Kept as its own schema rather than composing `LocationCreate` +
`RestaurantCreate` because those two carry fields that don't apply here
(`LocationCreate.brand_id` doesn't exist yet at import time --  this
schema creates the brand; `RestaurantCreate.cuisine_tag_ids` isn't part of
a "basic details" bulk import, per the task scope).
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class RestaurantBasicDetailIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None

    address_line1: str = Field(min_length=1, max_length=255)
    address_line2: str | None = None
    city: str = Field(min_length=1, max_length=120)
    state: str = Field(min_length=2, max_length=2)
    postal_code: str = Field(min_length=1, max_length=10)
    country: str = Field(default="US", min_length=2, max_length=2)
    phone: str | None = None
    timezone: str = "America/Chicago"
    latitude: float | None = None
    longitude: float | None = None

    # Default True: bulk import is an admin-only action (see
    # docs/DECISIONS.md "Data seeding" -- "Each seeded row is admin-
    # reviewed and marked verified=true before it's publicly visible").
    # Still overridable per row for a future batch of unreviewed listings.
    is_verified: bool = True


class BulkImportRequest(BaseModel):
    owner_id: int
    restaurants: list[RestaurantBasicDetailIn] = Field(min_length=1, max_length=500)


class BulkImportRowOut(BaseModel):
    index: int
    name: str
    status: Literal["created", "skipped", "error"]
    brand_id: int | None = None
    location_id: int | None = None
    detail: str | None = None


class BulkImportResponse(BaseModel):
    created: int
    skipped: int
    errors: int
    rows: list[BulkImportRowOut]
