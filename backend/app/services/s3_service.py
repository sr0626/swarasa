"""S3 presigned URL generation — root CLAUDE.md media pattern (S3 +
CloudFront, presigned URLs for upload, never through Lambda) and
backend/CLAUDE.md "S3 presigned URL generation" pattern, implemented
verbatim (still true for `generate_claim_document_upload_url` below).
Every presigned URL is scoped to exactly one object key (never a
bucket-wide grant) — root CLAUDE.md "AWS Best Practices" least-privilege
guardrail, applied at the call-site level; the IAM policy backing this
Lambda's execution role is Infra's to scope, not this module's.

`generate_location_photo_upload_url` is the one exception to the plain
presigned-PUT pattern above — see its own docstring for why (BRD 5.3's
5MB cap needs presigned POST, not PUT).

`MEDIA_CDN_DOMAIN` (CloudFront distribution domain) is a new env var, not
yet listed in backend/CLAUDE.md's table — added here because photo/claim
responses need to resolve a stored `s3_key` to a servable URL. Flagged for
review; ask Infra to confirm the real CloudFront domain name once
provisioned.
"""
from __future__ import annotations

import os
import uuid

import boto3
from botocore.config import Config

from app.core.errors import AppError
from app.media.key_transform import (
    InvalidRawKeyError,
    raw_key_for_location,
    raw_key_to_processed_key,
    raw_key_to_thumbnail_key,
)

_CONTENT_TYPE_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
}

# BRD 5.3: "JPEG and PNG only" for the location-photo pipeline specifically
# — narrower than _CONTENT_TYPE_EXTENSIONS above, which also serves the
# unrelated claim-document upload path (PDFs, etc.).
_PHOTO_CONTENT_TYPE_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
}

# BRD 5.3: "5MB max ... before the upload completes".
_PHOTO_MAX_UPLOAD_BYTES = 5 * 1024 * 1024

_UPLOAD_EXPIRES_IN = 600  # 10 minutes — backend/CLAUDE.md pattern.

_s3_client = None


def _get_s3_client():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3", config=Config(signature_version="s3v4"))
    return _s3_client


def _get_bucket() -> str:
    bucket = os.environ.get("S3_MEDIA_BUCKET")
    if not bucket:
        raise RuntimeError("S3_MEDIA_BUCKET is not set — see root CLAUDE.md 'Environment Variables'.")
    return bucket


def _extension_for(content_type: str) -> str:
    return _CONTENT_TYPE_EXTENSIONS.get(content_type.lower(), "")


def generate_upload_url(key: str, content_type: str) -> tuple[str, int]:
    url = _get_s3_client().generate_presigned_url(
        "put_object",
        Params={"Bucket": _get_bucket(), "Key": key, "ContentType": content_type},
        ExpiresIn=_UPLOAD_EXPIRES_IN,
    )
    return url, _UPLOAD_EXPIRES_IN


def generate_location_photo_upload_url(
    location_id: int, content_type: str
) -> tuple[str, dict[str, str], str, int]:
    """POST /locations/{id}/photos/upload-url — BRD 5.3 step 1.

    Key convention: `raw/locations/{id}/photos/{uuid}.<ext>` — the `raw/`
    prefix is what the resize Lambda's S3 event notification is scoped to
    (infra/modules/lambda_resize + infra/main.tf's
    `aws_s3_bucket_notification`, `filter_prefix = "raw/"`) and what
    `raw_key_to_processed_key`/`raw_key_to_thumbnail_key` below assume.

    Presigned POST, NOT presigned PUT (a deliberate deviation from the
    plain-PUT pattern `generate_upload_url`/`generate_claim_document_upload_url`
    use — see docs/DECISIONS.md "S3 image resize pipeline: presigned POST
    for photo uploads" for the full writeup). Reasoning, briefly: BRD 5.3
    requires the 5MB cap to be "enforced by S3 ... before the upload
    completes." Verified (AWS's own bucket-policy-condition-key examples
    have no PutObject size-limiting example; corroborated by multiple
    independent sources) that S3's `content-length-range` condition is a
    presigned-POST-policy construct ONLY — it does not apply to a bucket
    policy Condition on `s3:PutObject`, and a presigned PUT cannot pin an
    exact/max Content-Length via a signed parameter either (Content-Length
    isn't part of what a SigV4 *query-string* presigned URL can sign).
    Presigned POST's `Conditions` (content-type exact match + a genuine
    `content-length-range`) is the only mechanism S3 itself enforces
    before accepting the object — so that's what this endpoint uses.

    This is a contract change from what `POST /locations/{id}/photos/upload-url`
    returned before this pipeline was completed (`upload_url` + `s3_key` +
    `expires_in`, a plain PUT target) — flagged explicitly here and in
    docs/API_CONTRACTS.md/the PR description per root CLAUDE.md's "never
    change an API contract silently" rule. No known consumer exists yet
    (Frontend's photo-upload UI for this endpoint hasn't been built — see
    docs/PROJECT_PLAN.csv, this pipeline was "Not Started" end to end), so
    the blast radius is this backend + its own docs, not a live client.
    """
    ext = _PHOTO_CONTENT_TYPE_EXTENSIONS.get(content_type.lower())
    if ext is None:
        raise AppError(400, "Photo uploads must be JPEG or PNG", "unsupported_content_type")

    key = f"raw/locations/{location_id}/photos/{uuid.uuid4().hex}{ext}"
    presigned = _get_s3_client().generate_presigned_post(
        Bucket=_get_bucket(),
        Key=key,
        Fields={"Content-Type": content_type},
        Conditions=[
            {"Content-Type": content_type},
            ["content-length-range", 1, _PHOTO_MAX_UPLOAD_BYTES],
        ],
        ExpiresIn=_UPLOAD_EXPIRES_IN,
    )
    return presigned["url"], presigned["fields"], key, _UPLOAD_EXPIRES_IN


def processed_key_for_upload(raw_key: str, location_id: int) -> str:
    """Predict the resize Lambda's eventual `processed/` output key for a
    `raw/` key the client just uploaded to, WITHOUT waiting for the resize
    Lambda to actually run — see docs/DECISIONS.md "S3 image resize
    pipeline: predictable key, not read-after-write" for why
    `POST /locations/{id}/photos` stores this predicted key immediately
    rather than polling/waiting for eventual consistency.

    Also re-validates that `raw_key` actually belongs to this location's
    upload-url convention (`raw/locations/{id}/photos/...`) — defense
    against a client passing a crafted/foreign key, cheap to check since
    it's just string comparison against the same convention
    `generate_location_photo_upload_url` used to create it.
    """
    if not raw_key_for_location(raw_key, location_id):
        raise AppError(400, "s3_key does not belong to this location's upload", "invalid_s3_key")
    try:
        return raw_key_to_processed_key(raw_key)
    except InvalidRawKeyError as exc:
        raise AppError(400, str(exc), "invalid_s3_key") from exc


def thumbnail_key_for_upload(raw_key: str, location_id: int) -> str:
    """Same predicted-key reasoning as `processed_key_for_upload`, for the
    thumbnail variant (added 2026-09-16 — see docs/DECISIONS.md "Resize
    Lambda: thumbnail variant"). Re-validates location ownership the same
    way; safe/cheap to call after `processed_key_for_upload` has already
    validated the same `raw_key` (redundant check, not a real cost).
    """
    if not raw_key_for_location(raw_key, location_id):
        raise AppError(400, "s3_key does not belong to this location's upload", "invalid_s3_key")
    try:
        return raw_key_to_thumbnail_key(raw_key)
    except InvalidRawKeyError as exc:
        raise AppError(400, str(exc), "invalid_s3_key") from exc


def generate_claim_document_upload_url(claimant_user_id: str, content_type: str) -> tuple[str, str, int]:
    """Supporting-document upload for the `document_upload` claim proof
    path (docs/API_CONTRACTS.md "Claim flow"). Not itself a documented
    Phase 1 endpoint (the contract expects the client to already hold an
    `s3_key`) — kept here so the presign logic has one home if/when a
    dedicated upload-url route is added; unused by any router today.
    """
    ext = _extension_for(content_type) or ".pdf"
    key = f"claims/{claimant_user_id}/documents/{uuid.uuid4().hex}{ext}"
    url, expires_in = generate_upload_url(key, content_type)
    return url, key, expires_in


def resolve_media_url(s3_key: str) -> str:
    """Resolve a stored S3 object key to a CloudFront-served URL. Never a
    stored full URL (docs/API_CONTRACTS.md note at the top of the Photos
    section) — resolved at read time so a CDN domain change never touches
    stored data.
    """
    domain = os.environ.get("MEDIA_CDN_DOMAIN")
    if not domain:
        # Local/dev fallback so responses are still usable before a
        # CloudFront distribution exists — never used once MEDIA_CDN_DOMAIN
        # is set in a real environment.
        domain = f"{_get_bucket()}.s3.amazonaws.com"
    return f"https://{domain}/{s3_key}"
