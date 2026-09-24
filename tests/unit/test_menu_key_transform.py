"""Unit tests: the menu-photo key convention in `app/media/key_transform.py`
— `raw/locations/{id}/menu/{32-hex}.jpg|png` reuses the existing raw/ ->
processed/ + thumbnails/ resize pipeline, and `raw_key_for_location_menu`
accepts ONLY the exact shape the upload-url endpoint issues."""
from __future__ import annotations

import pytest

from app.media.key_transform import (
    raw_key_for_location_menu,
    raw_key_to_processed_key,
    raw_key_to_thumbnail_key,
)

_HEX = "0123456789abcdef" * 2


def test_menu_key_transforms_reuse_the_raw_pipeline_prefixes():
    raw_key = f"raw/locations/456/menu/{_HEX}.png"
    assert raw_key_to_processed_key(raw_key) == f"processed/locations/456/menu/{_HEX}.jpg"
    assert raw_key_to_thumbnail_key(raw_key) == f"thumbnails/locations/456/menu/{_HEX}.jpg"


def test_raw_key_for_location_menu_accepts_only_the_exact_issued_shape():
    assert raw_key_for_location_menu(f"raw/locations/456/menu/{_HEX}.jpg", 456) is True
    assert raw_key_for_location_menu(f"raw/locations/456/menu/{_HEX}.png", 456) is True


@pytest.mark.parametrize(
    "key",
    [
        f"raw/locations/999/menu/{_HEX}.jpg",  # another location
        f"raw/locations/456/photos/{_HEX}.jpg",  # gallery prefix
        f"raw/locations/456/menu/../photos/{_HEX}.jpg",
        f"raw/locations/456/menu/sub/{_HEX}.jpg",
        "raw/locations/456/menu/notahex.jpg",
        f"raw/locations/456/menu/{_HEX}.gif",
        f"raw/locations/456/menu/{_HEX}.jpg/extra",
        f"processed/locations/456/menu/{_HEX}.jpg",
        f"raw/locations/4560/menu/{_HEX}.jpg",  # id prefix collision (4560 vs 456)
    ],
)
def test_raw_key_for_location_menu_rejects_anything_else(key):
    assert raw_key_for_location_menu(key, 456) is False
