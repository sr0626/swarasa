"""Listing reports (/reports) — see docs/API_CONTRACTS.md "Listing reports
(`/reports`)"."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

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
    category: ReportCategory
    details: str = Field(min_length=1, max_length=DETAILS_MAX_LENGTH)
    # Anonymous callers only. For a signed-in caller the service IGNORES
    # this and uses the verified token's email instead (see
    # listing_report_service.create_report), so it can't be spoofed.
    reporter_email: str | None = Field(default=None, max_length=EMAIL_MAX_LENGTH)
    # Honeypot — hidden from humans in the UI; a bot that fills every input
    # populates it. Any non-empty value => 201 fake success, nothing stored.
    # Length-capped only so a bot can't POST a megabyte into it.
    website: str | None = Field(default=None, max_length=500)

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
    category: str
    details: str
    reporter_email: str | None = None
    reporter_user_id: str | None = None
    status: str
    submitted_at: datetime
    reviewed_by: str | None = None
    reviewed_at: datetime | None = None
    reviewer_notes: str | None = None


class ReportListResponse(BaseModel):
    results: list[ReportOut]
    page: int
    page_size: int
    total: int


class ReportUpdate(BaseModel):
    status: ReportStatus
    reviewer_notes: str | None = Field(default=None, max_length=NOTES_MAX_LENGTH)
