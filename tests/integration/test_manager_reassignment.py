"""Integration test: re-assigning a manager to a location they were
previously soft-removed from — docs/PROJECT_PLAN.csv "Manager
reassignment / reactivation across restaurants — verify + close gap."

Verifies against the real HTTP router + `location_manager_service.
assign_manager`/`deactivate_manager` + a real (SQLite) DB that a manager
soft-removed from a location (`DELETE /locations/{id}/managers/{id}`,
`is_active=false`) can later be cleanly re-assigned to that SAME location
(`POST /locations/{id}/managers` again) without hitting a stale
unique-index conflict on `location_manager`'s partial unique index
(`uq_location_manager_active_user`, `postgresql_where="is_active = true"`
— docs/DATA_MODEL.md). `tests/integration/conftest.py`'s SQLite fixture
faithfully translates that Postgres partial index into a real SQLite
partial index (see its `_translate_postgres_partial_index_to_sqlite`
compiler shim), so this exercises the same constraint semantics Postgres
enforces in production, not a looser SQLite approximation.

`cognito_service.find_sub_by_email`/`find_email_by_sub` are monkeypatched
here (never a real AWS call in a test — root CLAUDE.md "AWS Best
Practices" / tests/CLAUDE.md "ALWAYS mock AWS calls instead of hitting
real AWS") since `assign_manager` resolves the request body's
`manager_email` through Cognito's Admin API.
"""
from __future__ import annotations

import uuid

import pytest

from app.models.audit_log import AuditLog
from app.services import location_manager_service
from factories import create_brand, create_location, create_owner
from sqlalchemy import select


@pytest.fixture
def manager_identity():
    return {"email": "manager@example.com", "sub": str(uuid.uuid4())}


@pytest.fixture(autouse=True)
def mock_cognito_lookup(monkeypatch, manager_identity):
    monkeypatch.setattr(
        location_manager_service.cognito_service,
        "find_sub_by_email",
        lambda email: manager_identity["sub"] if email == manager_identity["email"] else None,
    )
    monkeypatch.setattr(
        location_manager_service.cognito_service,
        "find_email_by_sub",
        lambda sub: manager_identity["email"] if sub == manager_identity["sub"] else None,
    )


@pytest.mark.asyncio
async def test_manager_can_be_reassigned_to_same_location_after_soft_removal(
    client, db_session, as_user, manager_identity
):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    first_assign = await client.post(
        f"/locations/{location.id}/managers",
        json={"manager_email": manager_identity["email"]},
    )
    assert first_assign.status_code == 201, first_assign.text
    first_manager_id = first_assign.json()["id"]
    assert first_assign.json()["is_active"] is True

    remove = await client.delete(f"/locations/{location.id}/managers/{first_manager_id}")
    assert remove.status_code == 204, remove.text

    # Re-assign the SAME person to the SAME location — must not 409 on a
    # stale unique-index conflict against the now-inactive row.
    second_assign = await client.post(
        f"/locations/{location.id}/managers",
        json={"manager_email": manager_identity["email"]},
    )
    assert second_assign.status_code == 201, second_assign.text
    second_body = second_assign.json()
    assert second_body["is_active"] is True
    assert second_body["user_id"] == manager_identity["sub"]
    # A new history row, not the old one flipped back — assign_manager
    # always inserts (docs/API_CONTRACTS.md "Re-assigning a previously-
    # removed manager to the same location").
    assert second_body["id"] != first_manager_id

    # Exactly one active row for this (location, user) pair now exists.
    active_list = await client.get(
        f"/locations/{location.id}/managers", params={"active_only": "true"}
    )
    assert active_list.status_code == 200, active_list.text
    active_rows = active_list.json()["results"]
    assert len(active_rows) == 1
    assert active_rows[0]["id"] == second_body["id"]

    # Full history (default, owner caller) shows both rows.
    full_list = await client.get(f"/locations/{location.id}/managers")
    assert {row["id"] for row in full_list.json()["results"]} == {first_manager_id, second_body["id"]}


@pytest.mark.asyncio
async def test_reassign_still_rejects_a_truly_duplicate_active_assignment(
    client, db_session, as_user, manager_identity
):
    """Sanity check the other direction: assigning the same person to the
    same location TWICE without ever removing them in between must still
    409 — the fix path above must not have accidentally disabled the
    active-duplicate guard entirely.
    """
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    first = await client.post(
        f"/locations/{location.id}/managers", json={"manager_email": manager_identity["email"]}
    )
    assert first.status_code == 201, first.text

    duplicate = await client.post(
        f"/locations/{location.id}/managers", json={"manager_email": manager_identity["email"]}
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "already_active_manager"


@pytest.mark.asyncio
async def test_reassignment_audit_log_records_both_writes(
    client, db_session, as_user, manager_identity
):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    first_assign = await client.post(
        f"/locations/{location.id}/managers", json={"manager_email": manager_identity["email"]}
    )
    first_manager_id = first_assign.json()["id"]
    await client.delete(f"/locations/{location.id}/managers/{first_manager_id}")
    second_assign = await client.post(
        f"/locations/{location.id}/managers", json={"manager_email": manager_identity["email"]}
    )
    second_manager_id = second_assign.json()["id"]

    rows = (
        await db_session.execute(
            select(AuditLog)
            .where(AuditLog.table_name == "location_manager")
            .order_by(AuditLog.id)
        )
    ).scalars().all()
    # create (row 1), update/deactivate (row 1), create (row 2).
    assert [(r.record_id, r.action) for r in rows] == [
        (first_manager_id, "create"),
        (first_manager_id, "update"),
        (second_manager_id, "create"),
    ]
    assert all(r.actor_role == "owner" and r.actor_id == owner.cognito_sub for r in rows)
