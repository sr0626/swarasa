"""Unit test: the NEW symmetric "max active locations per manager" cap —
`location_manager_service.assert_manager_not_over_location_cap`, see that
function's own SCOPING JUDGMENT CALL docstring and docs/DECISIONS.md
"Symmetric manager-location cap".

Same hand-rolled-fake-session style as `test_manager_cap.py` (no DB, no
HTTP) — `platform_config_service.get_config_int` is monkeypatched per test
so `_FakeRowsSession` only needs to answer the one "manager's current
paid active assignments" query.
"""
from __future__ import annotations

import pytest

from app.core.errors import AppError
from app.models.restaurant_location import RestaurantLocation
from app.services import location_manager_service


class _FakeRowsResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _FakeRowsSession:
    """`rows` mimics what the real query in `_paid_active_assignments_for_
    manager` selects: (location_id, location_name, brand_name, city)."""

    def __init__(self, rows):
        self._rows = rows
        self.executed = False

    async def execute(self, _stmt):
        self.executed = True
        return _FakeRowsResult(self._rows)


def _location(*, is_paid: bool, location_id: int = 99) -> RestaurantLocation:
    return RestaurantLocation(
        id=location_id, brand_id=1, address_line1="1 Main St", city="Frisco", state="TX",
        postal_code="75034", is_paid=is_paid,
    )


@pytest.fixture(autouse=True)
def _fixed_cap_config(monkeypatch):
    async def _fake_get_config_int(_db, _key, default):
        return default

    monkeypatch.setattr(
        location_manager_service.platform_config_service,
        "get_config_int",
        _fake_get_config_int,
    )


@pytest.mark.asyncio
async def test_free_tier_target_location_skips_the_check_entirely():
    """SCOPING JUDGMENT CALL: gated on the TARGET location being paid, same
    trigger as the location-side cap — assigning to a free location never
    even queries the manager's existing assignments."""
    db = _FakeRowsSession(rows=[(1, "A", "B", "Plano")] * 50)  # would blow any cap if checked
    location = _location(is_paid=False)
    await location_manager_service.assert_manager_not_over_location_cap(db, "sub-1", location)
    assert db.executed is False


@pytest.mark.asyncio
async def test_manager_with_zero_paid_assignments_is_allowed():
    db = _FakeRowsSession(rows=[])
    location = _location(is_paid=True)
    await location_manager_service.assert_manager_not_over_location_cap(db, "sub-1", location)


@pytest.mark.asyncio
async def test_manager_under_cap_is_allowed():
    db = _FakeRowsSession(rows=[(1, "Dera Grill", "Dera Grill", "Irving")])
    location = _location(is_paid=True)
    await location_manager_service.assert_manager_not_over_location_cap(db, "sub-1", location)


@pytest.mark.asyncio
async def test_manager_at_cap_is_rejected_and_names_the_locations():
    """Task requirement: the error must NAME the locations, e.g. "Dera
    Grill (Irving), Taj Chaat House (Plano)" — not just report a count."""
    db = _FakeRowsSession(
        rows=[
            (1, None, "Dera Grill", "Irving"),  # no location_name override -> falls back to brand name
            (2, "Taj Chaat House - Plano", "Taj Chaat House", "Plano"),
        ]
    )
    location = _location(is_paid=True, location_id=3)
    with pytest.raises(AppError) as exc_info:
        await location_manager_service.assert_manager_not_over_location_cap(db, "sub-1", location)
    assert exc_info.value.status_code == 409
    assert exc_info.value.code == "manager_location_cap_reached"
    assert "Dera Grill (Irving)" in exc_info.value.detail
    assert "Taj Chaat House - Plano (Plano)" in exc_info.value.detail


@pytest.mark.asyncio
async def test_cap_value_is_read_from_config_not_hardcoded(monkeypatch):
    async def _fake_get_config_int(_db, _key, _default):
        return 3

    monkeypatch.setattr(
        location_manager_service.platform_config_service,
        "get_config_int",
        _fake_get_config_int,
    )
    db = _FakeRowsSession(
        rows=[(1, "A", "A", "Plano"), (2, "B", "B", "Frisco")]
    )
    location = _location(is_paid=True, location_id=3)
    # 2 existing paid assignments, cap overridden to 3 -> allowed.
    await location_manager_service.assert_manager_not_over_location_cap(db, "sub-1", location)
