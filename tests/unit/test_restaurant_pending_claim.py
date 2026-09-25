"""`restaurant_service._brand_to_out` exposes `has_pending_claim` (boolean only)
so the site can hide the claim CTA while a claim is in review."""
from __future__ import annotations

import pytest

from app.models.restaurant_brand import RestaurantBrand
from app.services import restaurant_service


class _Scalar:
    def __init__(self, value):
        self._value = value

    def scalar_one(self):
        return self._value

    def scalar_one_or_none(self):
        return self._value


class _FakeSession:
    """Answers the two queries `_brand_to_out` runs, in order: location count,
    then the pending-claim lookup."""

    def __init__(self, pending_claim_id):
        self._results = [_Scalar(1), _Scalar(pending_claim_id)]

    async def execute(self, _stmt):
        return self._results.pop(0)


async def _no_tags(db, brand_id, **kwargs):
    return []


@pytest.mark.asyncio
@pytest.mark.parametrize("pending_id,expected", [(None, False), (42, True)])
async def test_has_pending_claim_reflects_pending_row(monkeypatch, pending_id, expected):
    monkeypatch.setattr(restaurant_service.cuisine_service, "get_brand_union_tags", _no_tags)
    brand = RestaurantBrand(id=1, name="Dera Grill", slug="dera-grill", is_claimed=False, owner_id=None)

    out = await restaurant_service._brand_to_out(_FakeSession(pending_id), brand)

    assert out.has_pending_claim is expected
    assert out.is_claimed is False
