"""Reads `platform_config` — see `app/models/platform_config.py` for the
Postgres-vs-DynamoDB judgment call and why this table is generic key/text
rather than typed columns.

Caching: deliberately none. This is a single-row-per-key lookup against a
tiny table (two rows today) with its primary key as the lookup predicate —
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
