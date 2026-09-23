"""`GET /admin/registered-users` — see docs/API_CONTRACTS.md "GET
/admin/registered-users". Own module (not folded into `admin_stats.py` or
`admin_overview.py`) since this combines two different data sources
(Cognito group membership + the local `user_profile.last_seen_at`) into a
row shape neither of those existing schemas models.
"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class RegisteredUserOut(BaseModel):
    cognito_sub: str
    email: str | None
    # Cognito `UserStatus` verbatim (e.g. "CONFIRMED", "UNCONFIRMED",
    # "FORCE_CHANGE_PASSWORD", "ARCHIVED", "COMPROMISED", "RESET_REQUIRED")
    # — never remapped/renamed here, so an admin reading this list sees the
    # same vocabulary the Cognito console itself uses.
    status: str
    signup_at: datetime | None
    # `null` = no local `user_profile` row has ever recorded activity for
    # this user yet (never returned since last_seen_at tracking shipped,
    # or returned only before it shipped) — rendered as "Never" by the
    # frontend, not the same as a `0`/epoch value.
    last_seen_at: datetime | None


class RegisteredUsersResponse(BaseModel):
    results: list[RegisteredUserOut]
    page: int
    page_size: int
    total: int
