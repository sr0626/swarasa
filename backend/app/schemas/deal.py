"""deal CRUD + public-content shapes — see docs/API_CONTRACTS.md "Deals
(deal)".
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

DealTypeValue = Literal["deal", "special"]


def _validate_applicable_days(value: list[int] | None) -> list[int] | None:
    if value is None:
        return None
    if not value:
        raise ValueError(
            "applicable_days must not be an empty list — omit the field "
            "(or send null) for 'every day' instead"
        )
    if len(set(value)) != len(value):
        raise ValueError("applicable_days must not contain duplicate values")
    for day in value:
        # 0=Monday..6=Sunday — matches restaurant_hours.day_of_week /
        # HourEntryIn.day_of_week exactly (app/schemas/hours.py).
        if not 0 <= day <= 6:
            raise ValueError("applicable_days values must be between 0 (Monday) and 6 (Sunday)")
    return sorted(value)


def _as_aware(value: datetime) -> datetime:
    """Treat a timezone-less input as UTC so comparisons/storage never mix
    naive and aware datetimes (which raises TypeError -> a 500)."""
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _normalize_datetime(value: datetime | None) -> datetime | None:
    return None if value is None else _as_aware(value)


class DealCreate(BaseModel):
    """POST body. Added 2026-09-23 (owner feedback): a deal can no longer be
    created with an accidentally-empty date range. `start_at` is required;
    `end_at` is required UNLESS the caller explicitly sends `ongoing: true`
    (which then requires `end_at` to be omitted/null). `ongoing` is a
    request-only flag — not persisted (an ongoing deal is simply `end_at IS
    NULL`, exactly as before), so no migration and legacy rows are unaffected.
    """

    # No `deal_type` field: the Deal-vs-Special label is derived from
    # `end_at` (2026-09-24; see `app.models.deal.effective_deal_type`). A
    # client that still sends `deal_type` is accepted and the value is
    # IGNORED (pydantic drops unknown keys) for backward compatibility.
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    # NULL/omitted = every day. See app/models/deal.py module docstring.
    applicable_days: list[int] | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    # Explicit "no end date" acknowledgement — see class docstring.
    ongoing: bool = False
    is_active: bool = True

    @field_validator("applicable_days")
    @classmethod
    def _check_days(cls, value: list[int] | None) -> list[int] | None:
        return _validate_applicable_days(value)

    @field_validator("start_at", "end_at")
    @classmethod
    def _check_tz(cls, value: datetime | None) -> datetime | None:
        return _normalize_datetime(value)

    @model_validator(mode="after")
    def _check_date_range(self) -> "DealCreate":
        if self.start_at is None:
            raise ValueError("start_at is required")
        if self.ongoing:
            if self.end_at is not None:
                raise ValueError("end_at must be omitted when ongoing is true")
        elif self.end_at is None:
            raise ValueError("end_at is required unless ongoing is true")
        if self.end_at is not None and self.start_at >= self.end_at:
            raise ValueError("start_at must be before end_at")
        return self


class DealUpdate(BaseModel):
    """PATCH body — same `exclude_unset` convention as `LocationUpdate`
    (app/schemas/location.py): an omitted field leaves the stored value
    untouched; an explicit `null` on a nullable field (description,
    applicable_days, start_at, end_at) clears it. `title`/`is_active` are
    non-nullable on the model, so an explicit `null` for
    those is rejected the same way `LocationUpdate.phone` rejects it —
    enforced in `deal_service.update_deal`, not here, since Pydantic alone
    can't distinguish "omitted" from "explicit null" without
    `exclude_unset`.
    """

    # No `deal_type` field — derived from the merged `end_at`; a supplied
    # value is ignored (see `DealCreate`).
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    applicable_days: list[int] | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    # Request-only, same meaning as `DealCreate.ongoing`: `true` clears
    # `end_at` (no end date); it's how a PATCH says "explicitly no end date"
    # rather than clearing it by accident with a bare `end_at: null`.
    ongoing: bool = False
    is_active: bool | None = None

    @field_validator("applicable_days")
    @classmethod
    def _check_days(cls, value: list[int] | None) -> list[int] | None:
        return _validate_applicable_days(value)

    @field_validator("start_at", "end_at")
    @classmethod
    def _check_tz(cls, value: datetime | None) -> datetime | None:
        return _normalize_datetime(value)

    @model_validator(mode="after")
    def _check_date_fields(self) -> "DealUpdate":
        """Only validates the date fields the caller actually touched, so a
        legacy deal (created before start dates were required, `start_at`
        NULL) can still be toggled active/inactive or have its title edited
        without being forced to supply dates. Touching `start_at` means
        giving it a real value; touching `end_at` to clear it requires
        `ongoing: true`."""
        touched = self.model_fields_set
        if "start_at" in touched and self.start_at is None:
            raise ValueError("start_at cannot be cleared — every deal needs a start date")
        if self.ongoing and self.end_at is not None:
            raise ValueError("end_at must be omitted when ongoing is true")
        if "end_at" in touched and self.end_at is None and not self.ongoing:
            raise ValueError("end_at is required unless ongoing is true")
        # start < end is checked in `deal_service.update_deal` against the
        # MERGED stored+patched values (400), not here, so a PATCH that only
        # moves one bound is still validated against the untouched other one.
        return self


class DealOut(BaseModel):
    """Full deal content — management view only (owner/manager/admin on
    their own CRUD endpoints below). Never returned to a public/anonymous
    or non-owning caller; see `DealPublicOut` for the content-gated public
    shape."""

    id: int
    location_id: int
    deal_type: DealTypeValue
    title: str
    description: str | None
    applicable_days: list[int] | None
    start_at: datetime | None
    end_at: datetime | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class DealListResponse(BaseModel):
    results: list[DealOut]
    # True when the location's deals are all hidden from diners
    # (`restaurant_location.deals_hidden`) — the editor's "Hide all deals"
    # switch state. Individual `is_active` toggles are independent of it.
    deals_hidden: bool = False


class DealVisibilityIn(BaseModel):
    """`PUT /locations/{id}/deals/visibility` — hide/show EVERY deal of the
    location publicly (search badge/filter, follow list, location detail)."""

    is_hidden: bool


class DealVisibilityOut(BaseModel):
    location_id: int
    is_hidden: bool


class DealUpcomingOut(BaseModel):
    """Content-gated shape for `LocationOut.upcoming_deals` — an ACTIVE,
    not-yet-expired deal that does NOT apply today (a recurring deal on
    another weekday, or one whose start date is in the future). Same gate as
    `DealPublicOut`; carries the schedule so a diner can tell when it runs.

    `start_at`/`end_at` are the raw instants (`null` `end_at` = ongoing).
    `next_occurrence` is the next calendar date, in the LOCATION's own
    timezone, on which the deal is offered — it's what the list is sorted
    by."""

    id: int
    deal_type: DealTypeValue
    title: str
    description: str | None
    applicable_days: list[int] | None
    start_at: datetime | None
    end_at: datetime | None
    next_occurrence: date


class DealPublicOut(BaseModel):
    """Content-gated public shape — only ever populated for a caller who
    passes `deal_service.caller_may_view_deal_content_for_location`
    (any signed-in caller, of any role; anonymous callers never get it).
    Deliberately narrower than `DealOut`: no `location_id` (redundant, the
    caller already knows which location they asked about),
    `is_active`/timestamps (irrelevant to a public reader — every deal in
    this list already matched "today" by construction)."""

    id: int
    deal_type: DealTypeValue
    title: str
    description: str | None
