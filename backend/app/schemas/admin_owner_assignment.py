"""Request/response models for the admin owner-assignment endpoints:
`POST /admin/restaurants/{brand_id}/assign-owner` and `POST /admin/owners`.
See docs/API_CONTRACTS.md "Admin: assign an owner to an unclaimed listing"
and "POST /admin/owners". Deliberately no billing fields.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.utc import UtcDatetime

EMAIL_MAX_LENGTH = 255


def _normalize_email(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip().lower()
    if not cleaned:
        return None
    # Light shape check only (`email-validator` isn't a dependency, same as
    # the other schemas); Cognito is the real arbiter of whether it exists.
    local, sep, domain = cleaned.partition("@")
    if not sep or not local or "." not in domain or " " in cleaned:
        raise ValueError("Enter a valid email address")
    return cleaned


class AssignOwnerRequest(BaseModel):
    """Identify the owner by `owner_account.id` OR by account email —
    exactly one."""

    model_config = ConfigDict(extra="forbid")

    owner_id: int | None = Field(default=None, ge=1)
    owner_email: str | None = Field(default=None, max_length=EMAIL_MAX_LENGTH)

    @field_validator("owner_email")
    @classmethod
    def _email(cls, value: str | None) -> str | None:
        return _normalize_email(value)

    @model_validator(mode="after")
    def _exactly_one(self) -> "AssignOwnerRequest":
        if (self.owner_id is None) == (self.owner_email is None):
            raise ValueError("Provide exactly one of owner_id or owner_email")
        return self


class AssignOwnerResponse(BaseModel):
    brand_id: int
    owner_id: int
    owner_email: str
    is_claimed: bool
    # True when the owner_account row was created by this call (the email
    # belonged to a Cognito `owner`-group user with no local row yet).
    owner_account_created: bool
    # Active location_manager rows on this brand's locations that were
    # revoked because the manager already works for a DIFFERENT owner.
    revoked_manager_count: int


class AddOwnerRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(max_length=EMAIL_MAX_LENGTH)

    @field_validator("email")
    @classmethod
    def _email(cls, value: str) -> str:
        normalized = _normalize_email(value)
        if normalized is None:
            raise ValueError("Enter a valid email address")
        return normalized


class AddOwnerResponse(BaseModel):
    id: int
    email: str
    joined_at: UtcDatetime
