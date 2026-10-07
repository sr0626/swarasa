"""`UtcDatetime` (app/schemas/utc.py): admin timestamps always serialize as
explicit UTC, so a browser never re-interprets a bare time as its own local
time (admin-console timestamp-mismatch bug)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from pydantic import BaseModel

from app.schemas.activity import UserActivityResponse  # noqa: F401  (schema imports cleanly)
from app.schemas.utc import UtcDatetime, ensure_utc


class _Row(BaseModel):
    at: UtcDatetime
    maybe: UtcDatetime | None = None


def test_naive_datetime_is_stamped_utc_not_shifted():
    naive = datetime(2026, 9, 24, 22, 45, 0)
    assert ensure_utc(naive) == datetime(2026, 9, 24, 22, 45, 0, tzinfo=timezone.utc)
    assert _Row(at=naive).model_dump_json() == '{"at":"2026-09-24T22:45:00Z","maybe":null}'


def test_aware_datetime_keeps_the_same_instant_in_utc():
    cdt = timezone(timedelta(hours=-5))
    aware = datetime(2026, 9, 24, 17, 45, 0, tzinfo=cdt)
    out = ensure_utc(aware)
    assert out == aware
    assert out.utcoffset() == timedelta(0)
    assert _Row(at=aware).model_dump_json() == '{"at":"2026-09-24T22:45:00Z","maybe":null}'


def test_optional_none_stays_none_and_z_strings_parse():
    row = _Row(at="2026-09-24T22:45:00Z", maybe=None)
    assert row.maybe is None
    assert row.at == datetime(2026, 9, 24, 22, 45, tzinfo=timezone.utc)
