"""Integration tests: admin bulk listing import (`/admin/import/validate`,
`/admin/import/commit`; docs/API_CONTRACTS.md "Admin bulk listing import").

Covers: admin-only; per-row report (missing fields, bad phone/ZIP, unknown
type, needs_geocoding); duplicate detection in BOTH directions -- within the
file (second occurrence flagged, names the earlier row), within the file
split across two commit chunks, against an existing ACTIVE listing, against an
existing inactive / coming_soon listing, phone-only match (warning); commit
writes unclaimed + verified + audited rows; warnings need opt-in; full
re-import creates nothing; chunk cap; no echo of internals.
"""
from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.models.audit_log import AuditLog
from app.models.location_cuisine import LocationCuisine
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from factories import create_brand, create_cuisine_tag, create_location, create_owner


def row(n: int, **over):
    base = {
        "row_number": n,
        "name": f"Spice Hut {n}",
        "address_line1": f"{n} Main St",
        "city": "Plano",
        "state": "TX",
        "postal_code": "75024",
        "phone": f"(214) 555-{n:04d}",
        "type": "south indian",
        "latitude": "33.02",
        "longitude": "-96.70",
    }
    base.update(over)
    return base


async def validate(client, rows):
    resp = await client.post("/admin/import/validate", json={"rows": rows})
    assert resp.status_code == 200, resp.text
    return resp.json()


async def commit(client, rows, include_warnings=False):
    resp = await client.post(
        "/admin/import/commit", json={"rows": rows, "include_warnings": include_warnings}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def count(db, model) -> int:
    return (await db.execute(select(func.count()).select_from(model))).scalar_one()


@pytest.fixture(autouse=True)
def _no_postgis(monkeypatch):
    """SQLite has no ST_SetSRID/ST_MakePoint; the geom sync is covered by the
    existing bulk-import service path and verified against real Postgres."""

    async def _noop(*_a, **_k):
        return None

    monkeypatch.setattr("app.services.restaurant_bulk_import_service._sync_geom", _noop)


@pytest.fixture
async def tag(db_session):
    return await create_cuisine_tag(db_session, name="south_indian", display_name="South Indian")


@pytest.mark.asyncio
async def test_admin_only(client, db_session, as_user, as_anonymous):
    body = {"rows": [row(2)]}
    assert (await client.post("/admin/import/validate", json=body)).status_code in (401, 403)
    for role in ("owner", "manager", "registered_user"):
        as_user(role)
        assert (await client.post("/admin/import/validate", json=body)).status_code == 403
        assert (await client.post("/admin/import/commit", json=body)).status_code == 403


@pytest.mark.asyncio
async def test_validate_report_per_row_and_writes_nothing(client, db_session, as_user, tag):
    as_user("admin")
    rows = [
        row(2),
        row(3, name="", phone="123"),  # missing name + bad phone
        row(4, postal_code="7502"),
        row(5, type="martian fusion"),  # unknown tag -> warning
        row(6, latitude=None, longitude=None),  # needs geocoding, still valid
    ]
    data = await validate(client, rows)
    by_row = {r["row_number"]: r for r in data["rows"]}
    assert by_row[2]["status"] == "valid" and by_row[2]["matched_tag"] == "south_indian"
    assert by_row[3]["status"] == "error"
    fields = {i["field"] for i in by_row[3]["issues"] if i["severity"] == "error"}
    assert {"name", "phone"} <= fields
    assert by_row[4]["status"] == "error"
    assert by_row[5]["status"] == "warning"
    assert by_row[6]["status"] == "valid" and by_row[6]["needs_geocoding"] is True
    assert data["summary"] == {
        "total": 5, "valid": 2, "warning": 1, "error": 2, "duplicate": 0, "needs_geocoding": 1,
        "ready_to_activate": 0, "incomplete": 3,
    }
    assert await count(db_session, RestaurantBrand) == 0
    assert await count(db_session, RestaurantLocation) == 0


@pytest.mark.asyncio
async def test_in_file_duplicate_flags_second_row_and_names_the_first(client, db_session, as_user, tag):
    as_user("admin")
    dup = row(7, name="SPICE HUT 2!", address_line1="2 Main Street", phone=None)
    data = await validate(client, [row(2), row(3), dup])
    by_row = {r["row_number"]: r for r in data["rows"]}
    assert by_row[2]["status"] == "valid"
    assert by_row[7]["status"] == "duplicate"
    assert by_row[7]["duplicate_of_row"] == 2
    assert "row 2" in by_row[7]["issues"][-1]["message"]
    assert data["summary"]["duplicate"] == 1


@pytest.mark.asyncio
async def test_in_file_duplicate_split_across_two_chunks(client, db_session, as_user, tag):
    """Chunked submission must not defeat in-file dedupe: chunk 2 re-checks the
    database, which already holds chunk 1's rows."""
    as_user("admin")
    first = await commit(client, [row(2), row(3)])
    assert first["summary"]["created"] == 2
    dup_of_row_2 = row(9, name="spice hut 2", address_line1="2 MAIN ST.", phone=None)
    second = await commit(client, [dup_of_row_2, row(4)])
    by_row = {r["row_number"]: r for r in second["rows"]}
    assert by_row[9]["result"] == "skipped_duplicate"
    assert "Duplicate" in by_row[9]["reason"]
    assert by_row[4]["result"] == "created"
    assert await count(db_session, RestaurantLocation) == 3


@pytest.mark.asyncio
async def test_in_file_duplicate_within_one_chunk(client, db_session, as_user, tag):
    as_user("admin")
    result = await commit(client, [row(2), row(8, name="spice hut 2", address_line1="2 main st", phone=None)])
    assert [r["result"] for r in result["rows"]] == ["created", "skipped_duplicate"]
    assert "row 2" in result["rows"][1]["reason"]


@pytest.mark.asyncio
async def test_duplicate_of_existing_active_listing(client, db_session, as_user, tag):
    brand = await create_brand(db_session, name="Spice Hut 2", slug="spice-hut-2")
    await create_location(
        db_session, brand_id=brand.id, address_line1="2 Main St", postal_code="75024", phone="+19725550000"
    )
    as_user("admin")
    data = await validate(client, [row(2, address_line1="2 MAIN STREET, Ste 4", name="spice hut 2")])
    r = data["rows"][0]
    assert r["status"] == "duplicate" and r["duplicate_of_listing_id"] is not None
    committed = await commit(client, [row(2, address_line1="2 MAIN STREET, Ste 4", name="spice hut 2")])
    assert committed["rows"][0]["result"] == "skipped_duplicate"
    assert await count(db_session, RestaurantLocation) == 1


@pytest.mark.parametrize("status", ["owner_deactivated", "coming_soon", "closed_pending_reopen"])
@pytest.mark.asyncio
async def test_duplicate_of_existing_inactive_listing(client, db_session, as_user, tag, status):
    brand = await create_brand(db_session, name="Spice Hut 2", slug="spice-hut-2")
    await create_location(
        db_session, brand_id=brand.id, address_line1="2 Main St", postal_code="75024",
        phone=None, status=status,
    )
    as_user("admin")
    data = await validate(client, [row(2)])
    assert data["rows"][0]["status"] == "duplicate"
    assert (await commit(client, [row(2)]))["rows"][0]["result"] == "skipped_duplicate"
    assert await count(db_session, RestaurantLocation) == 1


@pytest.mark.asyncio
async def test_duplicate_of_soft_deleted_listing_is_not_recreated(client, db_session, as_user, tag):
    from datetime import datetime, timezone

    brand = await create_brand(
        db_session, name="Spice Hut 2", slug="spice-hut-2", deleted_at=datetime.now(timezone.utc)
    )
    await create_location(db_session, brand_id=brand.id, address_line1="2 Main St", postal_code="75024", phone=None)
    as_user("admin")
    assert (await validate(client, [row(2)]))["rows"][0]["status"] == "duplicate"


@pytest.mark.asyncio
async def test_phone_only_match_is_a_warning_and_needs_opt_in(client, db_session, as_user, tag):
    brand = await create_brand(db_session, name="Completely Other", slug="completely-other")
    await create_location(
        db_session, brand_id=brand.id, address_line1="900 Elsewhere Rd", postal_code="75001", phone="+12145550002"
    )
    as_user("admin")
    r = (await validate(client, [row(2)]))["rows"][0]
    assert r["status"] == "warning"
    assert any(i["code"] == "possible_duplicate" and "phone" in i["message"] for i in r["issues"])

    skipped = await commit(client, [row(2)])
    assert skipped["rows"][0]["result"] == "skipped_warning"
    assert await count(db_session, RestaurantLocation) == 1

    created = await commit(client, [row(2)], include_warnings=True)
    assert created["rows"][0]["result"] == "created"
    assert await count(db_session, RestaurantLocation) == 2


@pytest.mark.asyncio
async def test_commit_writes_unclaimed_verified_audited_listings(client, db_session, as_user, tag):
    admin = as_user("admin")
    result = await commit(client, [row(2), row(3, latitude=None, longitude=None)])
    assert result["summary"]["created"] == 2 and result["summary"]["needs_geocoding"] == 1

    brands = (await db_session.execute(select(RestaurantBrand))).scalars().all()
    assert len(brands) == 2
    assert all(b.owner_id is None and b.is_claimed is False and b.claimed_at is None for b in brands)
    locations = (await db_session.execute(select(RestaurantLocation))).scalars().all()
    # Imported listings are ALWAYS hidden until an admin activates them.
    assert all(loc.is_verified and loc.status == "coming_soon" and not loc.is_paid for loc in locations)
    phones = {loc.phone for loc in locations}
    assert phones == {"+12145550002", "+12145550003"}
    assert await count(db_session, LocationCuisine) == 2

    audits = (await db_session.execute(select(AuditLog))).scalars().all()
    by_table = {t: [a for a in audits if a.table_name == t] for t in ("restaurant_brand", "restaurant_location")}
    assert len(by_table["restaurant_brand"]) == 2 and len(by_table["restaurant_location"]) == 2
    for entry in audits:
        assert entry.action == "create"
        assert entry.actor_id == admin.cognito_sub and entry.actor_role == "admin"
        assert entry.new_val["provenance"] == "bulk_import"
    assert all(
        a.new_val["status"] == "coming_soon" and a.new_val["missing"] == ["hours"]
        for a in by_table["restaurant_location"]
    )


@pytest.mark.asyncio
async def test_full_reimport_creates_nothing(client, db_session, as_user, tag):
    as_user("admin")
    rows = [row(n) for n in range(2, 8)] + [row(9, type=None, phone=None)]
    first = await commit(client, rows)
    assert first["summary"]["created"] == 7
    brands, locations, audits = (
        await count(db_session, RestaurantBrand),
        await count(db_session, RestaurantLocation),
        await count(db_session, AuditLog),
    )
    # Validate now reports everything as duplicate...
    again = await validate(client, rows)
    assert again["summary"]["duplicate"] == 7
    # ...and a committed re-upload (even if the client ignored that) writes nothing.
    second = await commit(client, rows, include_warnings=True)
    assert second["summary"]["created"] == 0 and second["summary"]["skipped_duplicate"] == 7
    assert (await count(db_session, RestaurantBrand), await count(db_session, RestaurantLocation),
            await count(db_session, AuditLog)) == (brands, locations, audits)


@pytest.mark.asyncio
async def test_second_location_of_same_unclaimed_brand_reuses_the_brand(client, db_session, as_user, tag):
    as_user("admin")
    result = await commit(
        client,
        [row(2, name="Chain Masala"), row(3, name="Chain Masala", city="Frisco", postal_code="75034")],
    )
    assert result["summary"]["created"] == 2
    assert await count(db_session, RestaurantBrand) == 1
    assert await count(db_session, RestaurantLocation) == 2


@pytest.mark.asyncio
async def test_owned_brand_name_is_an_error_not_a_silent_attach(client, db_session, as_user, tag):
    owner = await create_owner(db_session)
    await create_brand(db_session, name="Spice Hut 2", slug="spice-hut-2", owner_id=owner.id, is_claimed=True)
    as_user("admin")
    r = (await validate(client, [row(2)]))["rows"][0]
    assert r["status"] == "error" and any(i["code"] == "brand_owned" for i in r["issues"])
    assert (await commit(client, [row(2)]))["rows"][0]["result"] == "failed"
    assert await count(db_session, RestaurantLocation) == 0


@pytest.mark.asyncio
async def test_chunk_and_file_caps(client, db_session, as_user, tag):
    as_user("admin")
    too_many_commit = await client.post("/admin/import/commit", json={"rows": [row(n) for n in range(2, 54)]})
    assert too_many_commit.status_code == 422
    too_many_validate = await client.post("/admin/import/validate", json={"rows": [row(n) for n in range(2, 505)]})
    assert too_many_validate.status_code == 422
    empty = await client.post("/admin/import/validate", json={"rows": []})
    assert empty.status_code == 422


@pytest.mark.asyncio
async def test_hostile_cells_are_stored_as_text_and_overlong_cells_are_row_errors(client, db_session, as_user, tag):
    as_user("admin")
    rows = [
        row(2, name="=cmd|' /C calc'!A0", description="'; DROP TABLE restaurant_brand;--"),
        row(3, description="x" * 2000),
        row(4, name="Null\x00Byte"),
    ]
    data = await validate(client, rows)
    assert [r["status"] for r in data["rows"]] == ["valid", "error", "error"]
    result = await commit(client, rows[:1])
    assert result["summary"]["created"] == 1
    brand = (await db_session.execute(select(RestaurantBrand))).scalar_one()
    assert brand.name == "=cmd|' /C calc'!A0"
    assert await count(db_session, RestaurantBrand) == 1
