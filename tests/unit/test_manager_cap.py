"""Unit test: location_manager 2-active-per-location cap (paid tier only) —
DECISIONS.md "Assignable location managers capped at 2 per location on paid
tier (was unlimited)" and `app/services/location_manager_service.py`.

NOTE (flagged, matches the module's own docstring — not a QA-introduced
gap): no `/locations/{id}/managers`-shaped endpoint exists in
`docs/API_CONTRACTS.md` or is wired into any router on this branch, so this
cap-check function is not reachable via any live Phase 1 HTTP endpoint
today. Covered here at the unit level anyway per tests/CLAUDE.md's required
Phase 1 unit coverage ("location_manager 2-active cap logic") so the logic
is proven correct and ready the moment a manager-assignment endpoint is
added.

UPDATED 2026-09-22: the cap value is no longer the hardcoded
`MAX_ACTIVE_MANAGERS_PER_LOCATION_PAID` constant — it's read from
`platform_config` via `platform_config_service.get_config_int` (see
`docs/DECISIONS.md` "Configurable manager/location caps via
platform_config"). `platform_config_service.get_config_int` is
monkeypatched to a fixed value in every test below so `_FakeSession`
(which only knows how to answer ONE kind of query — the active-manager
count) doesn't also need to fake a `platform_config` row lookup; this
isolates "does the cap-check logic count and compare correctly" from
"does config actually get read" (covered separately in
`test_platform_config_service.py`). `test_cap_value_is_read_from_config_
not_hardcoded` below is the one test that proves the cap number itself
really does come from the (mocked) config call, not the constant.
"""
from __future__ import annotations

import pytest

from app.core.errors import AppError
from app.models.restaurant_location import RestaurantLocation
from app.services import location_manager_service


class _FakeResult:
    def __init__(self, scalar):
        self._scalar = scalar

    def scalar_one(self):
        return self._scalar


class _FakeSession:
    def __init__(self, count: int):
        self._count = count
        self.executed = False

    async def execute(self, _stmt):
        self.executed = True
        return _FakeResult(self._count)


def _location(*, is_paid: bool) -> RestaurantLocation:
    return RestaurantLocation(
        id=1, brand_id=1, address_line1="1 Main St", city="Plano", state="TX",
        postal_code="75024", is_paid=is_paid,
    )


@pytest.fixture(autouse=True)
def _fixed_cap_config(monkeypatch):
    """Pin the config-driven cap to the documented default (2) for every
    test in this file unless a test overrides it — see module docstring.
    """
    async def _fake_get_config_int(_db, _key, default):
        return default

    monkeypatch.setattr(
        location_manager_service.platform_config_service,
        "get_config_int",
        _fake_get_config_int,
    )


@pytest.mark.asyncio
async def test_free_tier_location_has_no_manager_cap():
    """DECISIONS.md: cap only applies "on paid tier" — free tier locations
    aren't even counted (no query at all).
    """
    db = _FakeSession(count=50)  # would blow any cap if it were checked
    location = _location(is_paid=False)
    await location_manager_service.assert_can_add_active_manager(db, location)  # no raise
    assert db.executed is False


@pytest.mark.asyncio
async def test_paid_tier_under_cap_is_allowed():
    db = _FakeSession(count=1)
    location = _location(is_paid=True)
    await location_manager_service.assert_can_add_active_manager(db, location)  # no raise


@pytest.mark.asyncio
async def test_paid_tier_at_cap_is_rejected():
    db = _FakeSession(count=2)
    location = _location(is_paid=True)
    with pytest.raises(AppError) as exc_info:
        await location_manager_service.assert_can_add_active_manager(db, location)
    assert exc_info.value.status_code == 409
    assert exc_info.value.code == "manager_cap_reached"


@pytest.mark.asyncio
async def test_paid_tier_over_cap_is_rejected():
    """Defensive: even if the count somehow exceeds 2 (a bug elsewhere
    already let it happen), adding one more must still be rejected, not
    silently allowed because `count == limit` was the only check.
    """
    db = _FakeSession(count=3)
    location = _location(is_paid=True)
    with pytest.raises(AppError):
        await location_manager_service.assert_can_add_active_manager(db, location)


@pytest.mark.asyncio
async def test_cap_value_is_read_from_config_not_hardcoded(monkeypatch):
    """Overrides the (mocked) config value to 5 — 3 active managers must
    now be ALLOWED (under a 5 cap), proving the cap number really is
    sourced from `platform_config_service.get_config_int`, not the
    `MAX_ACTIVE_MANAGERS_PER_LOCATION_PAID` constant."""
    async def _fake_get_config_int(_db, _key, _default):
        return 5

    monkeypatch.setattr(
        location_manager_service.platform_config_service,
        "get_config_int",
        _fake_get_config_int,
    )
    db = _FakeSession(count=3)
    location = _location(is_paid=True)
    await location_manager_service.assert_can_add_active_manager(db, location)  # no raise

    # Same count, but now AT the overridden cap of 5 managers -> rejected,
    # and the message reflects the configured number, not "2".
    db_at_cap = _FakeSession(count=5)
    with pytest.raises(AppError) as exc_info:
        await location_manager_service.assert_can_add_active_manager(db_at_cap, location)
    assert "5 active managers" in exc_info.value.detail
