"""Unit test: `app/services/platform_config_service.py` — the read path for
the `platform_config` table backing the configurable manager/location caps
(docs/DECISIONS.md "Configurable manager/location caps via
platform_config"). Pure logic against a hand-rolled fake session (no DB),
matching the style of `tests/unit/test_manager_cap.py`.
"""
from __future__ import annotations

import pytest

from app.services import platform_config_service


class _FakeResult:
    def __init__(self, scalar):
        self._scalar = scalar

    def scalar_one_or_none(self):
        return self._scalar


class _FakeSession:
    def __init__(self, value):
        self._value = value
        self.executed = False

    async def execute(self, _stmt):
        self.executed = True
        return _FakeResult(self._value)


@pytest.mark.asyncio
async def test_get_config_value_returns_the_stored_string():
    db = _FakeSession("2")
    assert await platform_config_service.get_config_value(db, "max_active_managers_per_location") == "2"


@pytest.mark.asyncio
async def test_get_config_value_returns_none_when_row_missing():
    db = _FakeSession(None)
    assert await platform_config_service.get_config_value(db, "nonexistent_key") is None


@pytest.mark.asyncio
async def test_get_config_int_parses_the_stored_value():
    db = _FakeSession("7")
    assert await platform_config_service.get_config_int(db, "some_key", default=2) == 7


@pytest.mark.asyncio
async def test_get_config_int_falls_back_to_default_when_row_missing():
    db = _FakeSession(None)
    assert await platform_config_service.get_config_int(db, "some_key", default=2) == 2


@pytest.mark.asyncio
async def test_get_config_int_falls_back_to_default_on_unparseable_value():
    """Defensive: a corrupted/non-numeric `value` (e.g. a typo'd admin
    edit) must degrade to the default, never raise and 500 the request
    that reads it."""
    db = _FakeSession("not-a-number")
    assert await platform_config_service.get_config_int(db, "some_key", default=2) == 2
