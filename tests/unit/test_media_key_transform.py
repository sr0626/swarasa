"""Unit test: app/media/key_transform.py — the raw/ -> processed/ and
raw/ -> thumbnails/ S3 key transforms shared by the FastAPI app
(app/services/s3_service.py) and the resize Lambda
(app/lambda_handlers/resize_photo.py). See docs/PROJECT_PLAN.csv "S3 image
resize pipeline" and docs/DECISIONS.md "S3 image resize pipeline" /
"Resize Lambda: thumbnail variant".

Pure functions, no mocking needed.
"""
from __future__ import annotations

import pytest

from app.media.key_transform import (
    InvalidRawKeyError,
    raw_key_for_location,
    raw_key_to_processed_key,
    raw_key_to_thumbnail_key,
)


def test_raw_key_to_processed_key_normalizes_extension_to_jpg():
    # BRD 5.3: the resize Lambda always outputs JPEG, even for a PNG input.
    assert (
        raw_key_to_processed_key("raw/locations/456/photos/abc123.png")
        == "processed/locations/456/photos/abc123.jpg"
    )


def test_raw_key_to_processed_key_keeps_jpg_extension():
    assert (
        raw_key_to_processed_key("raw/locations/456/photos/abc123.jpg")
        == "processed/locations/456/photos/abc123.jpg"
    )


def test_raw_key_to_thumbnail_key_uses_sibling_prefix():
    assert (
        raw_key_to_thumbnail_key("raw/locations/456/photos/abc123.png")
        == "thumbnails/locations/456/photos/abc123.jpg"
    )


def test_processed_and_thumbnail_keys_share_the_same_path_tail():
    raw_key = "raw/locations/789/photos/deadbeef.jpeg"
    processed = raw_key_to_processed_key(raw_key)
    thumbnail = raw_key_to_thumbnail_key(raw_key)
    assert processed.removeprefix("processed/") == thumbnail.removeprefix("thumbnails/")


def test_raw_key_to_processed_key_rejects_non_raw_prefix():
    with pytest.raises(InvalidRawKeyError):
        raw_key_to_processed_key("processed/locations/456/photos/abc123.jpg")


def test_raw_key_to_processed_key_rejects_missing_extension():
    with pytest.raises(InvalidRawKeyError):
        raw_key_to_processed_key("raw/locations/456/photos/abc123")


def test_raw_key_for_location_matches_own_convention():
    assert raw_key_for_location("raw/locations/456/photos/abc123.jpg", 456) is True


def test_raw_key_for_location_rejects_a_different_location():
    assert raw_key_for_location("raw/locations/456/photos/abc123.jpg", 999) is False


def test_raw_key_for_location_rejects_non_raw_key():
    assert raw_key_for_location("processed/locations/456/photos/abc123.jpg", 456) is False
