"""Integration test: public "report a problem" flow — POST /reports (public),
GET /reports and PATCH /reports/{id} (admin only).

docs/API_CONTRACTS.md "Listing reports (/reports)". Same harness as
test_claim_flow.py: real FastAPI app + router + service + SQLite.

`POST /reports` is optional-auth (`get_current_user_optional`), which the
shared `as_user` fixture does NOT override (it overrides only
`get_current_user`), so the signed-in case installs its own override here.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

import app.main as app_main
from app.dependencies.auth import CurrentUser, get_current_user_optional
from app.models.listing_report import ListingReport
from factories import create_brand, create_listing_report, create_location


async def _report_count(db_session) -> int:
    return (await db_session.execute(select(func.count()).select_from(ListingReport))).scalar_one()


def _as_optional_user(role: str = "registered_user") -> CurrentUser:
    user = CurrentUser(
        cognito_sub=str(uuid.uuid4()),
        email=f"{uuid.uuid4().hex[:8]}@example.com",
        role=role,
    )

    async def _override():
        return user

    app_main.app.dependency_overrides[get_current_user_optional] = _override
    return user


# ---------------------------------------------------------------------------
# POST /reports — public
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_anonymous_can_submit_report(client, db_session, as_anonymous):
    brand = await create_brand(db_session)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    resp = await client.post(
        "/reports",
        json={
            "brand_id": brand.id,
            "location_id": location.id,
            "category": "address_incorrect",
            "details": "  The restaurant moved across the street.  ",
            "reporter_email": "visitor@example.com",
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json() == {"status": "received"}

    row = (await db_session.execute(select(ListingReport))).scalar_one()
    assert row.brand_id == brand.id
    assert row.location_id == location.id
    assert row.category == "address_incorrect"
    assert row.details == "The restaurant moved across the street."
    assert row.reporter_email == "visitor@example.com"
    assert row.reporter_user_id is None
    assert row.status == "new"
    assert row.submitted_at is not None


@pytest.mark.asyncio
async def test_signed_in_submission_records_reporter_user_id(client, db_session):
    brand = await create_brand(db_session)
    await db_session.commit()
    user = _as_optional_user()

    resp = await client.post(
        "/reports",
        json={"brand_id": brand.id, "category": "hours_incorrect", "details": "Closed Mondays now."},
    )
    assert resp.status_code == 201, resp.text

    row = (await db_session.execute(select(ListingReport))).scalar_one()
    assert row.reporter_user_id == user.cognito_sub
    assert row.location_id is None
    # Signed in: the email is the verified token's email, not the body's.
    assert row.reporter_email == user.email


@pytest.mark.asyncio
async def test_signed_in_body_email_is_ignored_token_email_wins(client, db_session):
    """A client cannot attribute a report to another address: for an
    authenticated caller the server discards the body's `reporter_email`."""
    brand = await create_brand(db_session)
    await db_session.commit()
    user = _as_optional_user()

    resp = await client.post(
        "/reports",
        json={
            "brand_id": brand.id,
            "category": "other",
            "details": "Spoof attempt.",
            "reporter_email": "victim@example.com",
        },
    )
    assert resp.status_code == 201, resp.text

    row = (await db_session.execute(select(ListingReport))).scalar_one()
    assert row.reporter_email == user.email
    assert row.reporter_email != "victim@example.com"
    assert row.reporter_user_id == user.cognito_sub


@pytest.mark.asyncio
async def test_signed_in_token_without_email_stores_null_not_body_email(client, db_session):
    brand = await create_brand(db_session)
    await db_session.commit()
    user = _as_optional_user()
    user.email = None

    resp = await client.post(
        "/reports",
        json={
            "brand_id": brand.id,
            "category": "other",
            "details": "No email claim on token.",
            "reporter_email": "victim@example.com",
        },
    )
    assert resp.status_code == 201, resp.text

    row = (await db_session.execute(select(ListingReport))).scalar_one()
    assert row.reporter_email is None
    assert row.reporter_user_id == user.cognito_sub


@pytest.mark.asyncio
async def test_deal_incorrect_category_is_accepted_and_stored(client, db_session, as_anonymous):
    brand = await create_brand(db_session)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()

    resp = await client.post(
        "/reports",
        json={
            "brand_id": brand.id,
            "location_id": location.id,
            "category": "deal_incorrect",
            "details": "The BOGO deal ended last week.",
        },
    )
    assert resp.status_code == 201, resp.text

    row = (await db_session.execute(select(ListingReport))).scalar_one()
    assert row.category == "deal_incorrect"
    assert row.location_id == location.id


@pytest.mark.asyncio
async def test_admin_list_returns_deal_incorrect_and_ccpa_export_finds_it(
    client, db_session, as_user
):
    brand = await create_brand(db_session)
    reporter = _as_optional_user()
    await db_session.commit()

    resp = await client.post(
        "/reports",
        json={"brand_id": brand.id, "category": "deal_incorrect", "details": "Deal is stale."},
    )
    assert resp.status_code == 201, resp.text

    # Admin inbox returns the new category (with the token-derived email).
    app_main.app.dependency_overrides.pop(get_current_user_optional, None)
    as_user("admin")
    listed = await client.get("/reports", params={"status": "new"})
    assert listed.status_code == 200, listed.text
    results = listed.json()["results"]
    assert [r["category"] for r in results] == ["deal_incorrect"]
    assert results[0]["reporter_email"] == reporter.email
    assert results[0]["reporter_user_id"] == reporter.cognito_sub

    # Attribution by Cognito sub (what CCPA export/erasure key on) is
    # intact: the reporter's own data export finds the new-category row.
    as_user("registered_user", sub=reporter.cognito_sub, email=reporter.email)
    export = await client.get("/auth/me/data-export")
    assert export.status_code == 200, export.text
    exported = export.json()["listing_reports"]
    assert [r["category"] for r in exported] == ["deal_incorrect"]
    assert exported[0]["reporter_email"] == reporter.email


@pytest.mark.asyncio
async def test_honeypot_returns_success_but_stores_nothing(client, db_session, as_anonymous):
    brand = await create_brand(db_session)
    await db_session.commit()

    resp = await client.post(
        "/reports",
        json={
            "brand_id": brand.id,
            "category": "other",
            "details": "Buy cheap watches",
            "website": "http://spam.example.com",
        },
    )
    assert resp.status_code == 201
    assert resp.json() == {"status": "received"}
    assert await _report_count(db_session) == 0


@pytest.mark.asyncio
async def test_empty_honeypot_is_stored_normally(client, db_session, as_anonymous):
    brand = await create_brand(db_session)
    await db_session.commit()

    resp = await client.post(
        "/reports",
        json={"brand_id": brand.id, "category": "other", "details": "Menu link is broken.", "website": ""},
    )
    assert resp.status_code == 201
    assert await _report_count(db_session) == 1


@pytest.mark.asyncio
async def test_invalid_category_is_422(client, db_session, as_anonymous):
    brand = await create_brand(db_session)
    await db_session.commit()

    resp = await client.post(
        "/reports",
        json={"brand_id": brand.id, "category": "not_a_category", "details": "x"},
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "validation_error"
    assert await _report_count(db_session) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides",
    [
        {"details": ""},
        {"details": "   "},
        {"details": "x" * 2001},
        {"reporter_email": "not-an-email"},
        {"reporter_email": "a" * 250 + "@example.com"},
    ],
)
async def test_length_and_format_limits_are_422(client, db_session, as_anonymous, overrides):
    brand = await create_brand(db_session)
    await db_session.commit()

    body = {"brand_id": brand.id, "category": "other", "details": "Something is off."}
    body.update(overrides)
    resp = await client.post("/reports", json=body)
    assert resp.status_code == 422
    assert await _report_count(db_session) == 0


@pytest.mark.asyncio
async def test_details_at_max_length_is_accepted(client, db_session, as_anonymous):
    brand = await create_brand(db_session)
    await db_session.commit()

    resp = await client.post(
        "/reports", json={"brand_id": brand.id, "category": "other", "details": "x" * 2000}
    )
    assert resp.status_code == 201


@pytest.mark.asyncio
async def test_blank_email_is_treated_as_omitted(client, db_session, as_anonymous):
    brand = await create_brand(db_session)
    await db_session.commit()

    resp = await client.post(
        "/reports",
        json={"brand_id": brand.id, "category": "other", "details": "Wrong.", "reporter_email": ""},
    )
    assert resp.status_code == 201
    row = (await db_session.execute(select(ListingReport))).scalar_one()
    assert row.reporter_email is None


@pytest.mark.asyncio
async def test_unknown_brand_is_404(client, db_session, as_anonymous):
    resp = await client.post(
        "/reports", json={"brand_id": 999999, "category": "other", "details": "Wrong."}
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "not_found"


@pytest.mark.asyncio
async def test_location_from_another_brand_is_400(client, db_session, as_anonymous):
    brand_a = await create_brand(db_session)
    brand_b = await create_brand(db_session)
    await create_location(db_session, brand_id=brand_a.id)
    loc_b = await create_location(db_session, brand_id=brand_b.id)
    await db_session.commit()

    resp = await client.post(
        "/reports",
        json={
            "brand_id": brand_a.id,
            "location_id": loc_b.id,
            "category": "address_incorrect",
            "details": "Wrong address.",
        },
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "invalid_location"
    assert await _report_count(db_session) == 0


@pytest.mark.asyncio
async def test_invalid_token_on_public_route_is_still_401(client, db_session):
    """A present-but-bad bearer token fails loudly (same as every other
    optional-auth route) rather than silently degrading to anonymous."""
    brand = await create_brand(db_session)
    await db_session.commit()

    resp = await client.post(
        "/reports",
        json={"brand_id": brand.id, "category": "other", "details": "Wrong."},
        headers={"Authorization": "Bearer not-a-real-jwt"},
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /reports — admin only
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_list_requires_auth(client, as_anonymous):
    resp = await client.get("/reports")
    assert resp.status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["registered_user", "owner", "manager"])
async def test_list_forbidden_for_non_admin(client, as_user, role):
    as_user(role)
    resp = await client.get("/reports")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_admin_list_status_filter_ordering_and_pagination(client, db_session, as_user):
    brand = await create_brand(db_session)
    location = await create_location(db_session, brand_id=brand.id)
    now = datetime.now(timezone.utc)
    newest_new = await create_listing_report(
        db_session, brand_id=brand.id, submitted_at=now - timedelta(hours=1)
    )
    oldest_new = await create_listing_report(
        db_session, brand_id=brand.id, location_id=location.id, submitted_at=now - timedelta(days=3)
    )
    resolved = await create_listing_report(
        db_session, brand_id=brand.id, status="resolved", submitted_at=now - timedelta(days=2)
    )
    await db_session.commit()

    as_user("admin")

    new_resp = await client.get("/reports", params={"status": "new"})
    assert new_resp.status_code == 200, new_resp.text
    body = new_resp.json()
    assert body["total"] == 2
    # 'new' queue is oldest-first.
    assert [r["report_id"] for r in body["results"]] == [oldest_new.id, newest_new.id]
    first = body["results"][0]
    assert first["brand_name"] == brand.name
    assert first["brand_slug"] == brand.slug
    assert location.address_line1 in first["location_address"]

    resolved_resp = await client.get("/reports", params={"status": "resolved"})
    assert [r["report_id"] for r in resolved_resp.json()["results"]] == [resolved.id]

    # No filter: everything, newest first.
    all_resp = await client.get("/reports")
    assert all_resp.json()["total"] == 3
    assert [r["report_id"] for r in all_resp.json()["results"]] == [
        newest_new.id,
        resolved.id,
        oldest_new.id,
    ]

    paged = await client.get("/reports", params={"page": 2, "page_size": 2})
    assert paged.json()["page"] == 2
    assert len(paged.json()["results"]) == 1

    bad = await client.get("/reports", params={"status": "bogus"})
    assert bad.status_code == 422


# ---------------------------------------------------------------------------
# PATCH /reports/{id} — admin only
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_patch_requires_auth(client, db_session, as_anonymous):
    brand = await create_brand(db_session)
    report = await create_listing_report(db_session, brand_id=brand.id)
    await db_session.commit()

    resp = await client.patch(f"/reports/{report.id}", json={"status": "resolved"})
    assert resp.status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["registered_user", "owner", "manager"])
async def test_patch_forbidden_for_non_admin(client, db_session, as_user, role):
    brand = await create_brand(db_session)
    report = await create_listing_report(db_session, brand_id=brand.id)
    await db_session.commit()

    as_user(role)
    resp = await client.patch(f"/reports/{report.id}", json={"status": "resolved"})
    assert resp.status_code == 403
    await db_session.refresh(report)
    assert report.status == "new"


@pytest.mark.asyncio
async def test_admin_resolve_then_reopen(client, db_session, as_user):
    brand = await create_brand(db_session)
    report = await create_listing_report(db_session, brand_id=brand.id)
    await db_session.commit()

    admin = as_user("admin")
    resp = await client.patch(
        f"/reports/{report.id}", json={"status": "resolved", "reviewer_notes": "Updated the address."}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "resolved"
    assert body["reviewer_notes"] == "Updated the address."
    assert body["reviewed_by"] == admin.cognito_sub
    assert body["reviewed_at"] is not None

    reopen = await client.patch(f"/reports/{report.id}", json={"status": "new"})
    assert reopen.status_code == 200
    assert reopen.json()["status"] == "new"
    assert reopen.json()["reviewed_by"] is None
    assert reopen.json()["reviewed_at"] is None
    # Notes are kept when the caller doesn't mention them.
    assert reopen.json()["reviewer_notes"] == "Updated the address."


@pytest.mark.asyncio
async def test_admin_dismiss_and_invalid_status(client, db_session, as_user):
    brand = await create_brand(db_session)
    report = await create_listing_report(db_session, brand_id=brand.id)
    await db_session.commit()

    as_user("admin")
    ok = await client.patch(f"/reports/{report.id}", json={"status": "dismissed"})
    assert ok.status_code == 200
    assert ok.json()["status"] == "dismissed"

    bad = await client.patch(f"/reports/{report.id}", json={"status": "approved"})
    assert bad.status_code == 422


@pytest.mark.asyncio
async def test_patch_unknown_report_is_404(client, as_user):
    as_user("admin")
    resp = await client.patch("/reports/999999", json={"status": "resolved"})
    assert resp.status_code == 404
    assert resp.json()["code"] == "not_found"
