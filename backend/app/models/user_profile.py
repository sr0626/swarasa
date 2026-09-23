"""user_profile — a minimal generic profile row for roles that have no
richer local business record of their own (`registered_user`, `manager`).

Owner already gets `full_name` (and `phone`, Stripe linkage, etc.) from
`owner_account` (see that model's docstring) — this table exists ONLY so a
`registered_user`/`manager` caller has somewhere to persist a display name
via `PATCH /auth/me`. It is intentionally NOT used for `owner`: see
`app/services/auth_service.py::update_me` — an `owner` caller keeps hitting
`owner_account`, never this table, so there is exactly one place an
owner's name lives, not two. `admin` is also not a consumer of this table
(out of scope for this change — admin identity/display, if ever needed, is
a separate decision).

ARCHITECT-LEVEL JUDGMENT CALL (flagged for review): Cognito's own
self-service `updateUserAttributes` was considered and rejected for this.
The frontend session cookie (`frontend/src/lib/auth/session.ts`) caches
ID-token claims captured at sign-in, so a Cognito attribute write would not
show up anywhere in the app until the next sign-in/token refresh — a bad
UX gap for something as simple as "set your display name." A small
Postgres table backing `GET`/`PATCH /auth/me` instead gives an immediate,
consistent read-your-write.

`cognito_sub` is the primary key (not a surrogate id + unique index) — this
table has no identity of its own; it only ever exists to be looked up or
upserted by `cognito_sub`, one row per Cognito user, so a derived PK adds
nothing.

Deliberately NOT registered in root CLAUDE.md's audited-entity list
("restaurant_brand, restaurant_location, menu_item, deal, owner_account,
location_manager") and `audit_log.record_id` is a `BigInteger` (polymorphic
across those tables' integer PKs) — `cognito_sub` is a string, so it does
not fit that column even if this table were added to the list. No
audit_log entry is written for `user_profile` writes; see
`auth_service.update_me`'s docstring for the same note.

`last_seen_at` (added for the admin "Registered users" report,
docs/PROJECT_PLAN.csv, docs/DECISIONS.md "Registered-user last-seen
tracking") is a second, independent reason a row now gets created here:
unlike `full_name` (only written on an explicit `PATCH /auth/me`),
`last_seen_at` is touched by `app.dependencies.auth._resolve_current_user`
on ordinary authenticated activity for `registered_user`/`manager`
callers — see that module and `auth_service.touch_last_seen` for the
throttled write and why `owner`/`admin` are deliberately excluded (owner
already has its own record in `owner_account`; giving it a
`last_seen_at`-only shadow row here would violate this table's
one-record-per-role-per-place invariant documented above). Nullable:
`NULL` reads as "never tracked yet" (e.g. a row that only exists because a
display name was set before this column existed, or before the caller's
first activity after this change shipped) — not the same as "signed up
but never returned", which the admin report renders as "Never".
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class UserProfile(Base):
    __tablename__ = "user_profile"

    # Cognito `sub` directly as the primary key — see module docstring.
    cognito_sub: Mapped[str] = mapped_column(String(36), primary_key=True)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # See module docstring "last_seen_at" note above.
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<UserProfile cognito_sub={self.cognito_sub!r}>"
