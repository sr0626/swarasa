"""/auth — see docs/API_CONTRACTS.md "Auth (/auth)"."""
from __future__ import annotations

from pydantic import BaseModel, field_validator

from app.core.phone import US_PHONE_ERROR, normalize_us_phone

# Matches owner_account.full_name / user_profile.full_name column width
# (both varchar(255) — see app/models/owner_account.py, app/models/user_profile.py).
FULL_NAME_MAX_LENGTH = 255


class OwnerAccountOut(BaseModel):
    id: int
    full_name: str | None
    phone: str | None
    stripe_customer_id: str | None


class ProfileOut(BaseModel):
    """`PATCH /auth/me` response for a `registered_user`/`manager` caller
    (backed by `user_profile`, see that model's docstring) — owner callers
    keep getting the richer `OwnerAccountOut` (id/phone/stripe_customer_id)
    unchanged, since only owner_account has those fields."""

    full_name: str | None


class MeResponse(BaseModel):
    cognito_sub: str
    role: str
    email: str | None
    # Unified display name regardless of backing source: owner_account.full_name
    # for an `owner` caller, user_profile.full_name for `registered_user`/
    # `manager`, `None` for `admin` (no local profile record for admin either
    # — see app/models/user_profile.py). Added so the frontend never has to
    # know which table a given role's name actually lives in — it just reads
    # `full_name` off this response regardless of role.
    full_name: str | None
    owner_account: OwnerAccountOut | None


class MeUpdateRequest(BaseModel):
    full_name: str | None = None
    phone: str | None = None

    @field_validator("full_name")
    @classmethod
    def _normalise_full_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("full_name must not be empty")
        if len(value) > FULL_NAME_MAX_LENGTH:
            raise ValueError(f"full_name must be at most {FULL_NAME_MAX_LENGTH} characters")
        return value

    @field_validator("phone")
    @classmethod
    def _validate_phone(cls, value: str | None) -> str | None:
        """Shared US phone rule (app/core/phone.py). `None` (key omitted or
        null) leaves the stored phone untouched, exactly as before; a
        provided value must be a valid 10-digit US number and is stored in
        the canonical `+1XXXXXXXXXX` form. A blank string is rejected — the
        old free-for-all accepted any 8-15 digit string, incl. 11-digit
        non-US-shaped numbers."""
        if value is None:
            return None
        normalized = normalize_us_phone(value)
        if normalized is None:
            raise ValueError(US_PHONE_ERROR)
        return normalized
