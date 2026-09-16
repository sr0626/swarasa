"""Photo sub-resource of /locations — see docs/API_CONTRACTS.md "Photos
(restaurant_photo, sub-resource of /locations/{id})".
"""
from __future__ import annotations

from pydantic import BaseModel


class UploadUrlRequest(BaseModel):
    content_type: str


class UploadUrlResponse(BaseModel):
    upload_url: str
    # Presigned POST fields (added 2026-09-16 — see
    # app/services/s3_service.py's generate_location_photo_upload_url
    # docstring and docs/DECISIONS.md "S3 image resize pipeline: presigned
    # POST for photo uploads"). The client POSTs `upload_url` as a
    # multipart form: every entry in `fields` as a form field (unchanged,
    # pass-through), plus the file itself under the field name "file" —
    # S3's own presigned-POST convention. This replaced a plain-PUT
    # `upload_url` (no `fields`) — a documented, flagged contract change,
    # not a silent one.
    fields: dict[str, str]
    s3_key: str
    expires_in: int


class PhotoCreate(BaseModel):
    # The RAW s3_key returned by the upload-url call above
    # (`raw/locations/{id}/photos/{uuid}.<ext>`) — the client echoes back
    # exactly what it uploaded to. The service layer (not this schema)
    # transforms this into the predicted `processed/`/`thumbnails/` keys
    # before storing — see app/services/location_service.py
    # create_location_photo and docs/DECISIONS.md "S3 image resize
    # pipeline: predictable key, not read-after-write".
    s3_key: str
    is_cover: bool = False


class PhotoUpdate(BaseModel):
    display_order: int | None = None
    is_cover: bool | None = None


class PhotoOut(BaseModel):
    id: int
    location_id: int
    url: str
    # Added 2026-09-16 alongside the resize Lambda's thumbnail variant
    # (user request beyond the BRD's documented spec — see
    # docs/DECISIONS.md "Resize Lambda: thumbnail variant"). Additive:
    # `url` (the 1200px processed image) is unchanged.
    thumbnail_url: str
    is_cover: bool
    display_order: int
