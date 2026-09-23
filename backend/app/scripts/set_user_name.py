"""Admin override for a locked display name: change an EXISTING `full_name`.

Why this exists: `PATCH /auth/me` deliberately refuses to change a
`full_name` once it is set (`409 name_locked`, see
`app/services/auth_service.py::update_me`) -- "the only way to change a
name is contacting an admin". This is that admin path. It is a Lambda
management command (not an API endpoint, not admin UI) because the
occasion is rare, ops-only, and the repo's management-command pattern
already gives it the right trust boundary (IAM `lambda:InvokeFunction`, see
`app/scripts/management.py`'s module docstring) with no new public
surface, no new authz code and no frontend work.

Scope, deliberately narrow:
- Only CHANGES a name that already exists. A user with no name set yet
  (no `owner_account`/`user_profile` name) is refused with a clear reason:
  they can set it themselves once from their account page, and writing a
  name for someone who has never signed in risks landing it in the wrong
  table (an owner reads `owner_account`, everyone else `user_profile`).
- Target table is decided by what already holds the name: an
  `owner_account` row with a name -> that row; otherwise a `user_profile`
  row with a name -> that row.
- `owner_account` writes are audit-logged (root CLAUDE.md "ALWAYS write an
  audit_log entry ... owner_account"), actor `system:set_user_name`, role
  `admin`, old/new value. `user_profile` is not on the audited-entity list
  and `audit_log.record_id` is a BigInteger that a Cognito `sub` string
  cannot fit (same reasoning as `update_me`), so that path is recorded in
  the Lambda's CloudWatch log line instead.

Run via the `set_user_name` management command (docs/SCRIPTS.md):
    {"_management_command": "set_user_name",
     "email": "user@example.com",            # OR "cognito_sub": "..."
     "full_name": "New Name"}
"""
from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session_factory
from app.schemas.auth import FULL_NAME_MAX_LENGTH
from app.services import audit_service
from app.services.auth_service import get_owner_account_by_sub, get_user_profile_by_sub
from app.services.cognito_service import find_sub_by_email

logger = logging.getLogger("app.scripts.set_user_name")

ACTOR_ID = "system:set_user_name"


class SetUserNameError(Exception):
    """Bad input or unresolvable target -- caught by the management-command
    wrapper and returned as `{"ok": False, "error": ...}`."""


def _clean_name(raw: object) -> str:
    if not isinstance(raw, str) or not raw.strip():
        raise SetUserNameError("'full_name' must be a non-empty string.")
    name = raw.strip()
    if len(name) > FULL_NAME_MAX_LENGTH:
        raise SetUserNameError(f"'full_name' must be at most {FULL_NAME_MAX_LENGTH} characters.")
    return name


async def set_user_name(
    full_name: object,
    email: str | None = None,
    cognito_sub: str | None = None,
    *,
    db: AsyncSession | None = None,
) -> dict:
    """`db` is normally unset (a real session is opened) -- it exists so
    tests can inject the in-memory SQLite session, same as
    `delete_user_data.delete_user_data`."""
    name = _clean_name(full_name)
    if not email and not cognito_sub:
        raise SetUserNameError("Provide either 'email' or 'cognito_sub'.")

    sub = cognito_sub
    if not sub:
        sub = find_sub_by_email(email)  # sync boto3 call, same as elsewhere
        if not sub:
            raise SetUserNameError("No user found for that email.")

    if db is not None:
        return await _apply(db, sub, name)
    session_factory = get_session_factory()
    async with session_factory() as owned_db:
        return await _apply(owned_db, sub, name)


async def _apply(db: AsyncSession, sub: str, name: str) -> dict:
    owner = await get_owner_account_by_sub(db, sub)
    if owner is not None and (owner.full_name or "").strip():
        old = owner.full_name
        if old == name:
            return {"ok": True, "changed": False, "target": "owner_account", "full_name": name}
        owner.full_name = name
        await audit_service.log(
            db,
            table_name="owner_account",
            record_id=owner.id,
            action="update",
            actor_id=ACTOR_ID,
            actor_role="admin",
            old_val={"full_name": old},
            new_val={"full_name": name},
        )
        await db.commit()
        logger.info("set_user_name: owner_account %s renamed", owner.id)
        return {"ok": True, "changed": True, "target": "owner_account", "full_name": name}

    profile = await get_user_profile_by_sub(db, sub)
    if profile is not None and (profile.full_name or "").strip():
        if profile.full_name == name:
            return {"ok": True, "changed": False, "target": "user_profile", "full_name": name}
        profile.full_name = name
        await db.commit()
        logger.info("set_user_name: user_profile %s renamed", sub)
        return {"ok": True, "changed": True, "target": "user_profile", "full_name": name}

    raise SetUserNameError(
        "That user has no name set yet, so there is nothing to change -- they can "
        "set it themselves from their account page."
    )


async def run_set_user_name(full_name: object, email: str | None, cognito_sub: str | None) -> dict:
    return await set_user_name(full_name, email=email, cognito_sub=cognito_sub)
