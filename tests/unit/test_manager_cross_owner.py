"""Unit test: `location_manager_service.assert_manager_belongs_to_same_
owner` — the new "a manager is scoped to one owner at a time" invariant.
See that function's own INVARIANT JUDGMENT CALL docstring and
docs/DECISIONS.md "Manager scoped to one owner at a time" for the full
reasoning. Hand-rolled fake session, same style as the other new unit
tests in this file's sibling modules.
"""
from __future__ import annotations

import pytest

from app.core.errors import AppError
from app.services import location_manager_service


class _FakeResult:
    def __init__(self, scalar):
        self._scalar = scalar

    def scalar_one_or_none(self):
        return self._scalar


class _FakeSession:
    def __init__(self, conflicting_owner_id):
        self._conflicting_owner_id = conflicting_owner_id
        self.executed = False

    async def execute(self, _stmt):
        self.executed = True
        return _FakeResult(self._conflicting_owner_id)


@pytest.mark.asyncio
async def test_manager_with_no_other_active_assignments_is_allowed():
    db = _FakeSession(conflicting_owner_id=None)
    await location_manager_service.assert_manager_belongs_to_same_owner(db, "sub-1", owner_id=10)


@pytest.mark.asyncio
async def test_manager_already_active_for_a_different_owner_is_rejected():
    db = _FakeSession(conflicting_owner_id=99)
    with pytest.raises(AppError) as exc_info:
        await location_manager_service.assert_manager_belongs_to_same_owner(db, "sub-1", owner_id=10)
    assert exc_info.value.status_code == 409
    assert exc_info.value.code == "manager_different_owner"


@pytest.mark.asyncio
async def test_none_owner_id_is_a_defensive_noop():
    """`owner_id=None` should never happen in practice (the router's
    `require_location_owner_only` dependency always populates it first)
    but must not raise or query if it somehow does."""
    db = _FakeSession(conflicting_owner_id=99)
    await location_manager_service.assert_manager_belongs_to_same_owner(db, "sub-1", owner_id=None)
    assert db.executed is False
