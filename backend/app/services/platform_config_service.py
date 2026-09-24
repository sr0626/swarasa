"""Reads `platform_config` — see `app/models/platform_config.py` for the
Postgres-vs-DynamoDB judgment call and why this table is generic key/text
rather than typed columns.

Caching: deliberately none. This is a single-row-per-key lookup against a
tiny table (a handful of rows) with its primary key as the lookup predicate —
the cheapest possible query this app makes. `location_manager_service`
calls this at most twice per assignment request (once per cap), which is
negligible next to the Cognito `ListUsers` call the same request already
makes. Adding a cache (in-process TTL, request-scoped dict, etc.) would be
solving a performance problem that doesn't exist yet at this scale — if a
config value is changed by an admin, every subsequent read should see it
immediately with no cache to invalidate. Revisit only if this ever moves
onto a hot path called many times per request.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.platform_config import PlatformConfig

# Platform-level boolean feature flags stored as "true"/"false" text rows.
# The `set_platform_flag` management command only accepts keys listed here,
# so a typo can't silently create a junk row that nothing reads.
#
# menu_item_photos_enabled — menu-item photo upload/display. Fully built but
#   OFF (default) until paid tiers exist; when off, no menu photo URL is
#   returned and the photo endpoints reject writes. FUTURE INTENT (not
#   implemented): when billing lands, gate per location by
#   `restaurant_location.is_paid` in addition to this flag.
MENU_ITEM_PHOTOS_ENABLED_KEY = "menu_item_photos_enabled"
KNOWN_BOOL_FLAGS: tuple[str, ...] = (MENU_ITEM_PHOTOS_ENABLED_KEY,)

_TRUE_VALUES = frozenset({"true", "1", "yes", "on"})
_FALSE_VALUES = frozenset({"false", "0", "no", "off"})


async def get_config_value(db: AsyncSession, key: str) -> str | None:
    """Raw string value for `key`, or `None` if the row doesn't exist."""
    result = await db.execute(select(PlatformConfig.value).where(PlatformConfig.key == key))
    return result.scalar_one_or_none()


async def get_config_int(db: AsyncSession, key: str, default: int) -> int:
    """Int-parsed config value, falling back to `default` when the row is
    missing OR holds a value that doesn't parse as an int (defensive —
    an admin/migration typo in `value` should degrade to the documented
    default, never 500 the request that reads it).
    """
    raw = await get_config_value(db, key)
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def parse_bool(raw: str | None, default: bool) -> bool:
    """`"true"/"1"/"yes"/"on"` -> True, `"false"/"0"/"no"/"off"` -> False
    (case-insensitive, trimmed); anything else — missing, empty, garbage —
    falls back to `default`."""
    if raw is None:
        return default
    normalized = raw.strip().lower()
    if normalized in _TRUE_VALUES:
        return True
    if normalized in _FALSE_VALUES:
        return False
    return default


async def get_config_bool(db: AsyncSession, key: str, default: bool) -> bool:
    """Bool-parsed config value; missing row or unparsable text degrades to
    `default` (same defensive posture as `get_config_int`)."""
    return parse_bool(await get_config_value(db, key), default)
