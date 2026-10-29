"""Listing reports (/reports) — see docs/API_CONTRACTS.md "Listing reports
(`/reports`)"."""
from __future__ import annotations

import re
from typing import Literal, get_args

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.utc import UtcDatetime

ReportCategory = Literal[
    "address_incorrect",
    "hours_incorrect",
    "phone_incorrect",
    "price_incorrect",
    "menu_incorrect",
    "deal_incorrect",
    "permanently_closed",
    "other",
]
# Canonical option order (same order the public form lists them). A report's
# `categories` are always stored in this order and its primary `category` is
# the first of them.
REPORT_CATEGORY_ORDER: tuple[str, ...] = get_args(ReportCategory)
REPORT_CATEGORIES_MAX = len(REPORT_CATEGORY_ORDER)
ReportStatus = Literal["new", "resolved", "dismissed"]

DETAILS_MAX_LENGTH = 2000
NOTES_MAX_LENGTH = 2000
EMAIL_MAX_LENGTH = 254

# Deliberately simple shape check (something@domain.tld, no whitespace) —
# same reasoning as schemas/location_manager.py: `email-validator` (needed
# by Pydantic's EmailStr) isn't in requirements.txt. The address is only
# ever used for a manual admin follow-up, never for sending automatically.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class ReportCreate(BaseModel):
    brand_id: int
    location_id: int | None = None
    # Send `categories` (1..8, multi-select). The single `category` is the
    # legacy field, still accepted so an old cached frontend keeps working.
    # When both are sent, `categories` wins (they are not required to agree).
    # After validation `categories` is always the de-duplicated list in
    # canonical order and `category` is its first entry (the primary).
    category: ReportCategory | None = None
    categories: list[ReportCategory] | None = Field(
        default=None, min_length=1, max_length=REPORT_CATEGORIES_MAX
    )
    details: str = Field(min_length=1, max_length=DETAILS_MAX_LENGTH)
    # Anonymous callers only. For a signed-in caller the service IGNORES
    # this and uses the verified token's email instead (see
    # listing_report_service.create_report), so it can't be spoofed.
    reporter_email: str | None = Field(default=None, max_length=EMAIL_MAX_LENGTH)
    # Honeypot — hidden from humans in the UI; a bot that fills every input
    # populates it. Any non-empty value => 201 fake success, nothing stored.
    # Length-capped only so a bot can't POST a megabyte into it.
    website: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _normalise_categories(self) -> "ReportCreate":
        chosen: list[str]
        if self.categories is not None:
            chosen = list(self.categories)
        elif self.category is not None:
            chosen = [self.category]
        else:
            raise ValueError("categories must contain at least one category")
        wanted = set(chosen)
        ordered = [c for c in REPORT_CATEGORY_ORDER if c in wanted]
        self.categories = ordered  # type: ignore[assignment]
        self.category = ordered[0]  # type: ignore[assignment]
        return self

    @field_validator("details")
    @classmethod
    def _details_not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("details must not be blank")
        return stripped

    @field_validator("reporter_email")
    @classmethod
    def _email_shape(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            return None
        if not _EMAIL_RE.match(stripped):
            raise ValueError("reporter_email is not a valid email address")
        return stripped


class ReportReceiptOut(BaseModel):
    """`POST /reports` response — deliberately minimal (no id, no echo of
    the submission), and identical whether the report was stored or a
    honeypot hit silently discarded it."""

    status: Literal["received"] = "received"


class ReportOut(BaseModel):
    """Admin-facing report row (`GET /reports`, `PATCH /reports/{id}`)."""

    report_id: int
    brand_id: int
    brand_name: str
    brand_slug: str
    location_id: int | None = None
    # The reported location's own page slug (null when no location was picked).
    location_slug: str | None = None
    location_address: str | None = None
    # Primary (first) category -- kept for existing clients.
    category: str
    # Every selected category, primary first. Always >= 1 item (rows that
    # predate multi-select report `[category]`).
    categories: list[str]
    details: str
    reporter_email: str | None = None
    reporter_user_id: str | None = None
    status: str
    submitted_at: UtcDatetime
    reviewed_by: str | None = None
    reviewed_at: UtcDatetime | None = None
    reviewer_notes: str | None = None


class ReportListResponse(BaseModel):
    results: list[ReportOut]
    page: int
    page_size: int
    total: int


class ReportUpdate(BaseModel):
    status: ReportStatus
    reviewer_notes: str | None = Field(default=None, max_length=NOTES_MAX_LENGTH)
