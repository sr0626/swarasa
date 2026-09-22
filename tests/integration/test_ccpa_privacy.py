"""Integration tests: CCPA data export (`GET /auth/me/data-export`) and
data deletion (`POST /auth/me/data-deletion`, `GET /auth/me/data-deletion`,
`GET /data-deletion/{id}`, `POST /data-deletion/{id}/approve`,
`POST /data-deletion/{id}/reject`) — see
docs/API_CONTRACTS.md "Privacy (CCPA data export / deletion)" and
docs/DECISIONS.md "CCPA data export/deletion" for the reasoning behind
what gets deleted vs. retained/redacted. Runs against the real FastAPI
app + router + service layer + the sandbox's SQLite DB, same shape as
tests/integration/test_claim_flow.py and test_follow_api.py.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.claim_request import ClaimRequest
from app.models.listing_report import ListingReport
from app.models.location_manager import LocationManager
from app.models.owner_account import OwnerAccount
from app.models.user_follow import UserFollow
from factories import (
    create_brand,
    create_claim,
    create_deletion_request,
    create_follow,
    create_listing_report,
    create_location,
    create_location_manager,
    create_owner,
    submitted_recently,
)


# ---------------------------------------------------------------------------
# GET /auth/me/data-export
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_export_requires_auth(client, db_session, as_anonymous):
    response = await client.get("/auth/me/data-export")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_export_returns_only_the_caller_own_follows_and_claims(client, db_session, as_user):
    brand_a = await create_brand(db_session)
    brand_b = await create_brand(db_session)
    await db_session.commit()

    my_sub = str(uuid.uuid4())
    other_sub = str(uuid.uuid4())
    await create_follow(db_session, user_id=my_sub, brand_id=brand_a.id)
    await create_follow(db_session, user_id=other_sub, brand_id=brand_b.id)
    await create_claim(db_session, claimant_user_id=my_sub, brand_id=brand_a.id, status="approved")
    await create_claim(db_session, claimant_user_id=other_sub, brand_id=brand_b.id, status="approved")
    await db_session.commit()

    as_user("registered_user", sub=my_sub)
    response = await client.get("/auth/me/data-export")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["cognito_sub"] == my_sub
    assert len(body["follows"]) == 1
    assert body["follows"][0]["brand_id"] == brand_a.id
    assert len(body["claim_requests"]) == 1
    assert body["claim_requests"][0]["brand_id"] == brand_a.id
    assert body["owner_account"] is None
    assert "notice" in body and body["notice"]


@pytest.mark.asyncio
async def test_export_includes_owner_account_when_it_exists(client, db_session, as_user):
    owner = await create_owner(db_session, full_name="Priya Rao", phone="+14695551234")
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.get("/auth/me/data-export")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["owner_account"]["id"] == owner.id
    assert body["owner_account"]["full_name"] == "Priya Rao"
    assert body["owner_account"]["personal_data_deleted_at"] is None


@pytest.mark.asyncio
async def test_export_does_not_lazily_create_an_owner_account(client, db_session, as_user):
    """Unlike GET /auth/me, a data export is read-only — requesting it
    must never provision a new owner_account row as a side effect.
    """
    owner_sub = str(uuid.uuid4())
    as_user("owner", sub=owner_sub, email="new-owner@example.com")

    response = await client.get("/auth/me/data-export")
    assert response.status_code == 200, response.text
    assert response.json()["owner_account"] is None

    rows = (
        await db_session.execute(select(OwnerAccount).where(OwnerAccount.cognito_sub == owner_sub))
    ).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_export_includes_location_manager_assignments(client, db_session, as_user):
    brand = await create_brand(db_session)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, user_id=manager_sub, location_id=location.id)
    await db_session.commit()

    as_user("manager", sub=manager_sub)
    response = await client.get("/auth/me/data-export")

    assert response.status_code == 200, response.text
    assignments = response.json()["location_manager_assignments"]
    assert len(assignments) == 1
    assert assignments[0]["location_id"] == location.id
    assert assignments[0]["is_active"] is True


@pytest.mark.asyncio
async def test_export_includes_only_the_callers_own_listing_reports(client, db_session, as_user):
    """`listing_report` rows are matched by `reporter_user_id` — never by
    `reporter_email` (free text any submitter can type, not a reliable
    identity match; see privacy_service module docstring). A report with
    no `reporter_user_id` at all (anonymous submission) must never show
    up in anyone's export, even if its `reporter_email` happens to match
    the caller's own account email.
    """
    brand = await create_brand(db_session)
    await db_session.commit()

    my_sub = str(uuid.uuid4())
    other_sub = str(uuid.uuid4())
    mine = await create_listing_report(
        db_session,
        brand_id=brand.id,
        reporter_user_id=my_sub,
        reporter_email="me@example.com",
        category="hours_incorrect",
        details="Closed Mondays now.",
    )
    await create_listing_report(
        db_session, brand_id=brand.id, reporter_user_id=other_sub, reporter_email="them@example.com"
    )
    # Anonymous report whose typed-in email happens to match the caller's
    # own account email — must NOT be attributed to them.
    await create_listing_report(
        db_session, brand_id=brand.id, reporter_user_id=None, reporter_email="my-account@example.com"
    )
    await db_session.commit()

    as_user("registered_user", sub=my_sub, email="my-account@example.com")
    response = await client.get("/auth/me/data-export")

    assert response.status_code == 200, response.text
    reports = response.json()["listing_reports"]
    assert len(reports) == 1
    assert reports[0]["report_id"] == mine.id
    assert reports[0]["brand_id"] == brand.id
    assert reports[0]["category"] == "hours_incorrect"
    assert reports[0]["details"] == "Closed Mondays now."
    assert reports[0]["reporter_email"] == "me@example.com"
    assert reports[0]["status"] == "new"


@pytest.mark.asyncio
async def test_export_listing_reports_empty_when_none_submitted(client, db_session, as_user):
    as_user("registered_user")
    response = await client.get("/auth/me/data-export")
    assert response.status_code == 200, response.text
    assert response.json()["listing_reports"] == []


# ---------------------------------------------------------------------------
# POST /auth/me/data-deletion, GET /auth/me/data-deletion
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_deletion_request_requires_auth(client, db_session, as_anonymous):
    response = await client.post("/auth/me/data-deletion", json={})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_create_deletion_request_returns_pending_with_data_scope(client, db_session, as_user):
    brand = await create_brand(db_session)
    await db_session.commit()

    user_sub = str(uuid.uuid4())
    await create_follow(db_session, user_id=user_sub, brand_id=brand.id)
    await create_listing_report(db_session, brand_id=brand.id, reporter_user_id=user_sub)
    await db_session.commit()

    as_user("registered_user", sub=user_sub)
    response = await client.post("/auth/me/data-deletion", json={"reason": "no longer using the app"})

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "pending_review"
    assert body["reason"] == "no longer using the app"
    assert body["data_scope"]["follows"] == 1
    assert body["data_scope"]["owner_account"] == 0
    assert body["data_scope"]["listing_reports"] == 1


@pytest.mark.asyncio
async def test_second_pending_deletion_request_is_conflict(client, db_session, as_user):
    user_sub = str(uuid.uuid4())
    as_user("registered_user", sub=user_sub)

    first = await client.post("/auth/me/data-deletion", json={})
    assert first.status_code == 201

    second = await client.post("/auth/me/data-deletion", json={})
    assert second.status_code == 409
    assert second.json()["code"] == "deletion_already_pending"


@pytest.mark.asyncio
async def test_list_my_deletion_requests_returns_only_my_own(client, db_session, as_user):
    my_sub = str(uuid.uuid4())
    other_sub = str(uuid.uuid4())
    await create_deletion_request(db_session, requester_user_id=my_sub)
    await create_deletion_request(db_session, requester_user_id=other_sub)
    await db_session.commit()

    as_user("registered_user", sub=my_sub)
    response = await client.get("/auth/me/data-deletion")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    assert body["results"][0]["requester_role"] == "registered_user"


# ---------------------------------------------------------------------------
# GET /data-deletion/{id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_requester_can_view_own_request_but_not_someone_elses(client, db_session, as_user):
    my_sub = str(uuid.uuid4())
    other_sub = str(uuid.uuid4())
    mine = await create_deletion_request(db_session, requester_user_id=my_sub)
    theirs = await create_deletion_request(db_session, requester_user_id=other_sub)
    await db_session.commit()

    as_user("registered_user", sub=my_sub)
    ok = await client.get(f"/data-deletion/{mine.id}")
    assert ok.status_code == 200

    forbidden = await client.get(f"/data-deletion/{theirs.id}")
    assert forbidden.status_code == 403


@pytest.mark.asyncio
async def test_admin_can_view_any_request(client, db_session, as_user):
    request = await create_deletion_request(db_session, requester_user_id=str(uuid.uuid4()))
    await db_session.commit()

    as_user("admin")
    response = await client.get(f"/data-deletion/{request.id}")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_unknown_request_returns_404(client, db_session, as_user):
    as_user("admin")
    response = await client.get("/data-deletion/999999")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# POST /data-deletion/{id}/approve, /reject — role gate
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_non_admin_cannot_approve_or_reject(client, db_session, as_user):
    request = await create_deletion_request(db_session, requester_user_id=str(uuid.uuid4()))
    await db_session.commit()

    as_user("owner")
    approve = await client.post(f"/data-deletion/{request.id}/approve", json={})
    assert approve.status_code == 403

    reject = await client.post(f"/data-deletion/{request.id}/reject", json={"reviewer_notes": "no"})
    assert reject.status_code == 403


# ---------------------------------------------------------------------------
# POST /data-deletion/{id}/approve — actual execution
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_approve_hard_deletes_follows_and_redacts_manager_and_claim_rows(client, db_session, as_user):
    brand = await create_brand(db_session)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    user_sub = str(uuid.uuid4())
    await create_follow(db_session, user_id=user_sub, brand_id=brand.id)
    manager_row = await create_location_manager(
        db_session, user_id=user_sub, location_id=location.id, is_active=True
    )
    claim_row = await create_claim(
        db_session,
        claimant_user_id=user_sub,
        brand_id=brand.id,
        status="approved",
        submitted_at=submitted_recently(),
    )
    request = await create_deletion_request(db_session, requester_user_id=user_sub, requester_role="registered_user")
    await db_session.commit()

    as_user("admin")
    response = await client.post(
        f"/data-deletion/{request.id}/approve", json={"reviewer_notes": "verified, executing"}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "completed"
    assert body["completed_at"] is not None

    # user_follow: hard-deleted.
    remaining_follows = (
        await db_session.execute(select(UserFollow).where(UserFollow.user_id == user_sub))
    ).scalars().all()
    assert remaining_follows == []

    # location_manager: redacted + deactivated, not deleted.
    await db_session.refresh(manager_row)
    assert manager_row.user_id == "deleted-user"
    assert manager_row.is_active is False
    assert manager_row.revoked_at is not None

    # claim_request: redacted, row retained.
    await db_session.refresh(claim_row)
    assert claim_row.claimant_user_id == "deleted-user"
    assert claim_row.status == "approved"  # outcome itself is untouched

    # audit_log gained an entry for the location_manager redaction (on
    # root CLAUDE.md's audit-required table list) but NOT for user_follow
    # or claim_request (neither is on that list).
    audit_rows = (
        await db_session.execute(
            select(AuditLog).where(AuditLog.table_name == "location_manager", AuditLog.record_id == manager_row.id)
        )
    ).scalars().all()
    assert len(audit_rows) == 1
    assert audit_rows[0].action == "update"
    assert audit_rows[0].actor_role == "admin"


@pytest.mark.asyncio
async def test_approve_redacts_listing_report_email_but_keeps_row_and_content(client, db_session, as_user):
    """Only `reporter_email` is nulled — `reporter_user_id`, `category`,
    `details`, and `status` are left exactly as submitted (see
    docs/DECISIONS.md "CCPA data export/deletion" amendment 2026-09-22).
    """
    brand = await create_brand(db_session)
    await db_session.commit()

    user_sub = str(uuid.uuid4())
    report = await create_listing_report(
        db_session,
        brand_id=brand.id,
        reporter_user_id=user_sub,
        reporter_email="reporter@example.com",
        category="permanently_closed",
        details="This location shut down last month.",
        status="new",
    )
    request = await create_deletion_request(db_session, requester_user_id=user_sub, requester_role="registered_user")
    await db_session.commit()

    as_user("admin")
    response = await client.post(f"/data-deletion/{request.id}/approve", json={})
    assert response.status_code == 200, response.text

    await db_session.refresh(report)
    assert report.reporter_email is None
    assert report.reporter_user_id == user_sub
    assert report.category == "permanently_closed"
    assert report.details == "This location shut down last month."
    assert report.status == "new"

    # Not on the audit-required table list — same treatment as
    # claim_request's own redaction, no audit_log entry generated.
    audit_rows = (
        await db_session.execute(
            select(AuditLog).where(AuditLog.table_name == "listing_report", AuditLog.record_id == report.id)
        )
    ).scalars().all()
    assert audit_rows == []


@pytest.mark.asyncio
async def test_approve_does_not_touch_another_users_listing_report(client, db_session, as_user):
    brand = await create_brand(db_session)
    await db_session.commit()

    user_sub = str(uuid.uuid4())
    other_sub = str(uuid.uuid4())
    others_report = await create_listing_report(
        db_session, brand_id=brand.id, reporter_user_id=other_sub, reporter_email="other@example.com"
    )
    request = await create_deletion_request(db_session, requester_user_id=user_sub, requester_role="registered_user")
    await db_session.commit()

    as_user("admin")
    response = await client.post(f"/data-deletion/{request.id}/approve", json={})
    assert response.status_code == 200, response.text

    await db_session.refresh(others_report)
    assert others_report.reporter_email == "other@example.com"


@pytest.mark.asyncio
async def test_approve_anonymizes_owner_account_without_hard_deleting_it(client, db_session, as_user):
    owner = await create_owner(db_session, full_name="Priya Rao", phone="+14695551234")
    original_email = owner.email
    original_cognito_sub = owner.cognito_sub
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    await db_session.commit()

    request = await create_deletion_request(
        db_session, requester_user_id=owner.cognito_sub, requester_role="owner"
    )
    await db_session.commit()

    as_user("admin")
    response = await client.post(f"/data-deletion/{request.id}/approve", json={})
    assert response.status_code == 200, response.text

    await db_session.refresh(owner)
    assert owner.full_name is None
    assert owner.phone is None
    assert owner.email != original_email
    assert owner.email.startswith("deleted-owner-")
    assert owner.personal_data_deleted_at is not None
    # cognito_sub is the live join key — left unredacted (see
    # app/models/owner_account.py docstring).
    assert owner.cognito_sub == original_cognito_sub

    # Brand ownership is NOT touched — the restaurant business record is
    # not the owner's personal data (see docs/DECISIONS.md).
    await db_session.refresh(brand)
    assert brand.owner_id == owner.id
    assert brand.is_claimed is True

    audit_rows = (
        await db_session.execute(
            select(AuditLog).where(AuditLog.table_name == "owner_account", AuditLog.record_id == owner.id)
        )
    ).scalars().all()
    assert len(audit_rows) == 1


@pytest.mark.asyncio
async def test_approve_does_not_touch_audit_log_actor_entries(client, db_session, as_user):
    """audit_log rows where this identity is the *actor* of a past write
    are retained for legitimate business/legal record-keeping, per
    docs/DECISIONS.md "CCPA data export/deletion" — a data-deletion
    request never edits or removes them.
    """
    user_sub = str(uuid.uuid4())
    db_session.add(
        AuditLog(
            table_name="restaurant_brand",
            record_id=1,
            action="update",
            actor_id=user_sub,
            actor_role="owner",
            old_val={"name": "Old"},
            new_val={"name": "New"},
        )
    )
    request = await create_deletion_request(db_session, requester_user_id=user_sub)
    await db_session.commit()

    as_user("admin")
    response = await client.post(f"/data-deletion/{request.id}/approve", json={})
    assert response.status_code == 200, response.text

    rows = (
        await db_session.execute(select(AuditLog).where(AuditLog.actor_id == user_sub))
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].old_val == {"name": "Old"}


@pytest.mark.asyncio
async def test_approve_is_blocked_by_a_pending_claim_under_the_same_identity(client, db_session, as_user):
    brand = await create_brand(db_session, is_claimed=False, owner_id=None)
    await db_session.commit()

    user_sub = str(uuid.uuid4())
    await create_claim(
        db_session,
        claimant_user_id=user_sub,
        brand_id=brand.id,
        status="pending_review",
        submitted_at=submitted_recently(),
    )
    request = await create_deletion_request(db_session, requester_user_id=user_sub)
    await db_session.commit()

    as_user("admin")
    response = await client.post(f"/data-deletion/{request.id}/approve", json={})
    assert response.status_code == 409
    assert response.json()["code"] == "pending_claim_blocks_deletion"

    # Request must stay pending_review — approval did not partially apply.
    still_pending = await client.get(f"/data-deletion/{request.id}")
    assert still_pending.json()["status"] == "pending_review"

    row = (
        await db_session.execute(select(ClaimRequest).where(ClaimRequest.claimant_user_id == user_sub))
    ).scalar_one()
    assert row.claimant_user_id == user_sub  # untouched


@pytest.mark.asyncio
async def test_approve_on_already_resolved_request_is_conflict(client, db_session, as_user):
    request = await create_deletion_request(
        db_session, requester_user_id=str(uuid.uuid4()), status="rejected"
    )
    await db_session.commit()

    as_user("admin")
    response = await client.post(f"/data-deletion/{request.id}/approve", json={})
    assert response.status_code == 409
    assert response.json()["code"] == "request_not_pending"


# ---------------------------------------------------------------------------
# POST /data-deletion/{id}/reject
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reject_leaves_all_data_untouched(client, db_session, as_user):
    brand = await create_brand(db_session)
    await db_session.commit()

    user_sub = str(uuid.uuid4())
    await create_follow(db_session, user_id=user_sub, brand_id=brand.id)
    request = await create_deletion_request(db_session, requester_user_id=user_sub)
    await db_session.commit()

    as_user("admin")
    response = await client.post(
        f"/data-deletion/{request.id}/reject",
        json={"reviewer_notes": "Active fraud investigation — legal hold."},
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "rejected"

    remaining_follows = (
        await db_session.execute(select(UserFollow).where(UserFollow.user_id == user_sub))
    ).scalars().all()
    assert len(remaining_follows) == 1


@pytest.mark.asyncio
async def test_reject_requires_reviewer_notes(client, db_session, as_user):
    request = await create_deletion_request(db_session, requester_user_id=str(uuid.uuid4()))
    await db_session.commit()

    as_user("admin")
    response = await client.post(f"/data-deletion/{request.id}/reject", json={})
    assert response.status_code == 422
