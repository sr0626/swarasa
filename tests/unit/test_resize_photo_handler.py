"""Unit test: app/lambda_handlers/resize_photo.py — the S3-triggered
resize Lambda (BRD 5.3 steps 3-5 + the thumbnail variant, see
docs/DECISIONS.md "Resize Lambda: thumbnail variant").

Does NOT exercise real Pillow: `_resize_variant` is monkeypatched to a
deterministic fake, so this suite never needs Pillow installed (the
handler module itself imports PIL lazily, inside `_resize_variant`/
`_decode_image`, specifically so it stays importable without Pillow — see
that module's docstring). Only the S3-orchestration logic (which keys get
read/written/deleted, in what order, and the defensive skip/error paths)
is under test here — image-processing correctness is Pillow's own
responsibility, not this repo's.
"""
from __future__ import annotations

import pytest

from app.lambda_handlers import resize_photo


class _FakeBody:
    def __init__(self, data: bytes):
        self._data = data

    def read(self) -> bytes:
        return self._data


class _FakeS3Client:
    def __init__(self, objects: dict[str, bytes]):
        self.objects = dict(objects)
        self.put_calls: list[dict] = []
        self.deleted: list[str] = []

    def get_object(self, Bucket, Key):
        return {"Body": _FakeBody(self.objects[Key])}

    def put_object(self, Bucket, Key, Body, ContentType):
        self.put_calls.append({"bucket": Bucket, "key": Key, "body": Body, "content_type": ContentType})
        self.objects[Key] = Body

    def delete_object(self, Bucket, Key):
        self.deleted.append(Key)
        self.objects.pop(Key, None)


def _s3_event(bucket: str, key: str) -> dict:
    return {"Records": [{"s3": {"bucket": {"name": bucket}, "object": {"key": key}}}]}


@pytest.fixture
def fake_variant(monkeypatch: pytest.MonkeyPatch):
    """Replaces real Pillow-based resizing with a deterministic stub —
    returns a distinct marker per (max_dimension, quality) pair so the
    test can tell the processed and thumbnail writes apart without
    decoding real image bytes.
    """
    calls: list[tuple[int, int]] = []

    def _fake_resize_variant(img, max_dimension, quality):
        calls.append((max_dimension, quality))
        return f"jpeg-bytes-{max_dimension}-{quality}".encode()

    monkeypatch.setattr(resize_photo, "_resize_variant", _fake_resize_variant)
    monkeypatch.setattr(resize_photo, "_decode_image", lambda raw_bytes: object())
    return calls


def test_handler_processes_a_single_record(monkeypatch: pytest.MonkeyPatch, fake_variant):
    s3 = _FakeS3Client({"raw/locations/456/photos/abc.png": b"fake-png-bytes"})
    monkeypatch.setattr(resize_photo, "_get_s3_client", lambda: s3)

    out = resize_photo.handler(_s3_event("swarasa-media-dev", "raw/locations/456/photos/abc.png"), None)

    assert out == {"processed": 1}
    # Both variants written, to the predicted processed/ and thumbnails/
    # keys, before the raw/ original is deleted.
    written_keys = {call["key"] for call in s3.put_calls}
    assert written_keys == {
        "processed/locations/456/photos/abc.jpg",
        "thumbnails/locations/456/photos/abc.jpg",
    }
    assert all(call["content_type"] == "image/jpeg" for call in s3.put_calls)
    assert s3.deleted == ["raw/locations/456/photos/abc.png"]
    # Each variant used its own (max_dimension, quality) pair.
    assert (resize_photo.PROCESSED_MAX_DIMENSION, resize_photo.PROCESSED_JPEG_QUALITY) in fake_variant
    assert (resize_photo.THUMBNAIL_MAX_DIMENSION, resize_photo.THUMBNAIL_JPEG_QUALITY) in fake_variant


def test_handler_decodes_url_encoded_keys(monkeypatch: pytest.MonkeyPatch, fake_variant):
    raw_key = "raw/locations/456/photos/my photo.png"
    s3 = _FakeS3Client({raw_key: b"fake-png-bytes"})
    monkeypatch.setattr(resize_photo, "_get_s3_client", lambda: s3)

    resize_photo.handler(_s3_event("swarasa-media-dev", "raw/locations/456/photos/my+photo.png"), None)

    assert s3.deleted == [raw_key]


def test_handler_skips_a_key_outside_the_raw_convention(monkeypatch: pytest.MonkeyPatch, fake_variant):
    # Defensive-only path — the S3 notification filter (filter_prefix =
    # "raw/") should make this unreachable for real traffic.
    s3 = _FakeS3Client({})
    monkeypatch.setattr(resize_photo, "_get_s3_client", lambda: s3)

    out = resize_photo.handler(_s3_event("swarasa-media-dev", "processed/locations/456/photos/abc.jpg"), None)

    assert out == {"processed": 1}
    assert s3.put_calls == []
    assert s3.deleted == []


def test_handler_reraises_on_failure_after_logging(monkeypatch: pytest.MonkeyPatch, fake_variant):
    class _BoomS3(_FakeS3Client):
        def get_object(self, Bucket, Key):
            raise RuntimeError("S3 is down")

    s3 = _BoomS3({})
    monkeypatch.setattr(resize_photo, "_get_s3_client", lambda: s3)

    with pytest.raises(RuntimeError, match="S3 is down"):
        resize_photo.handler(_s3_event("swarasa-media-dev", "raw/locations/456/photos/abc.png"), None)
