"""Unit test: `s3_service.processed_key_for_upload`/`thumbnail_key_for_upload`
and `location_service.create_location_photo`'s predictable-key flow — see
docs/DECISIONS.md "S3 image resize pipeline: predictable key, not
read-after-write" and "Resize Lambda: thumbnail variant".

`create_location_photo` must store the resize Lambda's PREDICTED
`processed/`/`thumbnails/` keys immediately (BRD 5.3's steps 3-5 run
asynchronously off an S3 event and won't have finished yet), never the
raw client-supplied key, and it must reject a `raw/` key that doesn't
belong to the location being written to.
"""
from __future__ import annotations

import pytest

from app.core.errors import AppError
from app.models.restaurant_location import RestaurantLocation
from app.models.restaurant_photo import RestaurantPhoto
from app.schemas.photo import PhotoCreate
from app.services import location_service, s3_service


# ---------------------------------------------------------------------------
# s3_service.processed_key_for_upload / thumbnail_key_for_upload
# ---------------------------------------------------------------------------


def test_processed_key_for_upload_transforms_raw_key():
    assert (
        s3_service.processed_key_for_upload("raw/locations/456/photos/abc.png", 456)
        == "processed/locations/456/photos/abc.jpg"
    )


def test_thumbnail_key_for_upload_transforms_raw_key():
    assert (
        s3_service.thumbnail_key_for_upload("raw/locations/456/photos/abc.png", 456)
        == "thumbnails/locations/456/photos/abc.jpg"
    )


def test_processed_key_for_upload_rejects_a_key_for_a_different_location():
    with pytest.raises(AppError) as exc_info:
        s3_service.processed_key_for_upload("raw/locations/456/photos/abc.png", 999)
    assert exc_info.value.status_code == 400
    assert exc_info.value.code == "invalid_s3_key"


def test_processed_key_for_upload_rejects_an_already_processed_key():
    # A client that (accidentally or otherwise) echoes back a processed/
    # key instead of the raw/ key it was actually issued.
    with pytest.raises(AppError) as exc_info:
        s3_service.processed_key_for_upload("processed/locations/456/photos/abc.jpg", 456)
    assert exc_info.value.code == "invalid_s3_key"


# ---------------------------------------------------------------------------
# location_service.create_location_photo — end-to-end predictable-key flow
# ---------------------------------------------------------------------------


class _FakeSession:
    def __init__(self):
        self.added = []

    def add(self, obj):
        self.added.append(obj)

    async def delete(self, obj):
        pass

    async def flush(self):
        pass

    async def commit(self):
        pass

    async def refresh(self, obj):
        # Real SQLAlchemy assigns the autoincrement PK on refresh-after-
        # flush; this fake session never talks to a real DB, so fake that
        # assignment here — PhotoOut.id is a required int, and
        # to_photo_out() is exercised by the test below.
        if getattr(obj, "id", None) is None:
            obj.id = 1


class _FakeUser:
    cognito_sub = "owner-sub-123"


@pytest.mark.asyncio
async def test_create_location_photo_stores_predicted_processed_and_thumbnail_keys(
    monkeypatch: pytest.MonkeyPatch,
):
    location = RestaurantLocation(
        id=456,
        brand_id=1,
        address_line1="1 Main St",
        city="Plano",
        state="TX",
        postal_code="75024",
        is_paid=False,
    )

    async def _fake_get_location_or_404(db, location_id):
        assert location_id == 456
        return location

    monkeypatch.setattr(location_service, "get_location_or_404", _fake_get_location_or_404)

    async def _fake_count(db, location_id):
        return 0

    from app.services import photo_service

    monkeypatch.setattr(photo_service, "count_gallery_photos", _fake_count)

    db = _FakeSession()
    body = PhotoCreate(s3_key="raw/locations/456/photos/abc.png", is_cover=False)

    photo_out = await location_service.create_location_photo(db, 456, body, _FakeUser())

    assert photo_out.location_id == 456
    # Never the raw key — the resolved URL reflects the PREDICTED
    # processed/thumbnails keys, computed synchronously, not read back
    # from S3 (the resize Lambda hasn't necessarily run yet).
    assert photo_out.url.endswith("/processed/locations/456/photos/abc.jpg")
    assert photo_out.thumbnail_url.endswith("/thumbnails/locations/456/photos/abc.jpg")
    assert len(db.added) == 1
    assert db.added[0].s3_key == "processed/locations/456/photos/abc.jpg"
    assert db.added[0].thumbnail_s3_key == "thumbnails/locations/456/photos/abc.jpg"


@pytest.mark.asyncio
async def test_create_location_photo_rejects_a_foreign_raw_key(monkeypatch: pytest.MonkeyPatch):
    location = RestaurantLocation(
        id=456,
        brand_id=1,
        address_line1="1 Main St",
        city="Plano",
        state="TX",
        postal_code="75024",
        is_paid=False,
    )

    async def _fake_get_location_or_404(db, location_id):
        return location

    monkeypatch.setattr(location_service, "get_location_or_404", _fake_get_location_or_404)

    db = _FakeSession()
    # Raw key belongs to a *different* location (999) — must be rejected
    # before any RestaurantPhoto row is ever created.
    body = PhotoCreate(s3_key="raw/locations/999/photos/abc.png", is_cover=False)

    with pytest.raises(AppError) as exc_info:
        await location_service.create_location_photo(db, 456, body, _FakeUser())
    assert exc_info.value.code == "invalid_s3_key"
    assert db.added == []
