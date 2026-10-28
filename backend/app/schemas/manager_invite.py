"""Request/response shapes for manager invites — docs/API_CONTRACTS.md
"Manager invites". Own module for the same reason `schemas/location_manager.py`
is split out: a distinct sub-resource with its own request/response family.
"""
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.utc import UtcDatetime

# Deliberately loose (no `email-validator` dependency in this app): one "@",
# no whitespace, a dot in the domain. The invitee proves the address by
# signing up with it, so strict RFC validation buys nothing here.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

InviteStatus = Literal["pending", "expired"]


class ManagerInviteCreate(BaseModel):
    email: str = Field(min_length=3, max_length=254)

    @field_validator("email")
    @classmethod
    def _normalise_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not _EMAIL_RE.match(value):
            raise ValueError("Enter a valid email address")
        return value


class ManagerInviteOut(BaseModel):
    id: int
    location_id: int
    email: str
    status: InviteStatus
    created_at: UtcDatetime
    expires_at: UtcDatetime


class ManagerInviteCreatedOut(ManagerInviteOut):
    # The raw single-use token. Returned exactly once, on creation; only its
    # hash is stored, so it can never be shown again. The frontend builds
    # `${origin}/invite/${token}` from it.
    token: str


class ManagerInviteListResponse(BaseModel):
    results: list[ManagerInviteOut]
    page: int
    page_size: int
    total: int


class InviteTokenRequest(BaseModel):
    # In the body, not the URL path, so the secret never lands in access logs.
    token: str = Field(min_length=20, max_length=128)


class InvitePreviewOut(BaseModel):
    brand_name: str
    location_name: str | None
    city: str
    # e.g. "j***@example.com" — enough to recognise which address to sign up
    # with, without handing the full address to whoever holds the link.
    email_hint: str
    expires_at: UtcDatetime


class InviteAcceptedOut(BaseModel):
    location_id: int
    brand_name: str
    location_name: str | None
    # True when the caller was not yet in the Cognito `manager` group: their
    # current session token does not carry the new role, so the UI asks them
    # to sign in again.
    sign_in_again: bool
