"""Contact admin (`POST /contact-admin`) and the admin inbox
(`GET /admin/messages`, `PATCH /admin/messages/{id}`) — see
docs/API_CONTRACTS.md "Contact admin"."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

AdminMessageStatus = Literal["open", "resolved"]

SUBJECT_MIN_LENGTH = 3
SUBJECT_MAX_LENGTH = 120
BODY_MIN_LENGTH = 10
BODY_MAX_LENGTH = 4000
SEARCH_MAX_LENGTH = 100


class ContactAdminCreate(BaseModel):
    subject: str = Field(min_length=1, max_length=SUBJECT_MAX_LENGTH)
    body: str = Field(min_length=1, max_length=BODY_MAX_LENGTH)
    # Optional: a location the sender owns / is assigned to.
    related_location_id: int | None = None

    # Length rules are checked on the TRIMMED text, so "   a   " can't pass.
    @field_validator("subject")
    @classmethod
    def _subject_length(cls, value: str) -> str:
        stripped = value.strip()
        if len(stripped) < SUBJECT_MIN_LENGTH:
            raise ValueError(f"subject must be at least {SUBJECT_MIN_LENGTH} characters")
        return stripped

    @field_validator("body")
    @classmethod
    def _body_length(cls, value: str) -> str:
        stripped = value.strip()
        if len(stripped) < BODY_MIN_LENGTH:
            raise ValueError(f"message must be at least {BODY_MIN_LENGTH} characters")
        return stripped


class ContactAdminReceipt(BaseModel):
    status: Literal["received"] = "received"


class AdminMessageOut(BaseModel):
    message_id: int
    sender_role: str
    sender_email: str
    sender_name: str | None
    subject: str
    body: str
    related_location_id: int | None
    # Ready-to-render context for the related location (null when none, or
    # when the location has since been deleted).
    related_location_label: str | None
    related_location_brand_slug: str | None
    related_location_slug: str | None
    status: AdminMessageStatus
    created_at: datetime
    resolved_at: datetime | None
    resolved_by: str | None


class AdminMessageListResponse(BaseModel):
    results: list[AdminMessageOut]
    page: int
    page_size: int
    total: int
    # Open messages across the whole inbox, independent of the filters /
    # page — backs the "N open" badge on the admin overview.
    open_count: int


class AdminMessageUpdate(BaseModel):
    status: AdminMessageStatus
