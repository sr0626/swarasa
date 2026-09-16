"""S3-triggered resize Lambda — BRD 5.3 "S3 Image Upload Pipeline", steps
3-5, plus a thumbnail variant added 2026-09-16 (user request beyond the
BRD's documented spec — see docs/DECISIONS.md "Resize Lambda: thumbnail
variant").

Trigger: an S3 `ObjectCreated` event notification on the media bucket,
filtered to the `raw/` prefix (infra/modules/lambda_resize +
`aws_s3_bucket_notification.media_raw_upload` in infra/main.tf). Per
upload this Lambda:
  1. Downloads the raw object from `raw/...`
  2. Writes a 1200px-max-dimension, quality-85 JPEG to `processed/...`
  3. Writes a 400px-max-dimension, quality-80 JPEG thumbnail to
     `thumbnails/...`
  4. Deletes the original from `raw/...`

Never re-triggers itself: the S3 notification filter is scoped to
`raw/` only, and this Lambda only ever writes to `processed/`/
`thumbnails/`, which that filter excludes by construction.

Packaging (see docs/DECISIONS.md "Resize Lambda packaging"): its own
container image (backend/Dockerfile.resize), built from the same
`public.ecr.aws/lambda/python:3.12` base as the API Lambda but with only
its own minimal `requirements-resize.txt` (boto3 + Pillow) and only the
two files it needs (`app/media/key_transform.py` — pure stdlib, importable
without Pillow — plus this file). NEVER import anything from
`app.services` / `app.routers` / `app.models` / `app.core` here — those
pull in fastapi/sqlalchemy/mangum, which this image deliberately does not
install.

`Image` is imported from Pillow lazily, inside `_resize_variant`, not at
module scope — so this module (and `handler`) stays importable in an
environment without Pillow installed (e.g. this repo's own pytest/test
environment, which intentionally does not depend on Pillow — see
tests/unit/test_resize_photo_handler.py, which monkeypatches
`_resize_variant` rather than exercising real Pillow code). The real
Lambda container always has Pillow installed via requirements-resize.txt,
so this is a test-only concern, not a runtime one.
"""
from __future__ import annotations

import io
import logging
import urllib.parse

import boto3

from app.media.key_transform import (
    InvalidRawKeyError,
    raw_key_to_processed_key,
    raw_key_to_thumbnail_key,
)

logger = logging.getLogger("app.lambda_handlers.resize_photo")

# BRD 5.3: "creates a 1200px JPEG (quality 85)".
PROCESSED_MAX_DIMENSION = 1200
PROCESSED_JPEG_QUALITY = 85

# Thumbnail variant (added 2026-09-16, user request — see module docstring
# and docs/DECISIONS.md). 400px on the long edge: large enough to stay
# crisp on a 2x-density card/list thumbnail at ~200 CSS px (a common
# listing-card image width) or an email/notification inline image, small
# enough to meaningfully cut bytes vs. the 1200px processed image for
# those bandwidth-sensitive contexts — comfortably inside the
# "300-400px" range called out for this decision. Quality dialed down a
# notch from the main image (80 vs 85): at this size, fine detail loss is
# far less visible, and the extra few percent of size reduction matters
# more here since thumbnails are the variant meant for cheap, frequent
# loading (email, card grids).
THUMBNAIL_MAX_DIMENSION = 400
THUMBNAIL_JPEG_QUALITY = 80

_s3_client = None


def _get_s3_client():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3")
    return _s3_client


def _resize_variant(img, max_dimension: int, quality: int) -> bytes:
    """Resize a copy of `img` to fit within `max_dimension` (preserving
    aspect ratio) and encode it as a JPEG at `quality`. `img` is never
    mutated — callers derive multiple variants (processed + thumbnail)
    from the same decoded source image, and `Image.thumbnail()` mutates
    in place, so each variant works on its own `img.copy()`.
    """
    from PIL import Image  # lazy import — see module docstring

    variant = img.copy()
    variant.thumbnail((max_dimension, max_dimension), Image.LANCZOS)
    out = io.BytesIO()
    variant.save(out, format="JPEG", quality=quality)
    return out.getvalue()


def _decode_image(raw_bytes: bytes):
    from PIL import Image  # lazy import — see module docstring

    img = Image.open(io.BytesIO(raw_bytes))
    img.load()
    # JPEG has no alpha channel; PNG/others might (transparency). Convert
    # once up front so both variants encode cleanly to JPEG without a
    # per-variant conversion.
    return img.convert("RGB")


def _process_record(s3, bucket: str, raw_key: str) -> None:
    try:
        processed_key = raw_key_to_processed_key(raw_key)
        thumbnail_key = raw_key_to_thumbnail_key(raw_key)
    except InvalidRawKeyError:
        # Defensive only — the S3 notification filter (filter_prefix =
        # "raw/") should make this unreachable in practice; log and skip
        # rather than crash the whole batch over one malformed key.
        logger.warning("Skipping non-pipeline raw/ key: %s", raw_key)
        return

    obj = s3.get_object(Bucket=bucket, Key=raw_key)
    raw_bytes = obj["Body"].read()

    img = _decode_image(raw_bytes)
    processed_bytes = _resize_variant(img, PROCESSED_MAX_DIMENSION, PROCESSED_JPEG_QUALITY)
    thumbnail_bytes = _resize_variant(img, THUMBNAIL_MAX_DIMENSION, THUMBNAIL_JPEG_QUALITY)

    s3.put_object(Bucket=bucket, Key=processed_key, Body=processed_bytes, ContentType="image/jpeg")
    s3.put_object(Bucket=bucket, Key=thumbnail_key, Body=thumbnail_bytes, ContentType="image/jpeg")

    # Step 5 (BRD): delete the original from raw/ only once both writes
    # above have succeeded.
    s3.delete_object(Bucket=bucket, Key=raw_key)

    logger.info(
        "Resized %s -> %s (%d bytes) + %s (%d bytes)",
        raw_key,
        processed_key,
        len(processed_bytes),
        thumbnail_key,
        len(thumbnail_bytes),
    )


def handler(event, context):
    """S3 `ObjectCreated` event entry point.

    Logs and RE-RAISES on a processing failure (never swallows it) so
    Lambda's built-in retry behavior applies — an oversized/corrupt image
    should not silently disappear from `raw/` without ever landing in
    `processed/`/`thumbnails/`.
    """
    s3 = _get_s3_client()
    records = event.get("Records", [])
    for record in records:
        bucket = record["s3"]["bucket"]["name"]
        # S3 event key values are URL-encoded (e.g. spaces as '+') — decode
        # before use, same as AWS's own sample resize-Lambda code.
        raw_key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])
        try:
            _process_record(s3, bucket, raw_key)
        except Exception:
            logger.exception("Failed to process %s/%s", bucket, raw_key)
            raise
    return {"processed": len(records)}
