"""Unit test: S3 presigned URL generation — mocked boto3 client (tests/CLAUDE.md
"ALWAYS mock AWS calls ... instead of hitting real S3" / root CLAUDE.md AWS
Best Practices). No real `boto3.client("s3", ...)` call is ever made here —
`app.services.s3_service._get_s3_client` is monkeypatched to return a stub
object, so there is no network call to mock at the HTTP layer at all.

`generate_location_photo_upload_url`'s tests below were updated 2026-09-16
for the S3 image resize pipeline (docs/PROJECT_PLAN.csv "S3 image resize
pipeline"): the function now returns a `raw/` -prefixed key (previously
`locations/...`, no prefix) and uses presigned POST instead of presigned
PUT (previously a 3-tuple with no `fields`) — see that function's own
docstring in app/services/s3_service.py for the full reasoning. Both are
required, documented behavior changes, not incidental — the old assertions
here were testing the exact shape this task was asked to change.
"""
from __future__ import annotations

import pytest

from app.core.errors import AppError
from app.services import s3_service


class _FakeS3Client:
    """Stub replacing the real boto3 S3 client. Records what it was asked
    to sign and returns a deterministic fake presigned URL/POST — never
    talks to AWS.
    """

    def __init__(self):
        self.calls: list[dict] = []

    def generate_presigned_url(self, operation, Params, ExpiresIn):
        self.calls.append(
            {"operation": operation, "params": Params, "expires_in": ExpiresIn}
        )
        return f"https://fake-s3.example.com/{Params['Bucket']}/{Params['Key']}?signed=1"

    def generate_presigned_post(self, Bucket, Key, Fields=None, Conditions=None, ExpiresIn=None):
        self.calls.append(
            {
                "operation": "generate_presigned_post",
                "bucket": Bucket,
                "key": Key,
                "fields": Fields,
                "conditions": Conditions,
                "expires_in": ExpiresIn,
            }
        )
        return {
            "url": f"https://fake-s3.example.com/{Bucket}",
            "fields": {**(Fields or {}), "key": Key},
        }


@pytest.fixture
def fake_s3(monkeypatch: pytest.MonkeyPatch) -> _FakeS3Client:
    client = _FakeS3Client()
    monkeypatch.setattr(s3_service, "_get_s3_client", lambda: client)
    return client


def test_generate_location_photo_upload_url_returns_raw_prefixed_key(fake_s3: _FakeS3Client):
    url, fields, key, expires_in = s3_service.generate_location_photo_upload_url(456, "image/jpeg")

    assert key.startswith("raw/locations/456/photos/")
    assert key.endswith(".jpg")
    assert expires_in == 600
    assert fields["key"] == key
    assert url == "https://fake-s3.example.com/test-media-bucket"  # tests/conftest.py's S3_MEDIA_BUCKET
    # Exactly one object key was presigned — never a bucket-wide grant
    # (root CLAUDE.md AWS Best Practices, least privilege).
    assert len(fake_s3.calls) == 1
    assert fake_s3.calls[0]["key"] == key
    assert fake_s3.calls[0]["operation"] == "generate_presigned_post"


def test_generate_location_photo_upload_url_signs_size_and_type_conditions(
    fake_s3: _FakeS3Client,
):
    s3_service.generate_location_photo_upload_url(456, "image/png")

    call = fake_s3.calls[0]
    assert call["fields"] == {"Content-Type": "image/png"}
    assert {"Content-Type": "image/png"} in call["conditions"]
    assert ["content-length-range", 1, 5 * 1024 * 1024] in call["conditions"]


def test_generate_location_photo_upload_url_rejects_unsupported_content_type(fake_s3: _FakeS3Client):
    with pytest.raises(AppError) as exc_info:
        s3_service.generate_location_photo_upload_url(456, "application/zip")
    assert exc_info.value.status_code == 400
    assert exc_info.value.code == "unsupported_content_type"
    assert fake_s3.calls == []  # never even attempted to presign


def test_generate_location_photo_upload_url_rejects_webp_per_brd(fake_s3: _FakeS3Client):
    # BRD 5.3: "JPEG and PNG only" — webp was accepted by the old, more
    # permissive _CONTENT_TYPE_EXTENSIONS map; the photo-specific one must
    # not include it even though the claim-document path still does.
    with pytest.raises(AppError) as exc_info:
        s3_service.generate_location_photo_upload_url(456, "image/webp")
    assert exc_info.value.code == "unsupported_content_type"


def test_generate_claim_document_upload_url_scopes_key_to_claimant(fake_s3: _FakeS3Client):
    url, key, expires_in = s3_service.generate_claim_document_upload_url(
        "claimant-sub-123", "application/pdf"
    )
    assert key.startswith("claims/claimant-sub-123/documents/")
    assert key.endswith(".pdf")


def test_resolve_media_url_uses_cdn_domain_when_set(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MEDIA_CDN_DOMAIN", "cdn.example.com")
    url = s3_service.resolve_media_url("locations/1/photos/abc.jpg")
    assert url == "https://cdn.example.com/locations/1/photos/abc.jpg"


def test_resolve_media_url_falls_back_to_bucket_when_cdn_unset(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("MEDIA_CDN_DOMAIN", raising=False)
    monkeypatch.setenv("S3_MEDIA_BUCKET", "my-test-bucket")
    url = s3_service.resolve_media_url("locations/1/photos/abc.jpg")
    assert url == "https://my-test-bucket.s3.amazonaws.com/locations/1/photos/abc.jpg"
