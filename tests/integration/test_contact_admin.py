"""Integration test: "Contact admin" — POST /contact-admin (owner/manager),
GET /admin/messages and PATCH /admin/messages/{id} (admin only).

docs/API_CONTRACTS.md "Contact admin". Same harness as test_listing_report.py
(real FastAPI app + router + service + SQLite).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.models.admin_message import AdminMessage
from app.models.audit_log import AuditLog
from factories import (
    create_brand,
    create_location,
    create_location_manager,
    create_owner,
)

VALID = {"subject": "Hours not saving", "body": "My Sunday hours revert after I save them."}


async def _count(db_session) -> int:
    return (await db_session.execute(select(func.count()).select_from(AdminMessage))).scalar_one()


async def _owner_with_location(db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()
    return owner, brand, location


def _seed_message(db_session, *, sub=None, status="open", created_at=None, **kw) -> AdminMessage:
    message = AdminMessage(
        sender_cognito_sub=sub or str(uuid.uuid4()),
        sender_role=kw.pop("sender_role", "owner"),
        sender_email=kw.pop("sender_email", f"{uuid.uuid4().hex[:8]}@example.com"),
        sender_name=kw.pop("sender_name", None),
        subject=kw.pop("subject", "A subject"),
        body=kw.pop("body", "A message body long enough."),
        status=status,
        created_at=created_at or datetime.now(timezone.utc),
        **kw,
    )
    db_session.add(message)
    return message


# ---------------------------------------------------------------------------
# POST /contact-admin
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_owner_can_send_and_identity_comes_from_token(client, db_session, as_user):
    owner, _brand, location = await _owner_with_location(db_session)
    owner.full_name = "Asha Rao"
    await db_session.commit()
    user = as_user("owner", sub=owner.cognito_sub, email=owner.email)

    resp = await client.post(
        "/contact-admin",
        json={**VALID, "related_location_id": location.id, "sender_email": "spoof@example.com"},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json() == {"status": "received"}

    row = (await db_session.execute(select(AdminMessage))).scalar_one()
    assert row.sender_cognito_sub == user.cognito_sub
    assert row.sender_role == "owner"
    assert row.sender_email == owner.email
    assert row.sender_name == "Asha Rao"
    assert row.related_location_id == location.id
    assert row.status == "open"


@pytest.mark.asyncio
async def test_manager_can_send_for_assigned_location(client, db_session, as_user):
    _owner, _brand, location = await _owner_with_location(db_session)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location.id, user_id=manager_sub)
    await db_session.commit()
    as_user("manager", sub=manager_sub)

    resp = await client.post("/contact-admin", json={**VALID, "related_location_id": location.id})
    assert resp.status_code == 201, resp.text
    row = (await db_session.execute(select(AdminMessage))).scalar_one()
    assert row.sender_role == "manager"
    assert row.related_location_id == location.id


@pytest.mark.asyncio
async def test_manager_cannot_attach_unassigned_location(client, db_session, as_user):
    _owner, brand, assigned = await _owner_with_location(db_session)
    other = await create_location(db_session, brand_id=brand.id)
    inactive = await create_location(db_session, brand_id=brand.id)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=assigned.id, user_id=manager_sub)
    await create_location_manager(
        db_session, location_id=inactive.id, user_id=manager_sub, is_active=False
    )
    await db_session.commit()
    as_user("manager", sub=manager_sub)

    for location_id in (other.id, inactive.id, 999_999):
        resp = await client.post("/contact-admin", json={**VALID, "related_location_id": location_id})
        assert resp.status_code == 400, resp.text
        # Identical for "exists but not yours" and "does not exist".
        assert resp.json() == {"detail": "Invalid location", "code": "invalid_location"}
    assert await _count(db_session) == 0


@pytest.mark.asyncio
async def test_owner_cannot_attach_another_owners_location(client, db_session, as_user):
    owner, _brand, _location = await _owner_with_location(db_session)
    _other_owner, _other_brand, foreign = await _owner_with_location(db_session)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    resp = await client.post("/contact-admin", json={**VALID, "related_location_id": foreign.id})
    assert resp.status_code == 400
    assert resp.json()["code"] == "invalid_location"
    assert await _count(db_session) == 0


@pytest.mark.asyncio
async def test_location_is_optional(client, db_session, as_user):
    owner, _brand, _location = await _owner_with_location(db_session)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    resp = await client.post("/contact-admin", json=VALID)
    assert resp.status_code == 201, resp.text
    row = (await db_session.execute(select(AdminMessage))).scalar_one()
    assert row.related_location_id is None


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["registered_user", "admin"])
async def test_other_roles_cannot_send(client, db_session, as_user, role):
    as_user(role)
    resp = await client.post("/contact-admin", json=VALID)
    assert resp.status_code == 403
    assert await _count(db_session) == 0


@pytest.mark.asyncio
async def test_anonymous_cannot_send(client, db_session, as_anonymous):
    resp = await client.post("/contact-admin", json=VALID)
    assert resp.status_code == 401
    assert await _count(db_session) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        {"subject": "ab", "body": "A long enough message body."},  # subject < 3
        {"subject": "  a  ", "body": "A long enough message body."},  # trimmed < 3
        {"subject": "x" * 121, "body": "A long enough message body."},  # subject > 120
        {"subject": "Valid subject", "body": "too short"},  # body < 10
        {"subject": "Valid subject", "body": "   short   "},  # trimmed < 10
        {"subject": "Valid subject", "body": "x" * 4001},  # body > 4000
    ],
)
async def test_length_validation(client, db_session, as_user, payload):
    owner, _brand, _location = await _owner_with_location(db_session)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    resp = await client.post("/contact-admin", json=payload)
    assert resp.status_code == 422
    assert await _count(db_session) == 0


@pytest.mark.asyncio
async def test_boundary_lengths_accepted(client, db_session, as_user):
    owner, _brand, _location = await _owner_with_location(db_session)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    resp = await client.post(
        "/contact-admin", json={"subject": "x" * 120, "body": "y" * 4000}
    )
    assert resp.status_code == 201, resp.text


@pytest.mark.asyncio
async def test_rate_limit_five_per_rolling_hour(client, db_session, as_user):
    owner, _brand, _location = await _owner_with_location(db_session)
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    for _ in range(5):
        resp = await client.post("/contact-admin", json=VALID)
        assert resp.status_code == 201, resp.text
    resp = await client.post("/contact-admin", json=VALID)
    assert resp.status_code == 429
    assert resp.json()["code"] == "rate_limited"
    assert await _count(db_session) == 5

    # Rolling window: age the messages past an hour and sending works again.
    for row in (await db_session.execute(select(AdminMessage))).scalars():
        row.created_at = datetime.now(timezone.utc) - timedelta(hours=1, minutes=1)
    await db_session.commit()
    resp = await client.post("/contact-admin", json=VALID)
    assert resp.status_code == 201, resp.text


@pytest.mark.asyncio
async def test_rate_limit_is_per_sender(client, db_session, as_user):
    owner, _brand, _location = await _owner_with_location(db_session)
    for _ in range(5):
        _seed_message(db_session, sub=owner.cognito_sub)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    assert (await client.post("/contact-admin", json=VALID)).status_code == 429

    other, _b, _l = await _owner_with_location(db_session)
    as_user("owner", sub=other.cognito_sub, email=other.email)
    assert (await client.post("/contact-admin", json=VALID)).status_code == 201


# ---------------------------------------------------------------------------
# GET /admin/messages
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["owner", "manager", "registered_user"])
async def test_non_admin_cannot_list_or_update(client, db_session, as_user, role):
    message = _seed_message(db_session)
    await db_session.commit()
    as_user(role)
    assert (await client.get("/admin/messages")).status_code == 403
    resp = await client.patch(f"/admin/messages/{message.id}", json={"status": "resolved"})
    assert resp.status_code == 403
    await db_session.refresh(message)
    assert message.status == "open"


@pytest.mark.asyncio
async def test_admin_list_filter_search_and_open_count(client, db_session, as_user):
    now = datetime.now(timezone.utc)
    _owner, brand, location = await _owner_with_location(db_session)
    _seed_message(
        db_session,
        subject="Menu photos missing",
        sender_email="asha@example.com",
        sender_name="Asha Rao",
        related_location_id=location.id,
        created_at=now - timedelta(minutes=30),
    )
    _seed_message(
        db_session, subject="Billing question", body="When does billing start?",
        created_at=now - timedelta(minutes=20),
    )
    _seed_message(
        db_session, subject="Old one", status="resolved", created_at=now - timedelta(minutes=10)
    )
    await db_session.commit()
    as_user("admin")

    body = (await client.get("/admin/messages")).json()
    assert body["total"] == 3
    assert body["open_count"] == 2
    # "all" is newest-first.
    assert [m["subject"] for m in body["results"]][0] == "Old one"

    open_body = (await client.get("/admin/messages", params={"status": "open"})).json()
    assert [m["subject"] for m in open_body["results"]] == ["Menu photos missing", "Billing question"]
    assert open_body["open_count"] == 2

    resolved = (await client.get("/admin/messages", params={"status": "resolved"})).json()
    assert resolved["total"] == 1

    for q, expected in [("photos", 1), ("ASHA@", 1), ("asha rao", 1), ("billing start", 1), ("nope", 0)]:
        found = (await client.get("/admin/messages", params={"q": q})).json()
        assert found["total"] == expected, q

    # Wildcards are literal, not LIKE patterns.
    assert (await client.get("/admin/messages", params={"q": "%"})).json()["total"] == 0

    first = open_body["results"][0]
    assert first["sender_email"] == "asha@example.com"
    assert first["related_location_id"] == location.id
    assert brand.name in first["related_location_label"]
    assert first["related_location_slug"] == location.slug
    assert first["related_location_brand_slug"] == brand.slug

    paged = (await client.get("/admin/messages", params={"page_size": 2, "page": 2})).json()
    assert len(paged["results"]) == 1 and paged["total"] == 3


# ---------------------------------------------------------------------------
# PATCH /admin/messages/{id}
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_admin_resolve_and_reopen_with_audit(client, db_session, as_user):
    message = _seed_message(db_session)
    await db_session.commit()
    admin = as_user("admin")

    resp = await client.patch(f"/admin/messages/{message.id}", json={"status": "resolved"})
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["status"] == "resolved"
    assert out["resolved_by"] == admin.cognito_sub
    assert out["resolved_at"] is not None

    resp = await client.patch(f"/admin/messages/{message.id}", json={"status": "open"})
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["status"] == "open"
    assert out["resolved_by"] is None and out["resolved_at"] is None

    entries = (
        (await db_session.execute(select(AuditLog).where(AuditLog.table_name == "admin_message")))
        .scalars()
        .all()
    )
    assert len(entries) == 2
    assert {e.actor_role for e in entries} == {"admin"}
    assert {e.record_id for e in entries} == {message.id}


@pytest.mark.asyncio
async def test_patch_unknown_message_is_404_and_bad_status_is_422(client, db_session, as_user):
    message = _seed_message(db_session)
    await db_session.commit()
    as_user("admin")
    assert (
        await client.patch("/admin/messages/999999", json={"status": "resolved"})
    ).status_code == 404
    assert (
        await client.patch(f"/admin/messages/{message.id}", json={"status": "dismissed"})
    ).status_code == 422
