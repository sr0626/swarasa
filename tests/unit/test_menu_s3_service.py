"""Unit test: menu-item photo presigning (`s3_service.generate_menu_photo_upload_url`
/ `menu_photo_keys_for_upload`) — mocked boto3 client, never real AWS."""
from __future__ import annotations

import pytest

from app.core.errors import AppError
from app.services import s3_service


class _FakeS3Client:
    def __init__(self):
        self.calls: list[dict] = []

    def generate_presigned_post(self, Bucket, Key, Fields=None, Conditions=None, ExpiresIn=None):
        self.calls.append({"key": Key, "fields": Fields, "conditions": Conditions})
        return {"url": f"https://fake-s3.example.com/{Bucket}", "fields": {**(Fields or {}), "key": Key}}


@pytest.fixture
def fake_s3(monkeypatch: pytest.MonkeyPatch) -> _FakeS3Client:
    client = _FakeS3Client()
    monkeypatch.setattr(s3_service, "_get_s3_client", lambda: client)
    return client


def test_menu_upload_key_is_scoped_to_the_location_menu_prefix(fake_s3):
    url, fields, key, expires_in = s3_service.generate_menu_photo_upload_url(456, "image/jpeg")

    assert key.startswith("raw/locations/456/menu/")
    assert key.endswith(".jpg")
    assert expires_in == 600
    assert fields["key"] == key
    assert len(fake_s3.calls) == 1 and fake_s3.calls[0]["key"] == key


def test_menu_upload_is_capped_at_2mb_and_pins_content_type(fake_s3):
    s3_service.generate_menu_photo_upload_url(456, "image/png")

    conditions = fake_s3.calls[0]["conditions"]
    assert {"Content-Type": "image/png"} in conditions
    assert ["content-length-range", 1, 2 * 1024 * 1024] in conditions


@pytest.mark.parametrize("content_type", ["application/pdf", "image/webp", "image/gif", "text/html"])
def test_menu_upload_allowlist_is_jpeg_png_only(fake_s3, content_type):
    with pytest.raises(AppError) as exc_info:
        s3_service.generate_menu_photo_upload_url(456, content_type)
    assert exc_info.value.status_code == 400
    assert exc_info.value.code == "unsupported_content_type"
    assert fake_s3.calls == []


def test_menu_photo_keys_for_upload_predicts_processed_and_thumbnail(fake_s3):
    _url, _fields, key, _ = s3_service.generate_menu_photo_upload_url(456, "image/png")

    processed, thumbnail = s3_service.menu_photo_keys_for_upload(key, 456)

    assert processed == key.replace("raw/", "processed/", 1).replace(".png", ".jpg")
    assert thumbnail == key.replace("raw/", "thumbnails/", 1).replace(".png", ".jpg")


def test_menu_photo_keys_for_upload_rejects_another_locations_key(fake_s3):
    _url, _fields, key, _ = s3_service.generate_menu_photo_upload_url(456, "image/jpeg")

    with pytest.raises(AppError) as exc_info:
        s3_service.menu_photo_keys_for_upload(key, 999)
    assert exc_info.value.status_code == 400
    assert exc_info.value.code == "invalid_s3_key"
