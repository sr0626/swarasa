"""Flip (or read) a platform-level boolean feature flag stored in
`platform_config` — the ops path for switching menu-item photos on once paid
tiers exist (`menu_item_photos_enabled`, see
`app/services/platform_config_service.py`).

A Lambda management command (not an API endpoint, not admin UI): the
occasion is rare and ops-only, and the management-command pattern already
gives it the right trust boundary (IAM `lambda:InvokeFunction`, see
`app/scripts/management.py`) with no new public surface or authz code.

Only keys listed in `platform_config_service.KNOWN_BOOL_FLAGS` are accepted,
so a typo can't silently create a junk row that nothing ever reads. Upserts
the row (creating it if the migration's seed row is somehow absent) and is
idempotent. `platform_config` is not an audited entity (root CLAUDE.md
lists the audited tables); the change is recorded in the Lambda's
CloudWatch log line and in the command's response (old -> new value).

Run via the `set_platform_flag` management command (docs/SCRIPTS.md):
    {"_management_command": "set_platform_flag",
     "key": "menu_item_photos_enabled",
     "value": true}                      # omit "value" to just read it
"""
from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session_factory
from app.models.platform_config import PlatformConfig
from app.services import platform_config_service

logger = logging.getLogger("app.scripts.set_platform_flag")


class SetPlatformFlagError(Exception):
    """Bad input -- caught by the management-command wrapper and returned
    as `{"ok": False, "error": ...}`."""


def _coerce_value(raw: object) -> bool:
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        normalized = raw.strip().lower()
        if normalized in {"true", "1", "yes", "on"}:
            return True
        if normalized in {"false", "0", "no", "off"}:
            return False
    raise SetPlatformFlagError("'value' must be true or false.")


async def set_platform_flag(
    key: object, value: object = None, *, db: AsyncSession | None = None
) -> dict:
    """`db` is normally unset (a real session is opened) -- it exists so
    tests can inject the in-memory SQLite session, same as
    `set_user_name.set_user_name`. `value=None` reads without writing."""
    known = platform_config_service.KNOWN_BOOL_FLAGS
    if not isinstance(key, str) or key not in known:
        raise SetPlatformFlagError(f"'key' must be one of: {', '.join(known)}.")
    new_value = None if value is None else _coerce_value(value)

    if db is not None:
        return await _apply(db, key, new_value)
    async with get_session_factory()() as session:
        return await _apply(session, key, new_value)


async def _apply(db: AsyncSession, key: str, new_value: bool | None) -> dict:
    raw = await platform_config_service.get_config_value(db, key)
    old_value = platform_config_service.parse_bool(raw, default=False)
    if new_value is None:
        return {"key": key, "value": old_value, "changed": False}

    text = "true" if new_value else "false"
    row = await db.get(PlatformConfig, key)
    if row is None:
        db.add(PlatformConfig(key=key, value=text))
    else:
        row.value = text
    await db.commit()

    changed = old_value != new_value or raw is None
    logger.info("platform flag %s: %s -> %s", key, old_value, new_value)
    return {"key": key, "value": new_value, "previous": old_value, "changed": changed}
