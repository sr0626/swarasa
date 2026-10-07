"""`UtcDatetime` — a datetime that is ALWAYS timezone-aware in API output.

Why this exists (admin-console timestamp bug, 2026-09-24): every timestamp
column in this schema is `DateTime(timezone=True)`, so on Aurora/Postgres
asyncpg hands back aware datetimes and Pydantic serializes them with a
`Z`/`+00:00` suffix. A NAIVE datetime (SQLite in the test suite, or any
future code path that builds one with `datetime.utcnow()`) would serialize
with NO offset, and a browser's `new Date("2026-09-24T22:45:00")` reads
that as the viewer's LOCAL time — silently shifting every displayed time by
the viewer's UTC offset. Every stored timestamp in this app is UTC, so a
naive value is interpreted as UTC and stamped as such at the schema
boundary; an already-aware value is normalised to UTC (same instant).

Use on response models for admin-facing timestamps. The frontend's shared
formatter (`frontend/src/lib/formatDateTime.ts`) applies the same
"naive means UTC" rule defensively, so the two layers agree.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from pydantic import AfterValidator


def ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


UtcDatetime = Annotated[datetime, AfterValidator(ensure_utc)]
