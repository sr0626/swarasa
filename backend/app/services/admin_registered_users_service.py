"""`GET /admin/registered-users` — the admin "Registered users" report:
email, Cognito status, signup date and (throttled, best-effort) last-visited
timestamp for every diner (`registered_user` pool group member). See
docs/API_CONTRACTS.md "GET /admin/registered-users" and
docs/DECISIONS.md "Registered-user last-seen tracking".

Combines two independent sources, joined in application code by
`cognito_sub`:
  - Cognito (`cognito_service.list_registered_users`) — email, status,
    signup date. Source of truth for "who signed up" (same reasoning as
    `GET /admin/registered-user-count` — see that endpoint's docstring for
    why a local table can't answer this).
  - `user_profile` — `last_seen_at` (local, throttled activity timestamp,
    see `app/services/auth_service.py::touch_last_seen`) and `full_name`
    (the display name a diner set). Missing row when the user has never had
    an authenticated request tracked and never set a name.

Search (`q`), sort and pagination are all applied in Python, after
fetching every Cognito group member (see
`cognito_service.list_registered_users`'s own docstring for why —
`ListUsersInGroup`'s cursor pagination doesn't map onto this project's
`page`/`page_size` convention). Search and the `last_seen` sort need
every user's profile row, so the local half is ONE query (chunked to keep
the bind-parameter count bounded) over the whole group, not a per-page one.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.pagination import Pagination
from app.models.user_profile import UserProfile
from app.schemas.admin_registered_users import (
    RegisteredUserOut,
    RegisteredUserSort,
    RegisteredUsersResponse,
)
from app.services import cognito_service

_CHUNK = 500


def _ts(value: datetime | None) -> float | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.timestamp()


def _sorted_missing_last(items: list[RegisteredUserOut], key, *, reverse: bool):
    """Sort by `key` (asc, or desc with `reverse`), rows whose key is
    `None` always last; `cognito_sub` is the final tiebreaker so pages
    never reshuffle."""
    present = [u for u in items if key(u) is not None]
    missing = [u for u in items if key(u) is None]
    present.sort(key=lambda u: (key(u), u.cognito_sub), reverse=reverse)
    missing.sort(key=lambda u: u.cognito_sub)
    return present + missing


def _apply_sort(items: list[RegisteredUserOut], sort: RegisteredUserSort):
    if sort == "oldest":
        return _sorted_missing_last(items, lambda u: _ts(u.signup_at), reverse=False)
    if sort == "email":
        return _sorted_missing_last(
            items, lambda u: u.email.lower() if u.email else None, reverse=False
        )
    if sort == "last_seen":
        return _sorted_missing_last(items, lambda u: _ts(u.last_seen_at), reverse=True)
    return _sorted_missing_last(items, lambda u: _ts(u.signup_at), reverse=True)


async def get_registered_users(
    db: AsyncSession,
    pagination: Pagination,
    search: str | None = None,
    sort: RegisteredUserSort = "newest",
) -> RegisteredUsersResponse:
    """Raises whatever `cognito_service.list_registered_users` raises
    (`RuntimeError`/`ClientError`/`BotoCoreError`) — the router turns that
    into a generic `502 upstream_error`, same posture as
    `GET /admin/registered-user-count` (no fabricated/stale data for an
    admin report on a Cognito failure).
    """
    cognito_users = cognito_service.list_registered_users()

    profiles: dict[str, tuple[str | None, datetime | None]] = {}
    subs = [user.cognito_sub for user in cognito_users if user.cognito_sub]
    for start in range(0, len(subs), _CHUNK):
        rows = (
            await db.execute(
                select(
                    UserProfile.cognito_sub, UserProfile.full_name, UserProfile.last_seen_at
                ).where(UserProfile.cognito_sub.in_(subs[start : start + _CHUNK]))
            )
        ).all()
        profiles.update({sub: (name, seen) for sub, name, seen in rows})

    users = [
        RegisteredUserOut(
            cognito_sub=user.cognito_sub,
            email=user.email,
            full_name=profiles.get(user.cognito_sub, (None, None))[0],
            status=user.status,
            signup_at=user.signup_at,
            last_seen_at=profiles.get(user.cognito_sub, (None, None))[1],
        )
        for user in cognito_users
    ]

    term = (search or "").strip().lower()
    if term:
        users = [
            u
            for u in users
            if term in (u.email or "").lower() or term in (u.full_name or "").lower()
        ]

    users = _apply_sort(users, sort)
    total = len(users)
    page_slice = users[pagination.offset : pagination.offset + pagination.page_size]

    return RegisteredUsersResponse(
        results=page_slice,
        page=pagination.page,
        page_size=pagination.page_size,
        total=total,
    )
