"""Request/response shapes for the admin bulk listing import
(`/admin/import/validate`, `/admin/import/commit`; docs/API_CONTRACTS.md
"Admin bulk listing import"). Cells are accepted as loose strings with a
generous transport cap -- the real per-field limits and plain-language
messages come from `app.core.bulk_import_rules`, so one over-long cell is a
per-row error, never a 422 for the whole file."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# Transport cap only (see module docstring). The browser truncates cells to
# this many characters before sending, so an over-long cell still trips the
# per-field limit instead of being silently cut to a valid length.
CELL_TRANSPORT_MAX = 2100

VALIDATE_MAX_ROWS = 500
COMMIT_MAX_ROWS = 50

def _cell() -> Any:
    return Field(default=None, max_length=CELL_TRANSPORT_MAX)


class ImportRowIn(BaseModel):
    """One CSV row as the browser parsed it. `row_number` is the spreadsheet
    row (header = row 1, first data row = 2). Unknown columns (e.g. a stray
    `owner_email`) are ignored: imported listings are always unclaimed."""

    model_config = ConfigDict(extra="ignore")

    row_number: int = Field(ge=1, le=1_000_000)
    name: str | None = _cell()
    address_line1: str | None = _cell()
    address_line2: str | None = _cell()
    city: str | None = _cell()
    state: str | None = _cell()
    postal_code: str | None = _cell()
    country: str | None = _cell()
    phone: str | None = _cell()
    website: str | None = _cell()
    type: str | None = _cell()
    description: str | None = _cell()
    # Optional opening hours, e.g. "Mon-Fri 11:00-22:00; Sat 11:00-23:00; Sun
    # closed" (app/core/bulk_import_hours.py). Never an error: an unreadable
    # value is a warning and the row imports without hours.
    hours: str | None = _cell()
    # Strings from the CSV, or numbers once the server action geocoded a row.
    latitude: str | float | None = None
    longitude: str | float | None = None


class ImportValidateRequest(BaseModel):
    rows: list[ImportRowIn] = Field(min_length=1, max_length=VALIDATE_MAX_ROWS)


class ImportCommitRequest(BaseModel):
    rows: list[ImportRowIn] = Field(min_length=1, max_length=COMMIT_MAX_ROWS)
    include_warnings: bool = False


class ImportIssueOut(BaseModel):
    field: str | None
    severity: Literal["error", "warning", "info"]
    code: str
    message: str


RowStatus = Literal["valid", "warning", "error", "duplicate"]


class ValidatedRowOut(BaseModel):
    row_number: int
    name: str
    status: RowStatus
    issues: list[ImportIssueOut]
    # No latitude/longitude in the file: the row imports without a map point
    # unless the import step can geocode it (docs/API_CONTRACTS.md).
    needs_geocoding: bool
    matched_tag: str | None = None
    # Importable rows only (valid / warning): what is still needed before the
    # created (always hidden, `coming_soon`) listing can be activated, as
    # `listing_readiness` keys (name | address | phone | hours). [] = ready to
    # activate once the admin has reviewed it.
    missing: list[str] = []
    # Set when status == "duplicate" or a duplicate warning was raised.
    duplicate_of_row: int | None = None
    duplicate_of_listing_id: int | None = None


class ImportValidateSummary(BaseModel):
    total: int
    valid: int
    warning: int
    error: int
    duplicate: int
    needs_geocoding: int
    # Importable rows (valid / warning) that already have everything needed to
    # be activated vs. rows that will still be missing something.
    ready_to_activate: int = 0
    incomplete: int = 0


class ImportValidateResponse(BaseModel):
    rows: list[ValidatedRowOut]
    summary: ImportValidateSummary


CommitResult = Literal["created", "skipped_duplicate", "skipped_warning", "failed"]


class CommittedRowOut(BaseModel):
    row_number: int
    name: str
    result: CommitResult
    reason: str | None = None
    brand_id: int | None = None
    location_id: int | None = None
    needs_geocoding: bool = False
    # Created rows: always "coming_soon" (hidden) -- never auto-activated.
    listing_status: str | None = None
    # Created rows: what is still needed before it can be activated
    # ([] = ready to activate).
    missing: list[str] = []


class ImportCommitSummary(BaseModel):
    created: int
    skipped_duplicate: int
    skipped_warning: int
    failed: int
    needs_geocoding: int
    # Of `created` (all hidden): complete (ready to activate) vs incomplete.
    created_ready_to_activate: int = 0
    created_incomplete: int = 0


class ImportCommitResponse(BaseModel):
    rows: list[CommittedRowOut]
    summary: ImportCommitSummary
