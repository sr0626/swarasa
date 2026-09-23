"""Integration tests: `DELETE /restaurants/{id}` is now a SOFT delete
(`restaurant_brand.deleted_at`, migration 0011; docs/API_CONTRACTS.md
"DELETE /restaurants/{id}") that also deactivates the brand's locations,
plus `POST /restaurants/{id}/restore`.

Covers:
  - admin-only (403 owner / registered_user / manager, 401 anonymous), 404
    unknown id; no more 409 "locations attached" path.
  - brand keeps its row, `deleted_at` set; every `active` location becomes
    `owner_deactivated`; already-hidden locations (`coming_soon`,
    `closed_pending_reopen`) are left alone; audit_log rows for the brand
    and for EVERY location actually changed, actor = the admin.
  - idempotent (second delete: 204, no extra audit rows, deleted_at kept).
  - slug stays reserved.
  - hidden from every read path: brand detail (id + slug), brand locations
    list, location detail (anon/owner/manager 404, admin 200), follow +
    "my follows" (list AND total), owner console list, default admin list
    (`status=deleted` shows it), manager console, claim + report
    submission, admin overview counts.
  - owner/manager writes against a deleted brand 404.
  - restore: admin-only, clears `deleted_at`, locations stay deactivated,
    idempotent, brand + follow reappear.
  - bulk import refuses to reuse a soft-deleted brand's slug.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

import app.main as app_main
from app.dependencies.auth import get_current_user, get_current_user_optional
from app.models.audit_log import AuditLog
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.schemas.restaurant_bulk_import import RestaurantBasicDetailIn
from app.services.restaurant_bulk_import_service import bulk_import_restaurants
from factories import (
    create_brand,
    create_follow,
    create_location,
    create_location_manager,
    create_owner,
)


def _as_both(as_user, role, *, sub=None):
    """Public GET routes (`GET /locations/{id}`, `GET /restaurants/{id}/locations`)
    depend on `get_current_user_optional`, not the `get_current_user` the
    `as_user` fixture overrides — override both so the caller is really this user."""
    user = as_user(role, sub=sub)

    async def _override():
        return user

    app_main.app.dependency_overrides[get_current_user_optional] = _override
    return user


async def _brand_with_locations(db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Spice Route")
    active_a = await create_location(db_session, brand_id=brand.id, status="active")
    active_b = await create_location(db_session, brand_id=brand.id, status="active")
    coming = await create_location(db_session, brand_id=brand.id, status="coming_soon")
    closed = await create_location(db_session, brand_id=brand.id, status="closed_pending_reopen")
    await db_session.commit()
    return owner, brand, active_a, active_b, coming, closed


async def _audit_rows(db_session, table_name, record_id=None):
    stmt = select(AuditLog).where(AuditLog.table_name == table_name)
    if record_id is not None:
        stmt = stmt.where(AuditLog.record_id == record_id)
    return (await db_session.execute(stmt.order_by(AuditLog.id))).scalars().all()


async def _reload(db_session, model, pk):
    return (
        await db_session.execute(
            select(model).where(model.id == pk).execution_options(populate_existing=True)
        )
    ).scalar_one()


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["owner", "registered_user", "manager"])
async def test_non_admin_cannot_delete_or_restore(client, db_session, as_user, role):
    owner, brand, *_ = await _brand_with_locations(db_session)
    as_user(role, sub=owner.cognito_sub if role == "owner" else None)

    assert (await client.delete(f"/restaurants/{brand.id}")).status_code == 403
    assert (await client.post(f"/restaurants/{brand.id}/restore")).status_code == 403

    row = await _reload(db_session, RestaurantBrand, brand.id)
    assert row.deleted_at is None


@pytest.mark.asyncio
async def test_anonymous_is_unauthorized(client, db_session, as_anonymous):
    _owner, brand, *_ = await _brand_with_locations(db_session)
    assert (await client.delete(f"/restaurants/{brand.id}")).status_code == 401
    assert (await client.post(f"/restaurants/{brand.id}/restore")).status_code == 401


@pytest.mark.asyncio
async def test_unknown_brand_is_404(client, as_user):
    as_user("admin")
    assert (await client.delete("/restaurants/999999")).status_code == 404
    assert (await client.post("/restaurants/999999/restore")).status_code == 404


# ---------------------------------------------------------------------------
# Delete behaviour
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_soft_deletes_brand_and_deactivates_active_locations(client, db_session, as_user):
    _owner, brand, active_a, active_b, coming, closed = await _brand_with_locations(db_session)
    admin = as_user("admin")

    response = await client.delete(f"/restaurants/{brand.id}")
    assert response.status_code == 204, response.text  # no 409 despite locations

    # Row kept, flagged.
    row = await _reload(db_session, RestaurantBrand, brand.id)
    assert row.deleted_at is not None

    # Every active location deactivated; already-hidden ones untouched
    # (closed_pending_reopen must keep requiring an admin-approved reopen).
    assert (await _reload(db_session, RestaurantLocation, active_a.id)).status == "owner_deactivated"
    assert (await _reload(db_session, RestaurantLocation, active_b.id)).status == "owner_deactivated"
    assert (await _reload(db_session, RestaurantLocation, coming.id)).status == "coming_soon"
    assert (await _reload(db_session, RestaurantLocation, closed.id)).status == "closed_pending_reopen"

    # Audit: one brand row + one row per location actually changed.
    brand_rows = await _audit_rows(db_session, "restaurant_brand", brand.id)
    assert len(brand_rows) == 1
    assert brand_rows[0].actor_id == admin.cognito_sub
    assert brand_rows[0].actor_role == "admin"
    assert brand_rows[0].old_val == {"deleted_at": None}
    assert brand_rows[0].new_val["deleted_at"]
    assert sorted(brand_rows[0].new_val["locations_deactivated"]) == sorted([active_a.id, active_b.id])

    for loc in (active_a, active_b):
        loc_rows = await _audit_rows(db_session, "restaurant_location", loc.id)
        assert len(loc_rows) == 1
        assert loc_rows[0].actor_id == admin.cognito_sub
        assert loc_rows[0].actor_role == "admin"
        assert loc_rows[0].old_val == {"status": "active"}
        assert loc_rows[0].new_val["status"] == "owner_deactivated"
    for loc in (coming, closed):
        assert await _audit_rows(db_session, "restaurant_location", loc.id) == []


@pytest.mark.asyncio
async def test_delete_is_idempotent(client, db_session, as_user):
    _owner, brand, active_a, *_ = await _brand_with_locations(db_session)
    as_user("admin")

    assert (await client.delete(f"/restaurants/{brand.id}")).status_code == 204
    first_deleted_at = (await _reload(db_session, RestaurantBrand, brand.id)).deleted_at
    brand_audit = len(await _audit_rows(db_session, "restaurant_brand"))
    loc_audit = len(await _audit_rows(db_session, "restaurant_location"))

    assert (await client.delete(f"/restaurants/{brand.id}")).status_code == 204

    assert (await _reload(db_session, RestaurantBrand, brand.id)).deleted_at == first_deleted_at
    assert len(await _audit_rows(db_session, "restaurant_brand")) == brand_audit
    assert len(await _audit_rows(db_session, "restaurant_location")) == loc_audit


@pytest.mark.asyncio
async def test_delete_brand_without_locations_works(client, db_session, as_user):
    brand = await create_brand(db_session, name="Empty Brand")
    await db_session.commit()
    as_user("admin")

    assert (await client.delete(f"/restaurants/{brand.id}")).status_code == 204
    assert (await _reload(db_session, RestaurantBrand, brand.id)).deleted_at is not None


@pytest.mark.asyncio
async def test_slug_stays_reserved(client, db_session, as_user):
    owner, brand, *_ = await _brand_with_locations(db_session)
    as_user("admin")
    assert (await client.delete(f"/restaurants/{brand.id}")).status_code == 204

    # Same name -> the deleted brand's slug is still taken, so a new brand gets a suffix.
    as_user("owner", sub=owner.cognito_sub)
    response = await client.post("/restaurants", json={"name": "Spice Route"})
    assert response.status_code == 201, response.text
    assert response.json()["slug"] != brand.slug


# ---------------------------------------------------------------------------
# Hidden from every read path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_deleted_brand_and_locations_404_for_public_and_owner(client, db_session, as_user):
    owner, brand, active_a, *_ = await _brand_with_locations(db_session)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=active_a.id, user_id=manager_sub, is_active=True)
    await db_session.commit()

    as_user("admin")
    assert (await client.delete(f"/restaurants/{brand.id}")).status_code == 204

    # Public.
    app_main.app.dependency_overrides.pop(get_current_user, None)
    app_main.app.dependency_overrides.pop(get_current_user_optional, None)
    assert (await client.get(f"/restaurants/{brand.id}")).status_code == 404
    assert (await client.get(f"/restaurants/{brand.slug}")).status_code == 404
    assert (await client.get(f"/restaurants/{brand.id}/locations")).status_code == 404
    assert (await client.get(f"/locations/{active_a.id}")).status_code == 404

    # Owner (would otherwise see their own hidden locations).
    _as_both(as_user, "owner", sub=owner.cognito_sub)
    assert (await client.get(f"/restaurants/{brand.id}/locations")).status_code == 404
    assert (await client.get(f"/locations/{active_a.id}")).status_code == 404
    assert (await client.patch(f"/restaurants/{brand.id}", json={"name": "X"})).status_code == 404
    assert (await client.patch(f"/locations/{active_a.id}", json={"city": "Plano"})).status_code == 404
    assert (
        await client.post(f"/locations/{active_a.id}/status", json={"status": "active"})
    ).status_code == 404

    # Assigned manager.
    _as_both(as_user, "manager", sub=manager_sub)
    assert (await client.get(f"/locations/{active_a.id}")).status_code == 404
    assert (await client.patch(f"/locations/{active_a.id}", json={"city": "Plano"})).status_code == 404

    # Admin keeps full access (support / restore flow).
    _as_both(as_user, "admin")
    assert (await client.get(f"/locations/{active_a.id}")).status_code == 200
    assert (await client.get(f"/restaurants/{brand.id}/locations")).status_code == 200


@pytest.mark.asyncio
async def test_owner_cannot_add_location_to_deleted_brand(client, db_session, as_user):
    owner, brand, *_ = await _brand_with_locations(db_session)
    as_user("admin")
    assert (await client.delete(f"/restaurants/{brand.id}")).status_code == 204

    as_user("owner", sub=owner.cognito_sub)
    response = await client.post(
        "/locations",
        json={
            "brand_id": brand.id,
            "address_line1": "1 Main St",
            "city": "Plano",
            "state": "TX",
            "postal_code": "75024",
            "phone": "+12145550100",
        },
    )
    assert response.status_code == 404, response.text


@pytest.mark.asyncio
async def test_favourites_hide_deleted_brand_and_restore_brings_it_back(client, db_session, as_user):
    live = await create_brand(db_session, name="Live Diner")
    _owner, dead, *_ = await _brand_with_locations(db_session)
    user = as_user("registered_user")
    await create_follow(db_session, user_id=user.cognito_sub, brand_id=live.id)
    await create_follow(db_session, user_id=user.cognito_sub, brand_id=dead.id)
    await db_session.commit()

    before = (await client.get("/auth/me/follows")).json()
    assert before["total"] == 2

    as_user("admin")
    assert (await client.delete(f"/restaurants/{dead.id}")).status_code == 204

    user = as_user("registered_user", sub=user.cognito_sub)
    after = (await client.get("/auth/me/follows")).json()
    assert after["total"] == 1
    assert [r["brand_id"] for r in after["results"]] == [live.id]
    # Can't newly follow a dead listing either.
    assert (await client.post(f"/restaurants/{dead.id}/follow")).status_code == 404

    as_user("admin")
    assert (await client.post(f"/restaurants/{dead.id}/restore")).status_code == 200
    as_user("registered_user", sub=user.cognito_sub)
    restored = (await client.get("/auth/me/follows")).json()
    assert restored["total"] == 2


@pytest.mark.asyncio
async def test_lists_exclude_deleted_and_admin_can_filter_for_them(client, db_session, as_user):
    owner, dead, *_ = await _brand_with_locations(db_session)
    live = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Live Diner")
    await create_location(db_session, brand_id=live.id, status="active")
    await db_session.commit()

    as_user("admin")
    assert (await client.delete(f"/restaurants/{dead.id}")).status_code == 204

    default_ids = [r["id"] for r in (await client.get("/restaurants")).json()["results"]]
    assert default_ids == [live.id]
    # A location-status filter that the dead brand's locations match still excludes it.
    by_status = (await client.get("/restaurants?status=owner_deactivated")).json()
    assert by_status["total"] == 0

    deleted = (await client.get("/restaurants?status=deleted")).json()
    assert [r["id"] for r in deleted["results"]] == [dead.id]
    assert deleted["results"][0]["deleted_at"] is not None
    assert deleted["results"][0]["location_count"] == 0

    # Owner console never sees it, and `status=deleted` is ignored for an owner.
    as_user("owner", sub=owner.cognito_sub)
    assert [r["id"] for r in (await client.get("/restaurants")).json()["results"]] == [live.id]
    assert [r["id"] for r in (await client.get("/restaurants?status=deleted")).json()["results"]] == [live.id]


@pytest.mark.asyncio
async def test_manager_console_hides_deleted_brand_locations(client, db_session, as_user):
    _owner, brand, active_a, *_ = await _brand_with_locations(db_session)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=active_a.id, user_id=manager_sub, is_active=True)
    await db_session.commit()

    as_user("manager", sub=manager_sub)
    assert (await client.get("/auth/me/managed-locations")).json()["total"] == 1

    as_user("admin")
    assert (await client.delete(f"/restaurants/{brand.id}")).status_code == 204
    # Even if a location were re-enabled behind the brand's back, the console stays clean.
    row = await _reload(db_session, RestaurantLocation, active_a.id)
    row.status = "active"
    await db_session.commit()

    as_user("manager", sub=manager_sub)
    body = (await client.get("/auth/me/managed-locations")).json()
    assert body["total"] == 0
    assert body["results"] == []


@pytest.mark.asyncio
async def test_claim_and_report_against_deleted_brand_404(client, db_session, as_user):
    _owner, brand, *_ = await _brand_with_locations(db_session)
    as_user("admin")
    assert (await client.delete(f"/restaurants/{brand.id}")).status_code == 204

    as_user("owner")
    claim = await client.post(
        "/claim",
        json={
            "brand_id": brand.id,
            "proof_method": "google_business_profile",
            "google_business_profile_url": "https://g.page/x",
        },
    )
    assert claim.status_code == 404, claim.text

    as_user("registered_user")
    report = await client.post(
        "/reports", json={"brand_id": brand.id, "category": "other", "details": "gone"}
    )
    assert report.status_code == 404, report.text


@pytest.mark.asyncio
async def test_admin_overview_excludes_deleted_brands(client, db_session, as_user):
    owner, dead, *_ = await _brand_with_locations(db_session)
    live = await create_brand(db_session, owner_id=owner.id, is_claimed=True, name="Live Diner")
    await create_location(db_session, brand_id=live.id, status="active")
    await db_session.commit()

    as_user("admin")
    assert (await client.get("/admin/overview")).json()["restaurants"]["total"] == 2
    assert (await client.delete(f"/restaurants/{dead.id}")).status_code == 204

    body = (await client.get("/admin/overview")).json()
    assert body["restaurants"]["total"] == 1
    assert body["restaurants"]["by_status"]["active"] == 1
    assert body["restaurants"]["by_status"]["owner_deactivated"] == 0
    assert body["restaurants"]["by_status"]["coming_soon"] == 0


@pytest.mark.asyncio
async def test_active_location_filter_used_by_search_is_empty_after_delete(client, db_session, as_user):
    """`/search` needs PostGIS (see test_search_api.py), so assert the exact
    ORM predicate it uses (`RestaurantLocation.is_active == True`) matches
    none of a deleted brand's locations."""
    _owner, brand, *_ = await _brand_with_locations(db_session)
    as_user("admin")
    assert (await client.delete(f"/restaurants/{brand.id}")).status_code == 204

    rows = (
        await db_session.execute(
            select(RestaurantLocation.id).where(
                RestaurantLocation.brand_id == brand.id,
                RestaurantLocation.is_active == True,  # noqa: E712
            )
        )
    ).scalars().all()
    assert rows == []


# ---------------------------------------------------------------------------
# Restore
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_restore_clears_flag_keeps_locations_deactivated_and_is_idempotent(
    client, db_session, as_user
):
    owner, brand, active_a, *_ = await _brand_with_locations(db_session)
    admin = as_user("admin")
    assert (await client.delete(f"/restaurants/{brand.id}")).status_code == 204

    response = await client.post(f"/restaurants/{brand.id}/restore")
    assert response.status_code == 200, response.text
    assert response.json()["deleted_at"] is None
    assert response.json()["id"] == brand.id

    assert (await _reload(db_session, RestaurantBrand, brand.id)).deleted_at is None
    # Locations are NOT silently republished.
    assert (await _reload(db_session, RestaurantLocation, active_a.id)).status == "owner_deactivated"

    restore_audit = [
        r for r in await _audit_rows(db_session, "restaurant_brand", brand.id) if r.new_val == {"deleted_at": None}
    ]
    assert len(restore_audit) == 1
    assert restore_audit[0].actor_id == admin.cognito_sub

    # Public brand page is back; idempotent second restore adds no audit row.
    assert (await client.get(f"/restaurants/{brand.id}")).status_code == 200
    assert (await client.post(f"/restaurants/{brand.id}/restore")).status_code == 200
    again = [
        r for r in await _audit_rows(db_session, "restaurant_brand", brand.id) if r.new_val == {"deleted_at": None}
    ]
    assert len(again) == 1

    # Owner can re-enable a location through the normal path.
    as_user("owner", sub=owner.cognito_sub)
    reenable = await client.post(f"/locations/{active_a.id}/status", json={"status": "active"})
    assert reenable.status_code == 200, reenable.text
    assert reenable.json()["status"] == "active"


# ---------------------------------------------------------------------------
# Bulk import
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bulk_import_refuses_to_reuse_a_deleted_brands_slug(client, db_session, as_user):
    owner, brand, *_ = await _brand_with_locations(db_session)
    as_user("admin")
    assert (await client.delete(f"/restaurants/{brand.id}")).status_code == 204

    row = RestaurantBasicDetailIn(
        name="Spice Route",
        address_line1="9 New St",
        city="Plano",
        state="TX",
        postal_code="75024",
        phone="+12145550111",
    )
    # Same slug as the deleted brand (slugify("Spice Route")); the fixture brand's
    # random slug differs, so pin it to the slug bulk import will compute.
    stored = await _reload(db_session, RestaurantBrand, brand.id)
    stored.slug = "spice-route"
    await db_session.commit()

    result = await bulk_import_restaurants(
        db_session, [row], owner_id=owner.id, actor_id="admin-sub", actor_role="admin"
    )
    assert result.created == 0
    assert result.errors == 1
    assert "deleted" in result.rows[0].detail
    # No location was attached to the deleted brand.
    count = (
        await db_session.execute(
            select(RestaurantLocation.id).where(RestaurantLocation.address_line1 == "9 New St")
        )
    ).scalars().all()
    assert count == []
