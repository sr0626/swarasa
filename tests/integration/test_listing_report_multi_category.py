"""Integration test: multi-select report categories (migration 0023) —
docs/API_CONTRACTS.md "Listing reports (/reports)" `categories`.

Same harness as test_listing_report.py (real FastAPI app + SQLite).
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

import app.main as app_main
from app.dependencies.auth import CurrentUser, get_current_user_optional
from app.models.listing_report import ListingReport
from factories import create_brand, create_listing_report

EVERY_CATEGORY = [
    "address_incorrect",
    "hours_incorrect",
    "phone_incorrect",
    "price_incorrect",
    "menu_incorrect",
    "deal_incorrect",
    "permanently_closed",
    "other",
]


async def _report_count(db_session) -> int:
    return (await db_session.execute(select(func.count()).select_from(ListingReport))).scalar_one()


def _as_optional_user() -> CurrentUser:
    user = CurrentUser(
        cognito_sub=str(uuid.uuid4()),
        email=f"{uuid.uuid4().hex[:8]}@example.com",
        role="registered_user",
    )

    async def _override():
        return user

    app_main.app.dependency_overrides[get_current_user_optional] = _override
    return user


@pytest.mark.asyncio
async def test_multi_select_stores_canonical_order_with_primary_first(
    client, db_session, as_anonymous
):
    brand = await create_brand(db_session)
    await db_session.commit()

    resp = await client.post(
        "/reports",
        json={
            "brand_id": brand.id,
            # Deliberately out of canonical order; "other" is ticked first.
            "categories": ["other", "hours_incorrect", "address_incorrect"],
            "details": "Several things are off.",
        },
    )
    assert resp.status_code == 201, resp.text

    row = (await db_session.execute(select(ListingReport))).scalar_one()
    assert row.categories == ["address_incorrect", "hours_incorrect", "other"]
    # `category` keeps the primary (first in canonical order) so existing
    # queries/exports/indexes keep working.
    assert row.category == "address_incorrect"
    assert row.all_categories == ["address_incorrect", "hours_incorrect", "other"]


@pytest.mark.asyncio
async def test_multi_select_is_deduplicated(client, db_session, as_anonymous):
    brand = await create_brand(db_session)
    await db_session.commit()

    resp = await client.post(
        "/reports",
        json={
            "brand_id": brand.id,
            "categories": ["menu_incorrect", "menu_incorrect", "price_incorrect", "menu_incorrect"],
            "details": "Menu and prices.",
        },
    )
    assert resp.status_code == 201, resp.text
    row = (await db_session.execute(select(ListingReport))).scalar_one()
    assert row.categories == ["price_incorrect", "menu_incorrect"]
    assert row.category == "price_incorrect"


@pytest.mark.asyncio
async def test_all_eight_accepted_empty_nine_unknown_and_missing_rejected(
    client, db_session, as_anonymous
):
    brand = await create_brand(db_session)
    await db_session.commit()

    ok = await client.post(
        "/reports",
        json={"brand_id": brand.id, "categories": EVERY_CATEGORY, "details": "Everything."},
    )
    assert ok.status_code == 201, ok.text
    assert await _report_count(db_session) == 1

    empty = await client.post(
        "/reports", json={"brand_id": brand.id, "categories": [], "details": "None."}
    )
    assert empty.status_code == 422
    nine = await client.post(
        "/reports",
        json={
            "brand_id": brand.id,
            "categories": EVERY_CATEGORY + ["other"],
            "details": "Too many.",
        },
    )
    assert nine.status_code == 422
    bad = await client.post(
        "/reports",
        json={"brand_id": brand.id, "categories": ["other", "nope"], "details": "Bad."},
    )
    assert bad.status_code == 422
    neither = await client.post("/reports", json={"brand_id": brand.id, "details": "None."})
    assert neither.status_code == 422
    assert await _report_count(db_session) == 1


@pytest.mark.asyncio
async def test_legacy_single_category_still_works(client, db_session, as_anonymous):
    brand = await create_brand(db_session)
    await db_session.commit()

    resp = await client.post(
        "/reports",
        json={"brand_id": brand.id, "category": "phone_incorrect", "details": "Old client."},
    )
    assert resp.status_code == 201, resp.text
    row = (await db_session.execute(select(ListingReport))).scalar_one()
    assert row.category == "phone_incorrect"
    assert row.categories == ["phone_incorrect"]


@pytest.mark.asyncio
async def test_categories_wins_when_it_disagrees_with_category(client, db_session, as_anonymous):
    brand = await create_brand(db_session)
    await db_session.commit()

    resp = await client.post(
        "/reports",
        json={
            "brand_id": brand.id,
            "category": "other",
            "categories": ["hours_incorrect", "deal_incorrect"],
            "details": "Both sent.",
        },
    )
    assert resp.status_code == 201, resp.text
    row = (await db_session.execute(select(ListingReport))).scalar_one()
    assert row.category == "hours_incorrect"
    assert row.categories == ["hours_incorrect", "deal_incorrect"]


@pytest.mark.asyncio
async def test_admin_list_returns_all_categories_and_filter_matches_secondary(
    client, db_session, as_user
):
    brand = await create_brand(db_session)
    multi = await create_listing_report(
        db_session,
        brand_id=brand.id,
        category="address_incorrect",
        categories=["address_incorrect", "deal_incorrect"],
    )
    # Legacy row: categories NULL.
    legacy = await create_listing_report(
        db_session, brand_id=brand.id, category="deal_incorrect", categories=None
    )
    other_only = await create_listing_report(
        db_session, brand_id=brand.id, category="other", categories=["other"]
    )
    await db_session.commit()

    as_user("admin")
    listed = await client.get("/reports")
    assert listed.status_code == 200, listed.text
    by_id = {r["report_id"]: r for r in listed.json()["results"]}
    assert by_id[multi.id]["category"] == "address_incorrect"
    assert by_id[multi.id]["categories"] == ["address_incorrect", "deal_incorrect"]
    # Legacy row falls back to [category].
    assert by_id[legacy.id]["categories"] == ["deal_incorrect"]
    assert by_id[other_only.id]["categories"] == ["other"]

    # A filter on the SECONDARY category matches the multi-select report and
    # the legacy row whose primary is that category.
    deal = await client.get("/reports", params={"category": "deal_incorrect"})
    assert deal.status_code == 200, deal.text
    body = deal.json()
    assert {r["report_id"] for r in body["results"]} == {multi.id, legacy.id}
    assert body["total"] == 2

    address = await client.get("/reports", params={"category": "address_incorrect"})
    assert {r["report_id"] for r in address.json()["results"]} == {multi.id}
    other = await client.get("/reports", params={"category": "other"})
    assert {r["report_id"] for r in other.json()["results"]} == {other_only.id}

    none = await client.get(
        "/reports", params={"category": "deal_incorrect", "status": "resolved"}
    )
    assert none.json()["total"] == 0
    bad = await client.get("/reports", params={"category": "nope"})
    assert bad.status_code == 422


@pytest.mark.asyncio
async def test_multi_category_report_counts_once_in_queue_totals(client, db_session, as_user):
    brand = await create_brand(db_session)
    await create_listing_report(
        db_session,
        brand_id=brand.id,
        category="hours_incorrect",
        categories=["hours_incorrect", "phone_incorrect", "other"],
    )
    await db_session.commit()

    as_user("admin")
    notes = (await client.get("/admin/notifications")).json()["reports"]
    assert notes["count"] == 1
    assert notes["items"][0]["categories"] == ["hours_incorrect", "phone_incorrect", "other"]
    assert (await client.get("/reports")).json()["total"] == 1


@pytest.mark.asyncio
async def test_ccpa_export_includes_all_categories(client, db_session, as_user):
    brand = await create_brand(db_session)
    reporter = _as_optional_user()
    await db_session.commit()

    resp = await client.post(
        "/reports",
        json={
            "brand_id": brand.id,
            "categories": ["menu_incorrect", "price_incorrect"],
            "details": "Menu prices are old.",
        },
    )
    assert resp.status_code == 201, resp.text

    app_main.app.dependency_overrides.pop(get_current_user_optional, None)
    as_user("registered_user", sub=reporter.cognito_sub, email=reporter.email)
    export = await client.get("/auth/me/data-export")
    assert export.status_code == 200, export.text
    exported = export.json()["listing_reports"]
    assert [r["categories"] for r in exported] == [["price_incorrect", "menu_incorrect"]]
    assert exported[0]["category"] == "price_incorrect"
