"""Integration test: platform admin full-access parity on `/locations`
write routes — docs/PROJECT_PLAN.csv "Platform admin full-access parity."

Root CLAUDE.md's Permission model already states "Admin: full platform
access," and `backend/app/routers/restaurants.py` already grants it via
`require_owner_or_admin`. `backend/app/routers/locations.py`'s
`PATCH /locations/{id}`, `PUT /locations/{id}/hours`, and the four
`/locations/{id}/photos*` routes previously excluded admin entirely
(`require_location_write_access` had no admin branch) — this file proves
the fix (an admin short-circuit added directly to that dependency in
`backend/app/dependencies/auth.py`) without loosening anything else:
admin can now act on a location it does NOT own, on every route above,
and every write still attributes correctly to the admin actor in
`audit_log` (never mislabeled as the owner). It also locks in the two
endpoints deliberately left owner-only (`POST /locations`,
`POST /locations/{id}/managers`) — see docs/DECISIONS.md "Platform admin
full-access parity..." for the reasoning.

Run against the real HTTP router + a real (SQLite) DB, same pattern as
test_manager_permissions.py / test_owner_portal.py. S3 calls (the
upload-url route) are monkeypatched per tests/unit/test_s3_service.py's
own `_FakeS3Client` pattern — never a real AWS call in a test.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.services import s3_service
from factories import create_brand, create_location, create_owner


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


async def _owner_and_unowned_location(db_session):
    """An admin caller must not need to own anything — build a brand/
    location under a DIFFERENT owner than the admin to prove that.
    """
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id, phone="+14695550000")
    await db_session.commit()
    return owner, location


@pytest.mark.asyncio
async def test_admin_can_patch_a_location_it_does_not_own(client, db_session, as_user):
    _, location = await _owner_and_unowned_location(db_session)
    admin = as_user("admin")

    response = await client.patch(f"/locations/{location.id}", json={"phone": "+14695559999"})
    assert response.status_code == 200, response.text
    assert response.json()["phone"] == "+14695559999"

    audit_row = (
        await db_session.execute(
            select(AuditLog)
            .where(AuditLog.table_name == "restaurant_location", AuditLog.record_id == location.id)
        )
    ).scalar_one()
    assert audit_row.actor_role == "admin"
    assert audit_row.actor_id == admin.cognito_sub


@pytest.mark.asyncio
async def test_admin_can_replace_hours_for_a_location_it_does_not_own(client, db_session, as_user):
    _, location = await _owner_and_unowned_location(db_session)
    as_user("admin")

    body = {"hours": [{"day_of_week": 0, "open_time": "11:00:00", "close_time": "22:00:00", "is_closed": False}]}
    response = await client.put(f"/locations/{location.id}/hours", json=body)
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_admin_can_create_a_photo_upload_url_for_a_location_it_does_not_own(client, db_session, as_user):
    _, location = await _owner_and_unowned_location(db_session)
    as_user("admin")

    response = await client.post(
        f"/locations/{location.id}/photos/upload-url", json={"content_type": "image/jpeg"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["s3_key"].startswith(f"raw/locations/{location.id}/photos/")


@pytest.mark.asyncio
async def test_admin_can_create_update_and_delete_a_photo_for_a_location_it_does_not_own(
    client, db_session, as_user
):
    _, location = await _owner_and_unowned_location(db_session)
    as_user("admin")

    raw_key = f"raw/locations/{location.id}/photos/{uuid.uuid4().hex}.jpg"
    create = await client.post(
        f"/locations/{location.id}/photos", json={"s3_key": raw_key, "is_cover": False}
    )
    assert create.status_code == 201, create.text
    photo_id = create.json()["id"]

    update = await client.patch(
        f"/locations/{location.id}/photos/{photo_id}", json={"display_order": 3}
    )
    assert update.status_code == 200, update.text
    assert update.json()["display_order"] == 3

    delete = await client.delete(f"/locations/{location.id}/photos/{photo_id}")
    assert delete.status_code == 204, delete.text


@pytest.mark.asyncio
async def test_admin_cannot_create_a_new_location_directly(client, db_session, as_user):
    """POST /locations stays owner-only, same as POST /restaurants —
    deliberate, see docs/DECISIONS.md "Platform admin full-access parity
    on /locations write routes — manager assignment stays owner-only".
    """
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    await db_session.commit()
    as_user("admin")

    response = await client.post(
        "/locations",
        json={
            "brand_id": brand.id,
            "address_line1": "1 New Ave",
            "city": "Plano",
            "state": "TX",
            "postal_code": "75024",
            "country": "US",
            "phone": "+12145550100",
            "timezone": "America/Chicago",
        },
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_admin_cannot_assign_a_manager_directly(client, db_session, as_user):
    """POST /locations/{id}/managers stays owner-only — see
    docs/API_CONTRACTS.md "POST /locations/{id}/managers" and
    docs/DECISIONS.md for the reasoning. Admin support access to an
    existing manager assignment is still covered by the already-admin-
    parity DELETE (removal), unchanged by this task.
    """
    _, location = await _owner_and_unowned_location(db_session)
    as_user("admin")

    response = await client.post(
        f"/locations/{location.id}/managers", json={"manager_email": "someone@example.com"}
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_registered_user_still_cannot_patch_a_location(client, db_session, as_user):
    """Regression: admin parity must not have widened access beyond admin
    — a plain registered_user is still rejected.
    """
    _, location = await _owner_and_unowned_location(db_session)
    as_user("registered_user")

    response = await client.patch(f"/locations/{location.id}", json={"phone": "+14695550001"})
    assert response.status_code == 403
