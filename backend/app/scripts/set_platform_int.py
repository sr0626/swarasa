"""Set (or read) an integer business setting stored in `platform_config` —
today only `catering_max_restaurants` (how many restaurants one catering
quote request may be sent to; seeded "5" by migration 0024).

Sibling of `set_platform_flag` (booleans): a Lambda management command with
the same trust boundary (IAM `lambda:InvokeFunction`), upserting the row,
idempotent, accepting only keys in `KNOWN_INT_SETTINGS` (name -> (min, max))
so a typo can't create a junk row nothing reads. The reader clamps too
(`catering_service.get_max_restaurants`), but rejecting bad values here keeps
the stored value honest.

    {"_management_command": "set_platform_int",
     "key": "catering_max_restaurants",
     "value": 8}                          # omit "value" to just read it
"""
from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session_factory
from app.models.platform_config import PlatformConfig
from app.services import platform_config_service

logger = logging.getLogger("app.scripts.set_platform_int")

# key -> (default, min, max)
KNOWN_INT_SETTINGS: dict[str, tuple[int, int, int]] = {
    "catering_max_restaurants": (5, 1, 20),
}


class SetPlatformIntError(Exception):
    """Bad input -- returned by the management wrapper as `{"ok": False, ...}`."""


async def set_platform_int(
    key: object, value: object = None, *, db: AsyncSession | None = None
) -> dict:
    if not isinstance(key, str) or key not in KNOWN_INT_SETTINGS:
        raise SetPlatformIntError(f"'key' must be one of: {', '.join(KNOWN_INT_SETTINGS)}.")
    _default, low, high = KNOWN_INT_SETTINGS[key]
    new_value: int | None = None
    if value is not None:
        if isinstance(value, bool) or not isinstance(value, (int, str)):
            raise SetPlatformIntError("'value' must be a whole number.")
        try:
            new_value = int(value)
        except ValueError as exc:
            raise SetPlatformIntError("'value' must be a whole number.") from exc
        if not low <= new_value <= high:
            raise SetPlatformIntError(f"'value' must be between {low} and {high}.")

    if db is not None:
        return await _apply(db, key, new_value)
    async with get_session_factory()() as session:
        return await _apply(session, key, new_value)


async def _apply(db: AsyncSession, key: str, new_value: int | None) -> dict:
    default = KNOWN_INT_SETTINGS[key][0]
    old_value = await platform_config_service.get_config_int(db, key, default)
    if new_value is None:
        return {"key": key, "value": old_value, "changed": False}
    row = await db.get(PlatformConfig, key)
    if row is None:
        db.add(PlatformConfig(key=key, value=str(new_value)))
    else:
        row.value = str(new_value)
    await db.commit()
    logger.info("platform setting %s: %s -> %s", key, old_value, new_value)
    return {"key": key, "value": new_value, "previous": old_value, "changed": old_value != new_value}
