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
  - `user_profile.last_seen_at` — local, throttled activity timestamp (see
    `app/services/auth_service.py::touch_last_seen`). `NULL`/missing row
    when the user has never had an authenticated request tracked yet.

Pagination is applied in Python, after fetching every Cognito group member
(see `cognito_service.list_registered_users`'s own docstring for why —
`ListUsersInGroup`'s cursor pagination doesn't map onto this project's
`page`/`page_size` convention) — not pushed down to either data source
individually, since the join needs the full row set to sort/paginate
consistently either way.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.pagination import Pagination
from app.models.user_profile import UserProfile
from app.schemas.admin_registered_users import RegisteredUserOut, RegisteredUsersResponse
from app.services import cognito_service

# Sort fallback for the (unexpected) case Cognito returns no
# `UserCreateDate` for a member — sorts those last rather than raising on
# a `None` comparison.
_EPOCH = datetime.fromtimestamp(0, tz=timezone.utc)


async def get_registered_users(
    db: AsyncSession, pagination: Pagination
) -> RegisteredUsersResponse:
    """Raises whatever `cognito_service.list_registered_users` raises
    (`RuntimeError`/`ClientError`/`BotoCoreError`) — the router turns that
    into a generic `502 upstream_error`, same posture as
    `GET /admin/registered-user-count` (no fabricated/stale data for an
    admin report on a Cognito failure).
    """
    cognito_users = cognito_service.list_registered_users()

    # Newest signup first — the natural "who just joined" reading for an
    # admin report, and a stable sort key (Cognito's own UserCreateDate)
    # so paginated pages don't reshuffle between requests the way sorting
    # by a live, ever-changing last_seen_at would.
    cognito_users.sort(
        key=lambda user: user.signup_at or _EPOCH,
        reverse=True,
    )

    total = len(cognito_users)
    start = pagination.offset
    page_slice = cognito_users[start : start + pagination.page_size]

    last_seen_by_sub: dict[str, object] = {}
    subs = [user.cognito_sub for user in page_slice if user.cognito_sub]
    if subs:
        rows = (
            await db.execute(
                select(UserProfile.cognito_sub, UserProfile.last_seen_at).where(
                    UserProfile.cognito_sub.in_(subs)
                )
            )
        ).all()
        last_seen_by_sub = {sub: last_seen_at for sub, last_seen_at in rows}

    results = [
        RegisteredUserOut(
            cognito_sub=user.cognito_sub,
            email=user.email,
            status=user.status,
            signup_at=user.signup_at,
            last_seen_at=last_seen_by_sub.get(user.cognito_sub),
        )
        for user in page_slice
    ]

    return RegisteredUsersResponse(
        results=results,
        page=pagination.page,
        page_size=pagination.page_size,
        total=total,
    )
