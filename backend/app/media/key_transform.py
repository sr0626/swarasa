"""Pure, dependency-free S3 key transforms for the location-photo resize
pipeline (BRD 5.3 "S3 Image Upload Pipeline").

Shared by two very different runtimes:
- `app/services/s3_service.py` (the FastAPI app) — to PREDICT a
  `processed/`/`thumbnails/` key at record-time, before the resize Lambda
  has actually run (see docs/DECISIONS.md "S3 image resize pipeline" for
  why the API stores a predicted key rather than waiting).
- `app/lambda_handlers/resize_photo.py` (the resize Lambda, its own
  container image with only boto3 + Pillow installed) — to compute the
  SAME keys when it actually writes the resized files.

Both call sites must derive identical keys from the same raw key, so this
logic lives in exactly one place. It has ZERO external dependencies (no
boto3, no fastapi, no sqlalchemy, not even this repo's own AppError) so it
stays importable from the resize Lambda's minimal image without pulling in
anything else — keep it that way.
"""
from __future__ import annotations

RAW_PREFIX = "raw/"
PROCESSED_PREFIX = "processed/"
THUMBNAIL_PREFIX = "thumbnails/"

# BRD 5.3: the resize Lambda always outputs JPEG regardless of the
# original's format (JPEG or PNG in — JPEG out, quality 85, max 1200px).
PROCESSED_EXTENSION = ".jpg"

# Thumbnail is a second, smaller JPEG variant (added 2026-09-16, user
# request beyond the BRD's documented spec — see docs/DECISIONS.md
# "Resize Lambda: thumbnail variant"). Same extension convention as the
# main processed image.
THUMBNAIL_EXTENSION = ".jpg"


class InvalidRawKeyError(ValueError):
    """Raised when a string doesn't look like a `raw/` key this pipeline
    produced (missing the `raw/` prefix, or missing an extension).
    """


def _raw_tail(raw_key: str) -> str:
    if not raw_key.startswith(RAW_PREFIX):
        raise InvalidRawKeyError(f"Not a raw/ key: {raw_key!r}")
    tail = raw_key[len(RAW_PREFIX) :]
    base, _, ext = tail.rpartition(".")
    if not base or not ext:
        raise InvalidRawKeyError(f"raw/ key has no extension: {raw_key!r}")
    return base


def raw_key_to_processed_key(raw_key: str) -> str:
    """`raw/locations/456/photos/abc123.png` -> `processed/locations/456/photos/abc123.jpg`."""
    return f"{PROCESSED_PREFIX}{_raw_tail(raw_key)}{PROCESSED_EXTENSION}"


def raw_key_to_thumbnail_key(raw_key: str) -> str:
    """`raw/locations/456/photos/abc123.png` -> `thumbnails/locations/456/photos/abc123.jpg`.

    Mirrors `raw_key_to_processed_key`'s path structure under a third,
    sibling prefix — `thumbnails/` — rather than nesting under
    `processed/`, so the S3 event notification's `filter_prefix = "raw/"`
    and the resize Lambda's IAM scoping stay simple two-prefix-out,
    one-prefix-in rules (see docs/DECISIONS.md).
    """
    return f"{THUMBNAIL_PREFIX}{_raw_tail(raw_key)}{THUMBNAIL_EXTENSION}"


def raw_key_for_location(raw_key: str, location_id: int) -> bool:
    """True if `raw_key` matches this pipeline's own naming convention for
    the given location (`raw/locations/{id}/photos/...`). Used by
    `s3_service` to reject a client-supplied key for a different
    location/resource before trusting it.
    """
    return raw_key.startswith(f"{RAW_PREFIX}locations/{location_id}/photos/")
