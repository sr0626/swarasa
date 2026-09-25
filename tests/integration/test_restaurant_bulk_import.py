"""Tests for `app.services.restaurant_bulk_import_service.bulk_import_restaurants`
and its admin-only HTTP surface (`POST /admin/restaurants/bulk-import`),
plus the CSV import path (`bulk_import_restaurants_csv`) added for the CSV
bulk-import feature (docs/PROJECT_PLAN.csv "CSV bulk restaurant import").

Uses the `db_session`/`client`/`as_user` fixtures from
`tests/integration/conftest.py` (real SQLite-backed AsyncSession + real
FastAPI app, same as `test_manager_permissions.py` etc) rather than
`tests/unit`'s fake-session style: this service does real DB reads/writes
(check-before-insert, SAVEPOINT-per-row) that a hand-rolled fake session
can't faithfully exercise.

Covers the two behaviors called out in the task: idempotency (re-running
the same batch creates zero duplicate rows) and partial failure (one bad
row doesn't abort the batch) -- plus admin-gating on the HTTP endpoint.
CSV-path-specific coverage lives at the bottom of this file: per-row
owner_email resolution (existing owner succeeds, missing owner is a
per-row error not a batch failure), cuisine_type matching (matched
case-insensitively, unmatched reported not failed), and the `website`
field round-tripping through brand creation.

Pure CSV-text PARSING (`parse_csv_rows`, no DB) is covered separately in
`tests/unit/test_bulk_import_csv_parsing.py` per tests/CLAUDE.md's
unit-vs-integration split.
"""
from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.models.audit_log import AuditLog
from app.models.cuisine_tag import CuisineTag
from app.models.restaurant_brand import RestaurantBrand
from app.models.location_cuisine import LocationCuisine
from app.models.restaurant_location import RestaurantLocation
from app.schemas.restaurant_bulk_import import RestaurantBasicDetailIn
from app.services.restaurant_bulk_import_service import (
    bulk_import_restaurants,
    bulk_import_restaurants_csv,
)
from factories import create_cuisine_tag, create_owner


def _row(**overrides) -> RestaurantBasicDetailIn:
    # No latitude/longitude here deliberately: the service's `_sync_geom`
    # (mirroring `location_service._sync_geom` exactly) issues a raw
    # `ST_MakePoint`/`ST_SetSRID` SQL call that only exists on real
    # PostGIS, not SQLite -- same limitation `tests/integration/conftest.py`
    # and `test_search_api.py` document for every other write path that
    # touches `geom`. These tests run on the plain SQLite `db_session`
    # fixture (like every other non-geo integration test in this suite),
    # so they exercise brand/location creation, idempotency, and audit
    # logging without ever setting lat/lng.
    defaults = dict(
        name="Namaste Grill & Sports Bar",
        address_line1="2234 W Walnut Hill Ln",
        city="Irving",
        state="TX",
        postal_code="75038",
        country="US",
    )
    defaults.update(overrides)
    return RestaurantBasicDetailIn(**defaults)


async def _count(db_session, model) -> int:
    result = await db_session.execute(select(func.count()).select_from(model))
    return result.scalar_one()


@pytest.mark.asyncio
async def test_bulk_import_creates_brand_and_location(db_session):
    owner = await create_owner(db_session)
    await db_session.commit()

    rows = [_row(), _row(name="Spices Of India Kitchen", address_line1="833 E Shady Grove Rd A")]
    result = await bulk_import_restaurants(
        db_session, rows, owner_id=owner.id, actor_id="admin-sub-1", actor_role="admin"
    )

    assert result.created == 2
    assert result.skipped == 0
    assert result.errors == 0
    assert await _count(db_session, RestaurantBrand) == 2
    assert await _count(db_session, RestaurantLocation) == 2

    brand_audits = (
        await db_session.execute(select(AuditLog).where(AuditLog.table_name == "restaurant_brand"))
    ).scalars().all()
    location_audits = (
        await db_session.execute(select(AuditLog).where(AuditLog.table_name == "restaurant_location"))
    ).scalars().all()
    assert len(brand_audits) == 2
    assert len(location_audits) == 2
    assert all(a.action == "create" and a.actor_role == "admin" for a in brand_audits + location_audits)


@pytest.mark.asyncio
async def test_bulk_import_is_idempotent_on_rerun(db_session):
    """Re-running the same batch must create zero duplicate rows -- the
    task's explicit idempotency requirement.
    """
    owner = await create_owner(db_session)
    await db_session.commit()

    rows = [_row(), _row(name="Spices Of India Kitchen", address_line1="833 E Shady Grove Rd A")]

    first = await bulk_import_restaurants(
        db_session, rows, owner_id=owner.id, actor_id="admin-sub-1", actor_role="admin"
    )
    assert first.created == 2

    second = await bulk_import_restaurants(
        db_session, rows, owner_id=owner.id, actor_id="admin-sub-1", actor_role="admin"
    )
    assert second.created == 0
    assert second.skipped == 2
    assert second.errors == 0

    # Still exactly 2 of each -- no duplicates from the re-run.
    assert await _count(db_session, RestaurantBrand) == 2
    assert await _count(db_session, RestaurantLocation) == 2


@pytest.mark.asyncio
async def test_bulk_import_partial_failure_bad_row_does_not_abort_batch(db_session):
    """One malformed row (fails schema validation) must not prevent the
    other, valid rows in the same batch from being created.
    """
    owner = await create_owner(db_session)
    await db_session.commit()

    good_row = _row().model_dump()
    bad_row = {
        "name": "Missing Required Fields Restaurant",
        # no address_line1/city/state/postal_code -> fails Pydantic validation
    }
    another_good_row = _row(
        name="Spices Of India Kitchen", address_line1="833 E Shady Grove Rd A"
    ).model_dump()

    result = await bulk_import_restaurants(
        db_session,
        [good_row, bad_row, another_good_row],
        owner_id=owner.id,
        actor_id="admin-sub-1",
        actor_role="admin",
    )

    assert result.created == 2
    assert result.errors == 1
    assert result.rows[1].status.value == "error"
    assert result.rows[1].name == "Missing Required Fields Restaurant"
    assert await _count(db_session, RestaurantBrand) == 2
    assert await _count(db_session, RestaurantLocation) == 2


@pytest.mark.asyncio
async def test_bulk_import_second_location_for_existing_brand_is_not_duplicated(db_session):
    """Same brand (same `name` -> same slug), two different addresses ->
    one brand, two locations. Re-running must still leave exactly one
    brand and two locations (natural-key check on (brand_id, address_line1)).
    """
    owner = await create_owner(db_session)
    await db_session.commit()

    rows = [
        _row(name="Multi Location Cafe", address_line1="100 Main St"),
        _row(name="Multi Location Cafe", address_line1="200 Main St"),
    ]

    first = await bulk_import_restaurants(
        db_session, rows, owner_id=owner.id, actor_id="admin-sub-1", actor_role="admin"
    )
    assert first.created == 2
    assert await _count(db_session, RestaurantBrand) == 1
    assert await _count(db_session, RestaurantLocation) == 2

    second = await bulk_import_restaurants(
        db_session, rows, owner_id=owner.id, actor_id="admin-sub-1", actor_role="admin"
    )
    assert second.created == 0
    assert second.skipped == 2
    assert await _count(db_session, RestaurantBrand) == 1
    assert await _count(db_session, RestaurantLocation) == 2


@pytest.mark.asyncio
async def test_bulk_import_endpoint_requires_admin(client, db_session, as_user):
    owner = await create_owner(db_session)
    await db_session.commit()

    as_user("owner", sub=owner.cognito_sub)
    response = await client.post(
        "/admin/restaurants/bulk-import",
        json={"owner_id": owner.id, "restaurants": [_row().model_dump()]},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_bulk_import_endpoint_admin_happy_path(client, db_session, as_user):
    owner = await create_owner(db_session)
    await db_session.commit()

    as_user("admin")
    response = await client.post(
        "/admin/restaurants/bulk-import",
        json={"owner_id": owner.id, "restaurants": [_row().model_dump()]},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created"] == 1
    assert body["errors"] == 0
    assert await _count(db_session, RestaurantBrand) == 1


@pytest.mark.asyncio
async def test_bulk_import_endpoint_unknown_owner_id_is_404(client, db_session, as_user):
    as_user("admin")
    response = await client.post(
        "/admin/restaurants/bulk-import",
        json={"owner_id": 999999, "restaurants": [_row().model_dump()]},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_bulk_import_website_round_trips_on_json_path(db_session):
    """The new `website` field (docs/DATA_MODEL.md "restaurant_brand") is
    stored on the created brand and comes back unchanged -- covers the
    JSON path; the CSV path's equivalent is
    `test_bulk_import_csv_website_round_trips` below.
    """
    owner = await create_owner(db_session)
    await db_session.commit()

    rows = [_row(website="https://namastegrill.example")]
    result = await bulk_import_restaurants(
        db_session, rows, owner_id=owner.id, actor_id="admin-sub-1", actor_role="admin"
    )
    assert result.created == 1

    brand = (await db_session.execute(select(RestaurantBrand))).scalar_one()
    assert brand.website == "https://namastegrill.example"


# ---------------------------------------------------------------------------
# CSV import path (`bulk_import_restaurants_csv`) -- per-row owner_email
# resolution, free-text cuisine matching, website round-tripping.
# ---------------------------------------------------------------------------


def _csv_row(**overrides) -> dict:
    defaults = dict(
        name="Namaste Grill & Sports Bar",
        address_line1="2234 W Walnut Hill Ln",
        city="Irving",
        state="TX",
        postal_code="75038",
        country="US",
        owner_email="owner@example.com",
    )
    defaults.update(overrides)
    return defaults


@pytest.mark.asyncio
async def test_bulk_import_csv_creates_brand_and_location_for_existing_owner(db_session):
    owner = await create_owner(db_session, email="owner@example.com")
    await db_session.commit()

    rows = [_csv_row(owner_email=owner.email, website="https://namastegrill.example")]
    result = await bulk_import_restaurants_csv(
        db_session, rows, actor_id="system:test", actor_role="admin"
    )

    assert result.created == 1
    assert result.errors == 0
    assert result.rows[0].brand_id is not None
    assert result.rows[0].location_id is not None

    brand = (await db_session.execute(select(RestaurantBrand))).scalar_one()
    assert brand.owner_id == owner.id
    assert brand.website == "https://namastegrill.example"

    location_audits = (
        await db_session.execute(select(AuditLog).where(AuditLog.table_name == "restaurant_location"))
    ).scalars().all()
    assert len(location_audits) == 1
    assert location_audits[0].actor_role == "admin"


@pytest.mark.asyncio
async def test_bulk_import_csv_unknown_owner_email_is_per_row_error(db_session):
    """A row whose owner_email doesn't resolve to an existing owner_account
    is a per-row error (this path never creates an owner_account for a
    possibly-typo'd email) -- it must not abort the rest of the batch.
    """
    good_owner = await create_owner(db_session, email="real-owner@example.com")
    await db_session.commit()

    rows = [
        _csv_row(owner_email="real-owner@example.com"),
        _csv_row(
            name="Spices Of India Kitchen",
            address_line1="833 E Shady Grove Rd A",
            owner_email="typo-owner@example.com",
        ),
    ]
    result = await bulk_import_restaurants_csv(
        db_session, rows, actor_id="system:test", actor_role="admin"
    )

    assert result.created == 1
    assert result.errors == 1
    error_row = next(r for r in result.rows if r.status.value == "error")
    assert error_row.name == "Spices Of India Kitchen"
    assert "typo-owner@example.com" in error_row.detail

    # The good row still landed under the real owner despite the other
    # row's unresolvable email.
    brand = (await db_session.execute(select(RestaurantBrand))).scalar_one()
    assert brand.owner_id == good_owner.id


@pytest.mark.asyncio
async def test_bulk_import_csv_cuisine_type_matched_case_insensitively(db_session):
    owner = await create_owner(db_session, email="owner@example.com")
    tag = await create_cuisine_tag(
        db_session, name="south_indian", display_name="South Indian", category="regional"
    )
    await db_session.commit()

    rows = [_csv_row(owner_email=owner.email, cuisine_type="south indian")]
    result = await bulk_import_restaurants_csv(
        db_session, rows, actor_id="system:test", actor_role="admin"
    )

    assert result.created == 1
    assert result.rows[0].cuisine_type_input == "south indian"
    assert result.rows[0].cuisine_match == "south_indian"

    # Tags are per LOCATION: the link is on the imported row's location.
    location = (await db_session.execute(select(RestaurantLocation))).scalar_one()
    link = (
        await db_session.execute(
            select(LocationCuisine).where(
                LocationCuisine.location_id == location.id,
                LocationCuisine.cuisine_tag_id == tag.id,
            )
        )
    ).scalar_one_or_none()
    assert link is not None


@pytest.mark.asyncio
async def test_bulk_import_csv_cuisine_type_unmatched_is_reported_not_failed(db_session):
    """No `cuisine_tag` matches "klingon fusion" -- the row must still
    import successfully; the mismatch is only visible in the row result,
    per the task's explicit "don't fail the row" requirement.
    """
    owner = await create_owner(db_session, email="owner@example.com")
    await db_session.commit()

    rows = [_csv_row(owner_email=owner.email, cuisine_type="klingon fusion")]
    result = await bulk_import_restaurants_csv(
        db_session, rows, actor_id="system:test", actor_role="admin"
    )

    assert result.created == 1
    assert result.errors == 0
    assert result.rows[0].cuisine_type_input == "klingon fusion"
    assert result.rows[0].cuisine_match is None

    count = (
        await db_session.execute(select(func.count()).select_from(LocationCuisine))
    ).scalar_one()
    assert count == 0


@pytest.mark.asyncio
async def test_bulk_import_csv_cuisine_type_matches_display_name_too(db_session):
    """Matching also checks `display_name` as-typed (case-insensitively),
    not just the `name` slug -- e.g. a CSV author typing "Biryani" exactly
    as the display name shown in docs/TAXONOMY.md, not the underscored
    slug form.
    """
    owner = await create_owner(db_session, email="owner@example.com")
    tag = await create_cuisine_tag(
        db_session, name="biryani", display_name="Biryani", category="signature"
    )
    await db_session.commit()

    rows = [_csv_row(owner_email=owner.email, cuisine_type="BIRYANI")]
    result = await bulk_import_restaurants_csv(
        db_session, rows, actor_id="system:test", actor_role="admin"
    )

    assert result.rows[0].cuisine_match == tag.name


@pytest.mark.asyncio
async def test_bulk_import_csv_website_round_trips(db_session):
    owner = await create_owner(db_session, email="owner@example.com")
    await db_session.commit()

    rows = [_csv_row(owner_email=owner.email, website="https://spicesofindia.example")]
    result = await bulk_import_restaurants_csv(
        db_session, rows, actor_id="system:test", actor_role="admin"
    )
    assert result.created == 1

    brand = (await db_session.execute(select(RestaurantBrand))).scalar_one()
    assert brand.website == "https://spicesofindia.example"


@pytest.mark.asyncio
async def test_bulk_import_csv_is_idempotent_on_rerun(db_session):
    owner = await create_owner(db_session, email="owner@example.com")
    await db_session.commit()

    rows = [_csv_row(owner_email=owner.email)]

    first = await bulk_import_restaurants_csv(
        db_session, rows, actor_id="system:test", actor_role="admin"
    )
    assert first.created == 1

    second = await bulk_import_restaurants_csv(
        db_session, rows, actor_id="system:test", actor_role="admin"
    )
    assert second.created == 0
    assert second.skipped == 1

    count = (await db_session.execute(select(func.count()).select_from(RestaurantBrand))).scalar_one()
    assert count == 1
