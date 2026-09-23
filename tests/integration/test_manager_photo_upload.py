"""Regression test for the manager cover/gallery photo upload bug report:
a manager signed in, editing a location they're assigned to, got "Uploading
the image failed. Please try again." on both cover and gallery photo
uploads.

Investigation (see this PR's description for the full trace) found the
actual break was on the frontend: `POST /locations/{id}/photos/upload-url`
returns a presigned S3 **POST** (`upload_url` + `fields`, added when the S3
resize pipeline was completed — docs/API_CONTRACTS.md "POST
/locations/{id}/photos/upload-url"), but
`frontend/src/components/portal/LocationPhotoManager.tsx` was still doing a
plain `PUT` of the raw file body — a stale assumption from before that
contract change, and one that broke identically for every role (owner,
manager, admin), not managers specifically. See
`frontend/src/lib/photoUpload.test.ts` for the regression test that
actually exercises that break.

This file closes an adjacent, genuinely-missing gap noticed while tracing
the bug: the backend side of this same flow — `require_location_write_access`
including an ASSIGNED manager (not just "any manager"), verified with a real
`location_manager` row, not just the JWT role claim — had no dedicated
manager-role test for the photo routes at all. `test_admin_location_parity.py`
covers admin; nothing covered manager. This proves the backend half of the
manager upload path already works correctly (so it's not a contributor to
the reported bug) and guards against a future regression in the manager
branch of `require_location_write_access`.

Run against the real HTTP router + a real (SQLite) DB, same pattern as
test_admin_location_parity.py / test_managed_locations.py. S3 calls (the
upload-url route) are monkeypatched per tests/unit/test_s3_service.py's own
`_FakeS3Client` pattern — never a real AWS call in a test.
"""
from __future__ import annotations

import uuid

import pytest

from app.services import s3_service
from factories import create_brand, create_location, create_location_manager, create_owner


class _FakeS3Client:
    def generate_presigned_url(self, operation, Params, ExpiresIn):
        return f"https://fake-s3.example.com/{Params['Bucket']}/{Params['Key']}?signed=1"

    def generate_presigned_post(self, Bucket, Key, Fields=None, Conditions=None, ExpiresIn=None):
        return {"url": f"https://fake-s3.example.com/{Bucket}", "fields": {**(Fields or {}), "key": Key}}


@pytest.fixture(autouse=True)
def fake_s3(monkeypatch: pytest.MonkeyPatch, aws_env):
    monkeypatch.setattr(s3_service, "_get_s3_client", lambda: _FakeS3Client())


@pytest.fixture(autouse=True)
def aws_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("S3_MEDIA_BUCKET", "test-media-bucket")


async def _location_with_assigned_manager(db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location.id, user_id=manager_sub, is_active=True)
    await db_session.commit()
    return location, manager_sub


@pytest.mark.asyncio
async def test_assigned_manager_can_request_a_photo_upload_url(client, db_session, as_user):
    location, manager_sub = await _location_with_assigned_manager(db_session)
    as_user("manager", sub=manager_sub)

    response = await client.post(
        f"/locations/{location.id}/photos/upload-url", json={"content_type": "image/jpeg"}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["s3_key"].startswith(f"raw/locations/{location.id}/photos/")
    # The presigned-POST fields a real upload needs — this is the contract
    # the frontend fix (lib/photoUpload.ts) must submit as a multipart form.
    assert "fields" in body and isinstance(body["fields"], dict)
    assert body["fields"]["key"] == body["s3_key"]


@pytest.mark.asyncio
async def test_assigned_manager_can_confirm_a_cover_and_a_gallery_photo(client, db_session, as_user):
    """End to end (minus the actual S3 PUT/POST, which is mocked at the
    boto3 layer): upload-url -> photos POST, for both a cover photo and a
    gallery photo, exactly the two upload surfaces the bug report named.
    """
    location, manager_sub = await _location_with_assigned_manager(db_session)
    as_user("manager", sub=manager_sub)

    cover_key = f"raw/locations/{location.id}/photos/{uuid.uuid4().hex}.jpg"
    cover_response = await client.post(
        f"/locations/{location.id}/photos", json={"s3_key": cover_key, "is_cover": True}
    )
    assert cover_response.status_code == 201, cover_response.text
    assert cover_response.json()["is_cover"] is True

    gallery_key = f"raw/locations/{location.id}/photos/{uuid.uuid4().hex}.jpg"
    gallery_response = await client.post(
        f"/locations/{location.id}/photos", json={"s3_key": gallery_key, "is_cover": False}
    )
    assert gallery_response.status_code == 201, gallery_response.text
    assert gallery_response.json()["is_cover"] is False


@pytest.mark.asyncio
async def test_manager_not_assigned_to_the_location_is_rejected(client, db_session, as_user):
    """Not just "any manager" — the permission check must key off a real
    `location_manager` row for THIS location (root/backend CLAUDE.md "NEVER
    trust JWT claims for manager location access"), same posture as
    test_manager_permissions.py's other boundary tests.
    """
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    as_user("manager", sub=str(uuid.uuid4()))  # a manager, but assigned to nothing here

    upload_url_response = await client.post(
        f"/locations/{location.id}/photos/upload-url", json={"content_type": "image/jpeg"}
    )
    assert upload_url_response.status_code == 403

    photo_response = await client.post(
        f"/locations/{location.id}/photos",
        json={"s3_key": f"raw/locations/{location.id}/photos/{uuid.uuid4().hex}.jpg", "is_cover": False},
    )
    assert photo_response.status_code == 403


@pytest.mark.asyncio
async def test_manager_with_a_soft_removed_assignment_is_rejected(client, db_session, as_user):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location.id, user_id=manager_sub, is_active=False)
    await db_session.commit()

    as_user("manager", sub=manager_sub)
    response = await client.post(
        f"/locations/{location.id}/photos/upload-url", json={"content_type": "image/jpeg"}
    )
    assert response.status_code == 403
