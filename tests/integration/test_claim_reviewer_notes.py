"""Integration test: who/when approved + verification notes on admin claims.

Covers `GET /claim` reviewer enrichment (`reviewed_by_email`, best-effort
batched), the notes length cap on approve/reject, and
`PATCH /claim/{id}/notes` (edit a note after the review, audited).
docs/API_CONTRACTS.md "Claim flow (/claim)".
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.claim_request import ClaimRequest
from app.services import cognito_service
from factories import create_brand, create_claim, create_owner


class FakeCognito:
    def __init__(self) -> None:
        self.admin_emails: dict[str, str] = {}
        self.group_calls: list[str] = []
        self.fail = False

    def list_group_emails(self, group_name: str) -> dict[str, str]:
        self.group_calls.append(group_name)
        if self.fail:
            raise RuntimeError("cognito down")
        return self.admin_emails if group_name == "admin" else {}


@pytest.fixture
def cognito(monkeypatch) -> FakeCognito:
    fake = FakeCognito()
    monkeypatch.setattr(cognito_service, "list_group_emails", fake.list_group_emails)
    return fake


async def _reviewed_claim(db, *, status: str, reviewed_by: str, notes: str | None = "checked"):
    brand = await create_brand(db, is_claimed=False, owner_id=None)
    claim = await create_claim(
        db,
        brand_id=brand.id,
        status=status,
        reviewed_by=reviewed_by,
        reviewed_at=datetime.now(timezone.utc) - timedelta(hours=1),
        reviewer_notes=notes,
    )
    await db.commit()
    return claim


# ---------------------------------------------------------------------------
# GET /claim: reviewed_by_email
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["approved", "rejected"])
async def test_list_includes_reviewed_by_email_for_approved_and_rejected(
    client, db_session, as_user, cognito, status
):
    admin_sub = str(uuid.uuid4())
    cognito.admin_emails[admin_sub] = "admin1@example.com"
    claim = await _reviewed_claim(db_session, status=status, reviewed_by=admin_sub)

    as_user("admin")
    resp = await client.get("/claim", params={"status": status})
    assert resp.status_code == 200, resp.text
    row = resp.json()["results"][0]
    assert row["claim_id"] == claim.id
    assert row["reviewed_by"] == admin_sub
    assert row["reviewed_by_email"] == "admin1@example.com"
    assert row["reviewed_at"] is not None
    assert row["notes_edited_at"] is None


@pytest.mark.asyncio
async def test_reviewer_emails_are_batched_one_cognito_sweep_per_page(
    client, db_session, as_user, cognito
):
    admin_a, admin_b = str(uuid.uuid4()), str(uuid.uuid4())
    cognito.admin_emails.update({admin_a: "a@example.com", admin_b: "b@example.com"})
    for sub in (admin_a, admin_b, admin_a):
        await _reviewed_claim(db_session, status="approved", reviewed_by=sub)

    as_user("admin")
    resp = await client.get("/claim", params={"status": "approved"})
    assert resp.status_code == 200
    emails = sorted(r["reviewed_by_email"] for r in resp.json()["results"])
    assert emails == ["a@example.com", "a@example.com", "b@example.com"]
    assert cognito.group_calls == ["admin"]


@pytest.mark.asyncio
async def test_reviewer_resolves_from_owner_account_when_admin_is_also_owner(
    client, db_session, as_user, cognito
):
    owner = await create_owner(db_session)
    await _reviewed_claim(db_session, status="approved", reviewed_by=owner.cognito_sub)

    as_user("admin")
    row = (await client.get("/claim", params={"status": "approved"})).json()["results"][0]
    assert row["reviewed_by_email"] == owner.email
    assert cognito.group_calls == []


@pytest.mark.asyncio
async def test_reviewer_lookup_failure_returns_null_and_still_200(
    client, db_session, as_user, cognito
):
    admin_sub = str(uuid.uuid4())
    cognito.fail = True
    await _reviewed_claim(db_session, status="approved", reviewed_by=admin_sub)

    as_user("admin")
    resp = await client.get("/claim", params={"status": "approved"})
    assert resp.status_code == 200, resp.text
    row = resp.json()["results"][0]
    assert row["reviewed_by"] == admin_sub
    assert row["reviewed_by_email"] is None


# ---------------------------------------------------------------------------
# Notes cap / trim on approve + reject
# ---------------------------------------------------------------------------
async def _pending_claim(db):
    brand = await create_brand(db, is_claimed=False, owner_id=None)
    owner = await create_owner(db)
    claim = await create_claim(db, brand_id=brand.id, claimant_user_id=owner.cognito_sub)
    await db.commit()
    return claim


@pytest.mark.asyncio
async def test_approve_trims_notes_and_stores_them(client, db_session, as_user):
    claim = await _pending_claim(db_session)
    as_user("admin")
    resp = await client.post(
        f"/claim/{claim.id}/approve",
        json={"reviewer_notes": "  Verified over the phone with John.\nCalled 214-555-0100  "},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["reviewer_notes"] == "Verified over the phone with John.\nCalled 214-555-0100"


@pytest.mark.asyncio
async def test_approve_blank_notes_stored_as_null(client, db_session, as_user):
    claim = await _pending_claim(db_session)
    as_user("admin")
    resp = await client.post(f"/claim/{claim.id}/approve", json={"reviewer_notes": "   "})
    assert resp.status_code == 200
    assert resp.json()["reviewer_notes"] is None


@pytest.mark.asyncio
async def test_notes_over_cap_rejected_generic_422(client, db_session, as_user):
    claim = await _pending_claim(db_session)
    as_user("admin")
    too_long = "x" * 2001
    for action in ("approve", "reject"):
        resp = await client.post(f"/claim/{claim.id}/{action}", json={"reviewer_notes": too_long})
        assert resp.status_code == 422
        assert resp.json()["detail"] == "Invalid request parameters"
    # Exactly at the cap is fine.
    ok = await client.post(f"/claim/{claim.id}/approve", json={"reviewer_notes": "x" * 2000})
    assert ok.status_code == 200


@pytest.mark.asyncio
async def test_reject_still_requires_non_blank_notes(client, db_session, as_user):
    claim = await _pending_claim(db_session)
    as_user("admin")
    resp = await client.post(f"/claim/{claim.id}/reject", json={"reviewer_notes": "   "})
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# PATCH /claim/{id}/notes
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["registered_user", "owner", "manager"])
async def test_edit_notes_forbidden_for_non_admin(client, db_session, as_user, role):
    claim = await _reviewed_claim(db_session, status="approved", reviewed_by=str(uuid.uuid4()))
    as_user(role)
    resp = await client.patch(f"/claim/{claim.id}/notes", json={"reviewer_notes": "hi"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_edit_notes_requires_auth(client, as_anonymous):
    resp = await client.patch("/claim/1/notes", json={"reviewer_notes": "hi"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_edit_notes_on_pending_claim_is_409(client, db_session, as_user):
    claim = await _pending_claim(db_session)
    as_user("admin")
    resp = await client.patch(f"/claim/{claim.id}/notes", json={"reviewer_notes": "early"})
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Claim has not been reviewed yet"


@pytest.mark.asyncio
async def test_edit_notes_unknown_claim_is_404(client, as_user):
    as_user("admin")
    resp = await client.patch("/claim/999999/notes", json={"reviewer_notes": "x"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_edit_notes_over_cap_is_422(client, db_session, as_user):
    claim = await _reviewed_claim(db_session, status="approved", reviewed_by=str(uuid.uuid4()))
    as_user("admin")
    resp = await client.patch(f"/claim/{claim.id}/notes", json={"reviewer_notes": "x" * 2001})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_edit_notes_updates_only_notes_and_writes_audit(
    client, db_session, as_user, cognito
):
    reviewer_sub = str(uuid.uuid4())
    cognito.admin_emails[reviewer_sub] = "first@example.com"
    claim = await _reviewed_claim(
        db_session, status="approved", reviewed_by=reviewer_sub, notes="old note"
    )
    claim_id = claim.id
    # SQLite hands datetimes back naive; compare wall-clock values.
    before = (claim.status, claim.reviewed_by, claim.reviewed_at.replace(tzinfo=None))

    editor = as_user("admin", email="second@example.com")
    cognito.admin_emails[editor.cognito_sub] = "second@example.com"
    resp = await client.patch(
        f"/claim/{claim.id}/notes",
        json={"reviewer_notes": "  Verified over the phone with John  "},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["reviewer_notes"] == "Verified over the phone with John"
    assert body["status"] == "approved"
    assert body["reviewed_by"] == reviewer_sub
    assert body["reviewed_by_email"] == "first@example.com"
    assert body["notes_edited_by"] == editor.cognito_sub
    assert body["notes_edited_by_email"] == "second@example.com"
    assert body["notes_edited_at"] is not None

    db_session.expire_all()
    stored = (
        await db_session.execute(select(ClaimRequest).where(ClaimRequest.id == claim_id))
    ).scalar_one()
    assert (stored.status, stored.reviewed_by, stored.reviewed_at.replace(tzinfo=None)) == before
    assert stored.reviewer_notes == "Verified over the phone with John"

    audit = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.table_name == "claim_request", AuditLog.record_id == claim_id
            )
        )
    ).scalars().all()
    assert len(audit) == 1
    assert audit[0].action == "update"
    assert audit[0].actor_id == editor.cognito_sub
    assert audit[0].actor_role == "admin"
    assert audit[0].old_val == {"reviewer_notes": "old note"}
    assert audit[0].new_val == {"reviewer_notes": "Verified over the phone with John"}

    # The list endpoint surfaces the latest edit too.
    listed = (await client.get("/claim", params={"status": "approved"})).json()["results"][0]
    assert listed["notes_edited_by_email"] == "second@example.com"


@pytest.mark.asyncio
async def test_edit_notes_history_keeps_latest_editor(client, db_session, as_user, cognito):
    claim = await _reviewed_claim(
        db_session, status="approved", reviewed_by=str(uuid.uuid4()), notes=None
    )
    first = as_user("admin")
    await client.patch(f"/claim/{claim.id}/notes", json={"reviewer_notes": "one"})
    second = as_user("admin")
    resp = await client.patch(f"/claim/{claim.id}/notes", json={"reviewer_notes": "two"})
    assert resp.json()["notes_edited_by"] == second.cognito_sub
    assert second.cognito_sub != first.cognito_sub
    audit = (
        await db_session.execute(
            select(AuditLog).where(AuditLog.table_name == "claim_request").order_by(AuditLog.id)
        )
    ).scalars().all()
    assert [a.new_val["reviewer_notes"] for a in audit] == ["one", "two"]


@pytest.mark.asyncio
async def test_edit_notes_blank_clears_approved_but_not_rejected(client, db_session, as_user):
    approved = await _reviewed_claim(db_session, status="approved", reviewed_by=str(uuid.uuid4()))
    rejected = await _reviewed_claim(db_session, status="rejected", reviewed_by=str(uuid.uuid4()))
    as_user("admin")
    ok = await client.patch(f"/claim/{approved.id}/notes", json={"reviewer_notes": "  "})
    assert ok.status_code == 200
    assert ok.json()["reviewer_notes"] is None
    bad = await client.patch(f"/claim/{rejected.id}/notes", json={"reviewer_notes": ""})
    assert bad.status_code == 400
    ok2 = await client.patch(
        f"/claim/{rejected.id}/notes", json={"reviewer_notes": "Called, not the owner"}
    )
    assert ok2.status_code == 200
    assert ok2.json()["status"] == "rejected"
