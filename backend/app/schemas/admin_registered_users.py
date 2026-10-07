"""`GET /admin/registered-users` — see docs/API_CONTRACTS.md "GET
/admin/registered-users". Own module (not folded into `admin_stats.py` or
`admin_overview.py`) since this combines two different data sources
(Cognito group membership + the local `user_profile.last_seen_at`) into a
row shape neither of those existing schemas models.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from app.schemas.utc import UtcDatetime

# `newest` (default) / `oldest` by Cognito signup date, `email` A-Z,
# `last_seen` most recently seen first (never-seen rows last).
RegisteredUserSort = Literal["newest", "oldest", "email", "last_seen"]


class RegisteredUserOut(BaseModel):
    cognito_sub: str
    email: str | None
    # `user_profile.full_name` (the display name a diner set via
    # `PATCH /auth/me`); `null` for most diners. Searchable with `q`.
    full_name: str | None = None
    # Cognito `UserStatus` verbatim (e.g. "CONFIRMED", "UNCONFIRMED",
    # "FORCE_CHANGE_PASSWORD", "ARCHIVED", "COMPROMISED", "RESET_REQUIRED")
    # — never remapped/renamed here, so an admin reading this list sees the
    # same vocabulary the Cognito console itself uses.
    status: str
    signup_at: UtcDatetime | None
    # `null` = no local `user_profile` row has ever recorded activity for
    # this user yet (never returned since last_seen_at tracking shipped,
    # or returned only before it shipped) — rendered as "Never" by the
    # frontend, not the same as a `0`/epoch value.
    last_seen_at: UtcDatetime | None
    # Home location from `user_profile` (null until the diner sets it —
    # existing diners predating the mandatory-location rule show blank).
    city: str | None = None
    postal_code: str | None = None


class RegisteredUsersResponse(BaseModel):
    results: list[RegisteredUserOut]
    page: int
    page_size: int
    total: int
