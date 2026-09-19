"""Integration test: claim flow — submit, admin approve, admin reject.

DECISIONS.md "Claim flow: Google Business Profile match OR phone
verification, admin-reviewed, 2-business-day SLA" and
docs/API_CONTRACTS.md "Claim flow (/claim)". Runs against the real
FastAPI app + router + service layer + a real (SQLite, this sandbox) DB —
see tests/integration/conftest.py for why SQLite is fine here (no PostGIS
function is touched by any claim-flow code path).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.owner_account import OwnerAccount
from factories import create_brand, create_claim, create_location, create_owner


@pytest.mark.asyncio
async def test_claim_submit_then_admin_approve(client, db_session, as_user):
    brand = await create_brand(db_session, is_claimed=False, owner_id=None)
    await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    claimant_sub = str(uuid.uuid4())
    claimant_email = f"{uuid.uuid4().hex[:8]}@example.com"
    as_user("registered_user", sub=claimant_sub, email=claimant_email)

    submit_resp = await client.post(
        "/claim",
        json={
            "brand_id": brand.id,
            "proof_method": "google_business_profile",
            "google_business_profile_url": "https://business.google.com/test-listing",
        },
    )
    assert submit_resp.status_code == 201, submit_resp.text
    claim_body = submit_resp.json()
    assert claim_body["status"] == "pending_review"
    assert claim_body["brand_id"] == brand.id
    claim_id = claim_body["claim_id"]

    # Claim submission eagerly resolves/creates the claimant's owner_account
    # (see app/services/claim_service.py module docstring judgment call).
    owner_row = (
        await db_session.execute(select(OwnerAccount).where(OwnerAccount.cognito_sub == claimant_sub))
    ).scalar_one()
    assert owner_row.email == claimant_email

    # Admin approves.
    as_user("admin")
    approve_resp = await client.post(f"/claim/{claim_id}/approve", json={"reviewer_notes": "GBP matched"})
    assert approve_resp.status_code == 200, approve_resp.text
    assert approve_resp.json()["status"] == "approved"
    # Cognito call is stubbed to a no-op by tests/integration/conftest.py.
    assert approve_resp.json()["owner_group_granted"] is True

    await db_session.refresh(brand)
    assert brand.owner_id == owner_row.id
    assert brand.is_claimed is True
    assert brand.claimed_at is not None


@pytest.mark.asyncio
async def test_claim_submit_then_admin_reject(client, db_session, as_user):
    brand = await create_brand(db_session, is_claimed=False, owner_id=None)
    await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    claimant_sub = str(uuid.uuid4())
    as_user("registered_user", sub=claimant_sub, email=f"{uuid.uuid4().hex[:8]}@example.com")

    submit_resp = await client.post(
        "/claim",
        json={
            "brand_id": brand.id,
            "proof_method": "google_business_profile",
            "google_business_profile_url": "https://business.google.com/test-listing-2",
        },
    )
    assert submit_resp.status_code == 201
    claim_id = submit_resp.json()["claim_id"]

    as_user("admin")
    reject_resp = await client.post(
        f"/claim/{claim_id}/reject",
        json={"reviewer_notes": "Document did not match listing address."},
    )
    assert reject_resp.status_code == 200, reject_resp.text
    assert reject_resp.json()["status"] == "rejected"

    await db_session.refresh(brand)
    # Rejected claim must NOT attach ownership — brand stays unclaimed.
    assert brand.owner_id is None
    assert brand.is_claimed is False


@pytest.mark.asyncio
async def test_second_pending_claim_for_same_brand_is_conflict(client, db_session, as_user):
    """docs/API_CONTRACTS.md: "At most one pending_review claim can exist
    per brand at a time ... a second POST /claim for the same brand_id
    while one is already pending should return 409 Conflict."
    """
    brand = await create_brand(db_session, is_claimed=False, owner_id=None)
    await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    as_user("registered_user", sub=str(uuid.uuid4()))
    first = await client.post(
        "/claim",
        json={
            "brand_id": brand.id,
            "proof_method": "google_business_profile",
            "google_business_profile_url": "https://business.google.com/first",
        },
    )
    assert first.status_code == 201

    # A different claimant tries to claim the same still-pending brand.
    as_user("registered_user", sub=str(uuid.uuid4()))
    second = await client.post(
        "/claim",
        json={
            "brand_id": brand.id,
            "proof_method": "google_business_profile",
            "google_business_profile_url": "https://business.google.com/second",
        },
    )
    assert second.status_code == 409
    assert second.json()["code"] == "conflict" or "already pending" in second.json()["detail"]


@pytest.mark.asyncio
async def test_claimant_can_view_own_claim_but_not_someone_elses(client, db_session, as_user):
    brand_a = await create_brand(db_session, is_claimed=False, owner_id=None)
    brand_b = await create_brand(db_session, is_claimed=False, owner_id=None)
    await create_location(db_session, brand_id=brand_a.id)
    await create_location(db_session, brand_id=brand_b.id)
    await db_session.commit()

    claimant_a_sub = str(uuid.uuid4())
    as_user("registered_user", sub=claimant_a_sub)
    resp_a = await client.post(
        "/claim",
        json={
            "brand_id": brand_a.id,
            "proof_method": "google_business_profile",
            "google_business_profile_url": "https://business.google.com/a",
        },
    )
    claim_a_id = resp_a.json()["claim_id"]

    claimant_b_sub = str(uuid.uuid4())
    as_user("registered_user", sub=claimant_b_sub)
    resp_b = await client.post(
        "/claim",
        json={
            "brand_id": brand_b.id,
            "proof_method": "google_business_profile",
            "google_business_profile_url": "https://business.google.com/b",
        },
    )
    assert resp_b.status_code == 201

    # Claimant B tries to view claimant A's claim -> 403.
    forbidden = await client.get(f"/claim/{claim_a_id}")
    assert forbidden.status_code == 403

    # Claimant A can view their own claim.
    as_user("registered_user", sub=claimant_a_sub)
    ok = await client.get(f"/claim/{claim_a_id}")
    assert ok.status_code == 200
    assert ok.json()["claim_id"] == claim_a_id


@pytest.mark.asyncio
async def test_phone_verification_requires_location_id_for_multi_location_brand(client, db_session, as_user):
    """docs/API_CONTRACTS.md: location_id is "required in practice when
    proof_method = phone_verification and the brand has more than one
    location."
    """
    brand = await create_brand(db_session, is_claimed=False, owner_id=None)
    await create_location(db_session, brand_id=brand.id, phone="+14695551111")
    await create_location(db_session, brand_id=brand.id, phone="+14695552222")
    await db_session.commit()

    as_user("registered_user", sub=str(uuid.uuid4()))
    resp = await client.post(
        "/claim",
        json={"brand_id": brand.id, "proof_method": "phone_verification"},
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "location_required"


# ---------------------------------------------------------------------------
# GET /claim — admin claims queue
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_list_claims_requires_auth(client, as_anonymous):
    resp = await client.get("/claim")
    assert resp.status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["registered_user", "owner", "manager"])
async def test_list_claims_forbidden_for_non_admin(client, as_user, role):
    as_user(role)
    resp = await client.get("/claim")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_admin_list_claims_defaults_to_pending_newest_first_with_joins(client, db_session, as_user):
    now = datetime.now(timezone.utc)
    owner = await create_owner(db_session)
    brand_a = await create_brand(db_session, is_claimed=False, owner_id=None)
    brand_b = await create_brand(db_session, is_claimed=False, owner_id=None)
    brand_c = await create_brand(db_session, is_claimed=False, owner_id=None)
    location = await create_location(db_session, brand_id=brand_a.id)
    older = await create_claim(
        db_session,
        brand_id=brand_a.id,
        location_id=location.id,
        claimant_user_id=owner.cognito_sub,
        submitted_at=now - timedelta(days=2),
    )
    newer = await create_claim(
        db_session,
        brand_id=brand_b.id,
        claimant_user_id=str(uuid.uuid4()),  # no owner_account row
        proof_method="document_upload",
        google_business_profile_url=None,
        supporting_document_key="claims/abc/proof.pdf",
        submitted_at=now - timedelta(hours=1),
    )
    approved = await create_claim(
        db_session, brand_id=brand_c.id, status="approved", submitted_at=now - timedelta(days=5)
    )
    await db_session.commit()

    as_user("admin")
    resp = await client.get("/claim")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 2
    assert (body["page"], body["page_size"]) == (1, 20)
    assert [r["claim_id"] for r in body["results"]] == [newer.id, older.id]

    newer_out, older_out = body["results"]
    assert newer_out["brand_name"] == brand_b.name
    assert newer_out["brand_slug"] == brand_b.slug
    assert newer_out["claimant_email"] is None
    assert newer_out["location_address"] is None
    assert newer_out["proof_method"] == "document_upload"
    assert newer_out["supporting_document_url"] == "claims/abc/proof.pdf"
    assert newer_out["status"] == "pending_review"
    assert newer_out["sla_due_at"] is not None

    assert older_out["claimant_email"] == owner.email
    assert location.address_line1 in older_out["location_address"]
    assert older_out["google_business_profile_url"]

    approved_resp = await client.get("/claim", params={"status": "approved"})
    assert [r["claim_id"] for r in approved_resp.json()["results"]] == [approved.id]


@pytest.mark.asyncio
async def test_admin_list_claims_pagination_and_bad_status(client, db_session, as_user):
    now = datetime.now(timezone.utc)
    for i in range(3):
        brand = await create_brand(db_session, is_claimed=False, owner_id=None)
        await create_claim(db_session, brand_id=brand.id, submitted_at=now - timedelta(hours=i))
    await db_session.commit()

    as_user("admin")
    page2 = await client.get("/claim", params={"page": 2, "page_size": 2})
    assert page2.status_code == 200
    assert page2.json()["total"] == 3
    assert len(page2.json()["results"]) == 1

    assert (await client.get("/claim", params={"status": "bogus"})).status_code == 422
    assert (await client.get("/claim", params={"page_size": 101})).status_code == 422
