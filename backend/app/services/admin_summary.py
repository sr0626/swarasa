"""Small shared helpers for the `summary` blocks on the admin list endpoints
(see `app/schemas/admin_summary.py`)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.schemas.admin_summary import SEEN_WINDOW_DAYS


def seen_cutoff(now: datetime | None = None) -> datetime:
    """Oldest `last_seen_at` that still counts as "seen in the last 30 days"."""
    return (now or datetime.now(timezone.utc)) - timedelta(days=SEEN_WINDOW_DAYS)


def seen_recently(last_seen: datetime | None, cutoff: datetime) -> bool:
    if last_seen is None:
        return False
    if last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    return last_seen >= cutoff
