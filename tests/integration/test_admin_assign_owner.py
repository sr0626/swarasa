"""Integration tests: admin owner assignment (docs/API_CONTRACTS.md
"Admin: assign an owner to an unclaimed listing" and "POST /admin/owners").

Cognito is never reached: `cognito_service.list_group_emails` is replaced.
Covers auth, by-id and by-email assignment, create-on-assign of the
owner_account (+ audit), 409s (already owned / pending claim), 404s,
generic error wording (no owner identity disclosed), paid-tier fields left
untouched, cross-owner manager revocation, and `POST /admin/owners`.
"""
from __future__ import annotations

import uuid

import pytest
from botocore.exceptions import ClientError
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.location_manager import LocationManager
from app.models.owner_account import OwnerAccount
from app.services import cognito_service
from factories import (
    create_brand,
    create_claim,
    create_location,
    create_location_manager,
    create_owner,
)


class _FakeOwnerGroup(dict):
    """`{sub: email}` the fake Cognito `owner` group returns; also records
    which groups were queried in `.calls`."""

    def __init__(self) -> None:
        super().__init__()
        self.calls: list[str] = []


@pytest.fixture
def cognito_owners(monkeypatch):
    owners = _FakeOwnerGroup()

    def fake(group_name: str) -> dict[str, str]:
        owners.calls.append(group_name)
        return dict(owners)

    monkeypatch.setattr(cognito_service, "list_group_emails", fake)
    return owners


async def _audit(db_session, table: str, record_id: int) -> list[AuditLog]:
    return list(
        (
            await db_session.execute(
                select(AuditLog).where(AuditLog.table_name == table, AuditLog.record_id == record_id)
            )
        ).scalars()
    )


@pytest.mark.asyncio
async def test_assign_requires_admin(client, db_session, as_user):
    brand = await create_brand(db_session, owner_id=None, is_claimed=False)
    owner = await create_owner(db_session)
    for role in ("owner", "manager", "registered_user"):
        as_user(role)
        resp = await client.post(
            f"/admin/restaurants/{brand.id}/assign-owner", json={"owner_id": owner.id}
        )
        assert resp.status_code == 403, role


@pytest.mark.asyncio
async def test_assign_anonymous_rejected(client, as_anonymous):
    resp = await client.post("/admin/restaurants/1/assign-owner", json={"owner_id": 1})
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_assign_by_owner_id(client, db_session, as_user):
    admin = as_user("admin")
    owner = await create_owner(db_session, email="o@example.com")
    brand = await create_brand(db_session, owner_id=None, is_claimed=False, claimed_at=None)
    loc = await create_location(db_session, brand_id=brand.id, is_paid=True)
    paid_until = loc.paid_until
    other = await create_location(db_session, brand_id=brand.id, is_paid=False)

    resp = await client.post(
        f"/admin/restaurants/{brand.id}/assign-owner", json={"owner_id": owner.id}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "brand_id": brand.id,
        "owner_id": owner.id,
        "owner_email": "o@example.com",
        "is_claimed": True,
        "owner_account_created": False,
        "revoked_manager_count": 0,
    }
    await db_session.refresh(brand)
    assert brand.owner_id == owner.id
    assert brand.is_claimed is True
    assert brand.claimed_at is not None

    # Tier fields are untouched.
    await db_session.refresh(loc)
    await db_session.refresh(other)
    assert loc.is_paid is True and loc.paid_until == paid_until
    assert other.is_paid is False

    entries = await _audit(db_session, "restaurant_brand", brand.id)
    assert len(entries) == 1
    entry = entries[0]
    assert entry.action == "update"
    assert entry.actor_id == admin.cognito_sub and entry.actor_role == "admin"
    assert entry.old_val["owner_id"] is None and entry.old_val["is_claimed"] is False
    assert entry.new_val["owner_id"] == owner.id and entry.new_val["is_claimed"] is True


@pytest.mark.asyncio
async def test_assign_by_email_uses_existing_owner_without_cognito(
    client, db_session, as_user, cognito_owners
):
    as_user("admin")
    owner = await create_owner(db_session, email="Existing@Example.com")
    brand = await create_brand(db_session, owner_id=None, is_claimed=False)
    resp = await client.post(
        f"/admin/restaurants/{brand.id}/assign-owner", json={"owner_email": "  existing@example.COM "}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["owner_id"] == owner.id
    assert resp.json()["owner_account_created"] is False
    assert cognito_owners.calls == []


@pytest.mark.asyncio
async def test_assign_by_email_creates_owner_account_for_cognito_owner(
    client, db_session, as_user, cognito_owners
):
    admin = as_user("admin")
    sub = str(uuid.uuid4())
    cognito_owners[sub] = "New.Owner@example.com"
    cognito_owners[str(uuid.uuid4())] = "someone-else@example.com"
    brand = await create_brand(db_session, owner_id=None, is_claimed=False)

    resp = await client.post(
        f"/admin/restaurants/{brand.id}/assign-owner", json={"owner_email": "new.owner@example.com"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["owner_account_created"] is True
    assert body["owner_email"] == "New.Owner@example.com"
    assert cognito_owners.calls == ["owner"]

    created = (
        await db_session.execute(select(OwnerAccount).where(OwnerAccount.cognito_sub == sub))
    ).scalar_one()
    assert created.id == body["owner_id"]
    await db_session.refresh(brand)
    assert brand.owner_id == created.id

    owner_audit = await _audit(db_session, "owner_account", created.id)
    assert len(owner_audit) == 1
    assert owner_audit[0].action == "create"
    assert owner_audit[0].actor_id == admin.cognito_sub
    assert await _audit(db_session, "restaurant_brand", brand.id)


@pytest.mark.asyncio
async def test_assign_by_email_unknown_in_cognito_is_generic_404(
    client, db_session, as_user, cognito_owners
):
    as_user("admin")
    brand = await create_brand(db_session, owner_id=None, is_claimed=False)
    resp = await client.post(
        f"/admin/restaurants/{brand.id}/assign-owner", json={"owner_email": "nobody@example.com"}
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "owner_not_found"
    assert "nobody@example.com" not in resp.json()["detail"]
    await db_session.refresh(brand)
    assert brand.owner_id is None and brand.is_claimed is False
    assert await _audit(db_session, "restaurant_brand", brand.id) == []


@pytest.mark.asyncio
async def test_assign_cognito_failure_is_generic_502_and_writes_nothing(
    client, db_session, as_user, monkeypatch
):
    as_user("admin")

    def boom(group_name):
        raise ClientError({"Error": {"Code": "AccessDeniedException", "Message": "secret"}}, "x")

    monkeypatch.setattr(cognito_service, "list_group_emails", boom)
    brand = await create_brand(db_session, owner_id=None, is_claimed=False)
    resp = await client.post(
        f"/admin/restaurants/{brand.id}/assign-owner", json={"owner_email": "a@example.com"}
    )
    assert resp.status_code == 502
    assert resp.json()["code"] == "upstream_error"
    assert "secret" not in resp.text and "AccessDenied" not in resp.text
    await db_session.refresh(brand)
    assert brand.owner_id is None


@pytest.mark.asyncio
async def test_assign_already_owned_is_generic_409(client, db_session, as_user):
    as_user("admin")
    current = await create_owner(db_session, email="current-owner@example.com")
    new = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=current.id, is_claimed=True)
    resp = await client.post(
        f"/admin/restaurants/{brand.id}/assign-owner", json={"owner_id": new.id}
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "brand_already_owned"
    assert "current-owner@example.com" not in resp.text
    await db_session.refresh(brand)
    assert brand.owner_id == current.id
    assert await _audit(db_session, "restaurant_brand", brand.id) == []


@pytest.mark.asyncio
async def test_assign_blocked_by_pending_claim(client, db_session, as_user):
    as_user("admin")
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=None, is_claimed=False)
    await create_claim(db_session, brand_id=brand.id, status="pending_review")
    resp = await client.post(
        f"/admin/restaurants/{brand.id}/assign-owner", json={"owner_id": owner.id}
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "claim_pending"
    await db_session.refresh(brand)
    assert brand.owner_id is None


@pytest.mark.asyncio
async def test_assign_unknown_brand_and_soft_deleted_brand_404(client, db_session, as_user):
    from datetime import datetime, timezone

    as_user("admin")
    owner = await create_owner(db_session)
    resp = await client.post("/admin/restaurants/999999/assign-owner", json={"owner_id": owner.id})
    assert resp.status_code == 404
    deleted = await create_brand(
        db_session, owner_id=None, is_claimed=False, deleted_at=datetime.now(timezone.utc)
    )
    resp = await client.post(
        f"/admin/restaurants/{deleted.id}/assign-owner", json={"owner_id": owner.id}
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_assign_unknown_or_deleted_owner_id_404(client, db_session, as_user):
    from datetime import datetime, timezone

    as_user("admin")
    brand = await create_brand(db_session, owner_id=None, is_claimed=False)
    resp = await client.post(
        f"/admin/restaurants/{brand.id}/assign-owner", json={"owner_id": 999999}
    )
    assert resp.status_code == 404 and resp.json()["code"] == "owner_not_found"
    gone = await create_owner(db_session, personal_data_deleted_at=datetime.now(timezone.utc))
    resp = await client.post(
        f"/admin/restaurants/{brand.id}/assign-owner", json={"owner_id": gone.id}
    )
    assert resp.status_code == 404
    await db_session.refresh(brand)
    assert brand.owner_id is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"owner_id": 1, "owner_email": "a@example.com"},
        {"owner_email": "not-an-email"},
        {"owner_id": 0},
        {"owner_id": 1, "stripe_customer_id": "x"},
    ],
)
async def test_assign_validation(client, db_session, as_user, payload):
    as_user("admin")
    brand = await create_brand(db_session, owner_id=None, is_claimed=False)
    resp = await client.post(f"/admin/restaurants/{brand.id}/assign-owner", json=payload)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_assign_revokes_only_cross_owner_managers(client, db_session, as_user):
    admin = as_user("admin")
    new_owner = await create_owner(db_session)
    other_owner = await create_owner(db_session)

    brand = await create_brand(db_session, owner_id=None, is_claimed=False)
    loc = await create_location(db_session, brand_id=brand.id)

    # Manager A also works for a DIFFERENT owner -> conflict -> revoked here.
    other_brand = await create_brand(db_session, owner_id=other_owner.id, is_claimed=True)
    other_loc = await create_location(db_session, brand_id=other_brand.id)
    conflicted_sub = str(uuid.uuid4())
    orphan_a = await create_location_manager(db_session, location_id=loc.id, user_id=conflicted_sub)
    await create_location_manager(db_session, location_id=other_loc.id, user_id=conflicted_sub)

    # Manager B only has this brand -> keeps access under the new owner.
    clean_sub = str(uuid.uuid4())
    orphan_b = await create_location_manager(db_session, location_id=loc.id, user_id=clean_sub)

    # Manager C: same NEW owner elsewhere is not a conflict.
    same_brand = await create_brand(db_session, owner_id=new_owner.id, is_claimed=True)
    same_loc = await create_location(db_session, brand_id=same_brand.id)
    same_sub = str(uuid.uuid4())
    orphan_c = await create_location_manager(db_session, location_id=loc.id, user_id=same_sub)
    await create_location_manager(db_session, location_id=same_loc.id, user_id=same_sub)

    resp = await client.post(
        f"/admin/restaurants/{brand.id}/assign-owner", json={"owner_id": new_owner.id}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["revoked_manager_count"] == 1

    for row in (orphan_a, orphan_b, orphan_c):
        await db_session.refresh(row)
    assert orphan_a.is_active is False and orphan_a.revoked_at is not None
    assert orphan_b.is_active is True
    assert orphan_c.is_active is True
    # The conflicted manager's assignment under the other owner is untouched.
    remaining = (
        await db_session.execute(
            select(LocationManager).where(
                LocationManager.user_id == conflicted_sub, LocationManager.is_active.is_(True)
            )
        )
    ).scalars().all()
    assert [m.location_id for m in remaining] == [other_loc.id]

    audit = await _audit(db_session, "location_manager", orphan_a.id)
    assert len(audit) == 1
    assert audit[0].actor_id == admin.cognito_sub
    assert audit[0].old_val == {"is_active": True}
    assert audit[0].new_val["is_active"] is False
    assert await _audit(db_session, "location_manager", orphan_b.id) == []
    # The response/logs never name the other owner.
    assert str(other_owner.email) not in resp.text


# --- POST /admin/owners ----------------------------------------------------


@pytest.mark.asyncio
async def test_add_owner_requires_admin(client, db_session, as_user):
    for role in ("owner", "manager", "registered_user"):
        as_user(role)
        resp = await client.post("/admin/owners", json={"email": "a@example.com"})
        assert resp.status_code == 403, role


@pytest.mark.asyncio
async def test_add_owner_creates_account_and_audit(client, db_session, as_user, cognito_owners):
    admin = as_user("admin")
    sub = str(uuid.uuid4())
    cognito_owners[sub] = "pre@example.com"
    resp = await client.post("/admin/owners", json={"email": " PRE@example.com "})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["email"] == "pre@example.com"
    assert body["joined_at"].endswith("Z") or "+" in body["joined_at"]
    owner = await db_session.get(OwnerAccount, body["id"])
    assert owner is not None and owner.cognito_sub == sub
    entries = await _audit(db_session, "owner_account", owner.id)
    assert len(entries) == 1 and entries[0].action == "create"
    assert entries[0].actor_id == admin.cognito_sub

    # Shows up in the owners report (zero brands).
    listing = await client.get("/admin/owners", params={"q": "pre@example.com"})
    assert listing.json()["total"] == 1


@pytest.mark.asyncio
async def test_add_owner_duplicate_is_409(client, db_session, as_user, cognito_owners):
    as_user("admin")
    await create_owner(db_session, email="dup@example.com")
    resp = await client.post("/admin/owners", json={"email": "dup@example.com"})
    assert resp.status_code == 409
    assert resp.json()["code"] == "owner_exists"
    assert cognito_owners.calls == []


@pytest.mark.asyncio
async def test_add_owner_not_in_cognito_owner_group_404(client, db_session, as_user, cognito_owners):
    as_user("admin")
    resp = await client.post("/admin/owners", json={"email": "ghost@example.com"})
    assert resp.status_code == 404
    assert resp.json()["code"] == "owner_not_found"
    assert (
        await db_session.execute(select(OwnerAccount).where(OwnerAccount.email == "ghost@example.com"))
    ).scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_add_owner_invalid_email_422(client, db_session, as_user):
    as_user("admin")
    assert (await client.post("/admin/owners", json={"email": "nope"})).status_code == 422
    assert (await client.post("/admin/owners", json={})).status_code == 422
