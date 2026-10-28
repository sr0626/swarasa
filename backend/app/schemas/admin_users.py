"""`GET /admin/users` and `POST /admin/users/{username}/<action>` -- see
docs/API_CONTRACTS.md "GET /admin/users". The admin user directory: one
searchable list across every role, sourced from Cognito.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from app.schemas.utc import UtcDatetime

UserRole = Literal["admin", "owner", "manager", "registered_user"]
UserStatusFilter = Literal["enabled", "disabled", "unconfirmed"]
UserSort = Literal["newest", "oldest", "email", "last_seen"]
UserAction = Literal["disable", "enable", "confirm", "reset-password"]


class AdminUserOut(BaseModel):
    # Cognito's own identifier -- what the action endpoints take.
    username: str
    cognito_sub: str
    email: str | None
    full_name: str | None = None
    # Highest-privilege pool group the user is in (admin > owner > manager >
    # registered_user); `roles` lists every group they belong to.
    role: UserRole
    roles: list[UserRole]
    # Cognito `UserStatus` verbatim (CONFIRMED, UNCONFIRMED, RESET_REQUIRED...).
    status: str
    # `status != "UNCONFIRMED"` -- i.e. the sign-up has been confirmed.
    confirmed: bool
    # Cognito `Enabled`; False = disabled by an admin (cannot sign in).
    enabled: bool
    created_at: UtcDatetime | None
    # `user_profile.last_seen_at`; null = never tracked.
    last_seen_at: UtcDatetime | None
    # True for the calling admin's own row (the UI hides disable/reset on it;
    # the server enforces the same rule regardless).
    is_self: bool = False


class AdminUsersResponse(BaseModel):
    results: list[AdminUserOut]
    page: int
    page_size: int
    total: int
    # True when at least one group had more members than the per-group cap
    # (`cognito_service.MAX_USERS_PER_GROUP`); the list is then incomplete.
    truncated: bool = False


class AdminUserActionResponse(BaseModel):
    username: str
    action: UserAction
    # State after the action. `enabled` is set for disable/enable; `status`
    # for confirm (CONFIRMED) / reset-password (RESET_REQUIRED).
    enabled: bool | None = None
    status: str | None = None
