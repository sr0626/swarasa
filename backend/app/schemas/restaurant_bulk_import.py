"""Request/response shapes for `POST /admin/restaurants/bulk-import` and
the `bulk_import_restaurants` management command
(`app/services/restaurant_bulk_import_service.py`).

`RestaurantBasicDetailIn` deliberately mirrors `app/schemas/location.py`'s
`LocationCreate` field-for-field for the location half (same validation
constraints, same field names/types as `RestaurantLocation` requires) plus
the `restaurant_brand` fields a bulk row also needs (`name`, `description`,
`website`). Kept as its own schema rather than composing `LocationCreate` +
`RestaurantCreate` because those two carry fields that don't apply here
(`LocationCreate.brand_id` doesn't exist yet at import time --  this
schema creates the brand; `RestaurantCreate.cuisine_tag_ids` isn't part of
a "basic details" bulk import, per the task scope -- the CSV path below
covers cuisine differently, via free-text matching, not tag ids).

`RestaurantCsvRowIn` extends the same row shape for the CSV import path
(`app/services/restaurant_bulk_import_service.parse_csv_rows` +
`bulk_import_restaurants_csv`, docs/DECISIONS.md "CSV bulk restaurant
import"): two CSV-only fields the JSON path doesn't need --
`owner_email` (the JSON path takes one `owner_id` for the whole batch;
CSV resolves an owner per row instead) and `cuisine_type` (free-text
cuisine, matched case-insensitively against `cuisine_tag.name`/
`display_name` -- unmatched is reported per-row, not a failure).
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class RestaurantBasicDetailIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    website: str | None = Field(default=None, max_length=500)

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


class RestaurantCsvRowIn(RestaurantBasicDetailIn):
    """One row of a CSV bulk-import batch -- see this module's docstring.
    `owner_email` is required (resolves an EXISTING `owner_account`; this
    path never creates one -- same policy `management.py`'s JSON path
    already documents for a typo'd email). `cuisine_type` is optional
    free text, e.g. "south indian".
    """

    owner_email: str = Field(min_length=3, max_length=255)
    cuisine_type: str | None = None


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
