"""deal CRUD + public-content shapes — see docs/API_CONTRACTS.md "Deals
(deal)".
"""
from __future__ import annotations

from datetime import datetime
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


class DealCreate(BaseModel):
    deal_type: DealTypeValue = "deal"
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    # NULL/omitted = every day. See app/models/deal.py module docstring.
    applicable_days: list[int] | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    is_active: bool = True

    @field_validator("applicable_days")
    @classmethod
    def _check_days(cls, value: list[int] | None) -> list[int] | None:
        return _validate_applicable_days(value)

    @model_validator(mode="after")
    def _check_date_range(self) -> "DealCreate":
        if self.start_at is not None and self.end_at is not None and self.start_at >= self.end_at:
            raise ValueError("start_at must be before end_at")
        return self


class DealUpdate(BaseModel):
    """PATCH body — same `exclude_unset` convention as `LocationUpdate`
    (app/schemas/location.py): an omitted field leaves the stored value
    untouched; an explicit `null` on a nullable field (description,
    applicable_days, start_at, end_at) clears it. `title`/`deal_type`/
    `is_active` are non-nullable on the model, so an explicit `null` for
    those is rejected the same way `LocationUpdate.phone` rejects it —
    enforced in `deal_service.update_deal`, not here, since Pydantic alone
    can't distinguish "omitted" from "explicit null" without
    `exclude_unset`.
    """

    deal_type: DealTypeValue | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    applicable_days: list[int] | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    is_active: bool | None = None

    @field_validator("applicable_days")
    @classmethod
    def _check_days(cls, value: list[int] | None) -> list[int] | None:
        return _validate_applicable_days(value)


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


class DealPublicOut(BaseModel):
    """Content-gated public shape — only ever populated for a caller who
    passes `deal_service.caller_may_view_deal_content_for_location`
    (signed-in registered_user, admin, or the location's own owner/manager).
    Deliberately narrower than `DealOut`: no `location_id` (redundant, the
    caller already knows which location they asked about),
    `is_active`/timestamps (irrelevant to a public reader — every deal in
    this list already matched "today" by construction)."""

    id: int
    deal_type: DealTypeValue
    title: str
    description: str | None
