"""Integration tests: manual listings start in SETUP (`coming_soon`) and going
live is a second, server-gated step — docs/DECISIONS.md "New manual listings
start in setup", docs/API_CONTRACTS.md "POST /locations" and "POST
/locations/{id}/status".

Covers:
  - `POST /locations` (the Add-restaurant / Add-location UI flows) creates the
    location as `coming_soon`, never `active`; it is invisible to the public
    (detail 404, brand location list, sitemap, the `is_active` filter search
    uses, favourites tile) and visible to its owner/admin.
  - `LocationOut.setup_missing` lists what is still missing and shrinks as the
    owner fills sections in.
  - `POST /locations/{id}/status` -> `active` from `coming_soon` is refused
    422 `listing_incomplete` (with `missing`) until the required info exists:
    all 7 days of hours (closed or open+close, no unknown day), a valid US
    phone, and the name/address fields; it succeeds once complete, and is
    audit-logged.
  - Only the first go-live is gated: un-hiding an `owner_deactivated` listing
    is unchanged (seeded/imported listings keep working).
  - Admin (and only owner-of-brand / admin) can add a location; a manager or
    another owner cannot.
  - Bulk import / seed defaults are unchanged (still `active`).
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

import app.main as app_main
from app.dependencies.auth import CurrentUser, get_current_user, get_current_user_optional
from app.models.audit_log import AuditLog
from app.models.restaurant_hours import RestaurantHours
from app.models.restaurant_location import RestaurantLocation
from app.schemas.restaurant_bulk_import import RestaurantBasicDetailIn
from app.services.restaurant_bulk_import_service import bulk_import_restaurants
from factories import (
    add_full_week_hours,
    create_brand,
    create_follow,
    create_location,
    create_location_manager,
    create_owner,
)


def _drop_auth_override() -> None:
    """Back to a genuinely anonymous caller for the rest of the test."""
    app_main.app.dependency_overrides.pop(get_current_user, None)
    app_main.app.dependency_overrides.pop(get_current_user_optional, None)


def _create_body(brand_id: int, **overrides) -> dict:
    body = {
        "brand_id": brand_id,
        "address_line1": "500 Legacy Dr",
        "city": "Plano",
        "state": "TX",
        "postal_code": "75024",
        "country": "US",
        "phone": "(214) 555-0142",
        "timezone": "America/Chicago",
    }
    body.update(overrides)
    return body


async def _owned_brand(db_session, **brand_kwargs):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True, **brand_kwargs)
    await db_session.commit()
    return owner, brand


async def _create_via_api(client, as_user, owner, brand, **overrides) -> dict:
    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    response = await client.post("/locations", json=_create_body(brand.id, **overrides))
    assert response.status_code == 201, response.text
    return response.json()


def _hours_payload(*, days=range(7), closed_days=(0,)) -> dict:
    entries = []
    for day in days:
        if day in closed_days:
            entries.append({"day_of_week": day, "is_closed": True})
        else:
            entries.append(
                {"day_of_week": day, "is_closed": False, "open_time": "11:00:00", "close_time": "22:00:00"}
            )
    return {"hours": entries}


# ---------------------------------------------------------------------------
# Create defaults to the non-public setup status
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_defaults_to_coming_soon_not_active(client, db_session, as_user):
    owner, brand = await _owned_brand(db_session)
    created = await _create_via_api(client, as_user, owner, brand)

    assert created["status"] == "coming_soon"
    assert created["is_active"] is False
    # Phone is required at create, so only the hours are still missing.
    assert created["setup_missing"] == ["hours"]

    row = (
        await db_session.execute(
            select(RestaurantLocation).where(RestaurantLocation.id == created["id"])
        )
    ).scalar_one()
    assert row.status == "coming_soon"

    audit = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.table_name == "restaurant_location",
                AuditLog.record_id == created["id"],
                AuditLog.action == "create",
            )
        )
    ).scalar_one()
    assert audit.new_val["status"] == "coming_soon"


@pytest.mark.asyncio
async def test_new_listing_is_invisible_to_the_public(client, db_session, as_user, as_anonymous):
    owner, brand = await _owned_brand(db_session, slug="setup-brand")
    created = await _create_via_api(client, as_user, owner, brand)
    _drop_auth_override()

    # Detail: 404, never 403 / 200.
    assert (await client.get(f"/locations/{created['id']}")).status_code == 404
    # Brand's public location list.
    listing = await client.get(f"/restaurants/{brand.id}/locations")
    assert listing.status_code == 200
    assert listing.json()["results"] == []
    # Sitemap.
    sitemap = (await client.get("/sitemap/locations")).json()
    assert sitemap["total"] == 0
    # The exact filter search_service uses (PostGIS search itself needs a real
    # Postgres — test_search_api.py).
    visible = (
        await db_session.execute(
            select(RestaurantLocation.id).where(RestaurantLocation.is_active == True)  # noqa: E712
        )
    ).scalars().all()
    assert created["id"] not in visible


@pytest.mark.asyncio
async def test_new_listing_is_not_on_a_followers_favourites_tile(client, db_session, as_user):
    owner, brand = await _owned_brand(db_session)
    created = await _create_via_api(client, as_user, owner, brand)
    other = await create_location(db_session, brand_id=brand.id, address_line1="9 Live St")
    follower_sub = str(uuid.uuid4())
    await create_follow(db_session, user_id=follower_sub, brand_id=brand.id)
    await db_session.commit()

    as_user("registered_user", sub=follower_sub)
    rows = (await client.get("/auth/me/follows")).json()["results"]
    tile = next(r for r in rows if r["brand_id"] == brand.id)
    assert tile["nearest_location"]["location_id"] == other.id
    assert tile["nearest_location"]["location_id"] != created["id"]
    assert tile["location_count_nearby"] == 1


@pytest.mark.asyncio
async def test_owner_and_admin_can_still_open_the_setup_listing(client, db_session, as_user):
    owner, brand = await _owned_brand(db_session)
    created = await _create_via_api(client, as_user, owner, brand)

    # `GET /locations/{id}` is caller-aware via the optional-user dependency.
    async def _override_optional(role: str, sub: str):
        user = CurrentUser(cognito_sub=sub, email=f"{sub}@example.com", role=role)

        async def _dep():
            return user

        app_main.app.dependency_overrides[get_current_user_optional] = _dep

    await _override_optional("owner", owner.cognito_sub)
    assert (await client.get(f"/locations/{created['id']}")).status_code == 200
    await _override_optional("admin", "admin-sub")
    assert (await client.get(f"/locations/{created['id']}")).status_code == 200


# ---------------------------------------------------------------------------
# setup_missing reflects the required info
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_setup_missing_shrinks_as_hours_are_entered(client, db_session, as_user):
    owner, brand = await _owned_brand(db_session)
    created = await _create_via_api(client, as_user, owner, brand)
    assert created["setup_missing"] == ["hours"]

    partial = await client.put(
        f"/locations/{created['id']}/hours", json=_hours_payload(days=range(5))
    )
    assert partial.status_code == 200, partial.text
    assert (await client.patch(f"/locations/{created['id']}", json={"city": "Frisco"})).json()[
        "setup_missing"
    ] == ["hours"]

    full = await client.put(f"/locations/{created['id']}/hours", json=_hours_payload())
    assert full.status_code == 200, full.text
    after = (await client.patch(f"/locations/{created['id']}", json={"city": "Plano"})).json()
    assert after["setup_missing"] == []


# ---------------------------------------------------------------------------
# Activation is server-gated
# ---------------------------------------------------------------------------


async def _activate(client, location_id: int):
    return await client.post(f"/locations/{location_id}/status", json={"status": "active"})


@pytest.mark.asyncio
async def test_activation_refused_without_hours(client, db_session, as_user):
    owner, brand = await _owned_brand(db_session)
    created = await _create_via_api(client, as_user, owner, brand)

    response = await _activate(client, created["id"])
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["code"] == "listing_incomplete"
    assert body["missing"] == ["hours"]
    assert "opening hours" in body["detail"]

    row = await db_session.get(RestaurantLocation, created["id"])
    await db_session.refresh(row)
    assert row.status == "coming_soon"
    status_audits = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.record_id == created["id"], AuditLog.action == "update"
            )
        )
    ).scalars().all()
    assert status_audits == []


@pytest.mark.asyncio
async def test_activation_refused_without_a_phone_and_lists_every_gap(client, db_session, as_user):
    owner, brand = await _owned_brand(db_session)
    location = await create_location(
        db_session, brand_id=brand.id, status="coming_soon", phone=None
    )
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)

    response = await _activate(client, location.id)
    assert response.status_code == 422
    assert response.json()["missing"] == ["phone", "hours"]


@pytest.mark.asyncio
async def test_activation_refused_for_a_legacy_non_us_phone(client, db_session, as_user):
    owner, brand = await _owned_brand(db_session)
    location = await create_location(
        db_session, brand_id=brand.id, status="coming_soon", phone="+442079460958"
    )
    await add_full_week_hours(db_session, location.id)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)

    response = await _activate(client, location.id)
    assert response.status_code == 422
    assert response.json()["missing"] == ["phone"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mutate",
    [
        pytest.param("drop_day", id="a-day-has-no-row"),
        pytest.param("unknown_day", id="a-day-is-unknown-null"),
        pytest.param("open_without_close", id="open-day-missing-close-time"),
    ],
)
async def test_incomplete_hours_shapes_are_refused(client, db_session, as_user, mutate):
    owner, brand = await _owned_brand(db_session)
    location = await create_location(db_session, brand_id=brand.id, status="coming_soon")
    await add_full_week_hours(db_session, location.id)
    await db_session.commit()

    rows = (
        await db_session.execute(
            select(RestaurantHours).where(RestaurantHours.location_id == location.id)
        )
    ).scalars().all()
    by_day = {r.day_of_week: r for r in rows}
    if mutate == "drop_day":
        await db_session.delete(by_day[3])
    elif mutate == "unknown_day":
        by_day[3].is_closed = None
        by_day[3].open_time = None
        by_day[3].close_time = None
    else:
        by_day[3].close_time = None
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)

    response = await _activate(client, location.id)
    assert response.status_code == 422, response.text
    assert response.json()["missing"] == ["hours"]


@pytest.mark.asyncio
async def test_activation_succeeds_when_complete_and_is_audited(client, db_session, as_user):
    owner, brand = await _owned_brand(db_session)
    created = await _create_via_api(client, as_user, owner, brand)
    put = await client.put(f"/locations/{created['id']}/hours", json=_hours_payload())
    assert put.status_code == 200, put.text

    response = await _activate(client, created["id"])
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "active"
    assert response.json()["setup_missing"] == []

    audits = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.table_name == "restaurant_location",
                AuditLog.record_id == created["id"],
                AuditLog.action == "update",
            )
        )
    ).scalars().all()
    (audit,) = [a for a in audits if a.new_val == {"status": "active"}]
    assert audit.old_val == {"status": "coming_soon"}
    assert audit.actor_id == owner.cognito_sub

    # Now public.
    _drop_auth_override()
    assert (await client.get(f"/locations/{created['id']}")).status_code == 200
    assert (await client.get("/sitemap/locations")).json()["total"] == 1


@pytest.mark.asyncio
async def test_admin_activation_is_gated_too(client, db_session, as_user):
    owner, brand = await _owned_brand(db_session)
    location = await create_location(db_session, brand_id=brand.id, status="coming_soon")
    await db_session.commit()
    as_user("admin")

    assert (await _activate(client, location.id)).status_code == 422
    await add_full_week_hours(db_session, location.id)
    await db_session.commit()
    assert (await _activate(client, location.id)).status_code == 200


@pytest.mark.asyncio
async def test_only_the_first_go_live_is_gated(client, db_session, as_user):
    """A previously-live listing hidden by its owner can be un-hidden without
    hours (seeded/imported listings have `is_closed = NULL` days) — unchanged."""
    owner, brand = await _owned_brand(db_session)
    location = await create_location(db_session, brand_id=brand.id, status="owner_deactivated")
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)

    response = await _activate(client, location.id)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "active"


@pytest.mark.asyncio
async def test_moving_a_setup_listing_to_hidden_needs_nothing(client, db_session, as_user):
    owner, brand = await _owned_brand(db_session)
    location = await create_location(db_session, brand_id=brand.id, status="coming_soon")
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)

    response = await client.post(
        f"/locations/{location.id}/status", json={"status": "owner_deactivated"}
    )
    assert response.status_code == 200, response.text


# ---------------------------------------------------------------------------
# Who may add a location (POST /locations)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_can_add_a_location_to_any_brand_in_setup_state(client, db_session, as_user):
    _owner, brand = await _owned_brand(db_session)
    admin = as_user("admin")

    response = await client.post("/locations", json=_create_body(brand.id))
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "coming_soon"

    audit = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.table_name == "restaurant_location",
                AuditLog.record_id == response.json()["id"],
                AuditLog.action == "create",
            )
        )
    ).scalar_one()
    assert audit.actor_id == admin.cognito_sub
    assert audit.actor_role == "admin"


@pytest.mark.asyncio
async def test_second_location_on_an_existing_brand_gets_its_own_slug(client, db_session, as_user):
    owner, brand = await _owned_brand(db_session, slug="spice-garden")
    first = await _create_via_api(client, as_user, owner, brand)
    second = await _create_via_api(
        client, as_user, owner, brand, address_line1="12 Elm St", city="Frisco"
    )
    assert first["brand_id"] == second["brand_id"] == brand.id
    assert first["slug"] != second["slug"]
    assert second["status"] == "coming_soon"


@pytest.mark.asyncio
async def test_other_owner_manager_and_diner_cannot_add_a_location(client, db_session, as_user):
    _owner, brand = await _owned_brand(db_session)
    other_owner = await create_owner(db_session)
    existing = await create_location(db_session, brand_id=brand.id)
    manager = await create_location_manager(db_session, location_id=existing.id, is_active=True)
    await db_session.commit()

    as_user("owner", sub=other_owner.cognito_sub)
    assert (await client.post("/locations", json=_create_body(brand.id))).status_code == 403

    as_user("manager", sub=manager.user_id)
    assert (await client.post("/locations", json=_create_body(brand.id))).status_code == 403

    as_user("registered_user")
    assert (await client.post("/locations", json=_create_body(brand.id))).status_code == 403


# ---------------------------------------------------------------------------
# Phone rule on the create/update API
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad", ["97255501420", "+44 20 7946 0958", "555-0142", "(972) 155-0142", "972-555-0142 x5"]
)
async def test_create_and_update_reject_non_us_or_11_digit_phones(client, db_session, as_user, bad):
    owner, brand = await _owned_brand(db_session)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)

    assert (await client.post("/locations", json=_create_body(brand.id, phone=bad))).status_code == 422
    assert (await client.patch(f"/locations/{location.id}", json={"phone": bad})).status_code == 422


@pytest.mark.asyncio
async def test_leading_country_code_is_normalised_on_create_and_update(client, db_session, as_user):
    owner, brand = await _owned_brand(db_session)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)

    created = await client.post("/locations", json=_create_body(brand.id, phone="1 (214) 555-0142"))
    assert created.status_code == 201, created.text
    assert created.json()["phone"] == "+12145550142"

    patched = await client.patch(f"/locations/{location.id}", json={"phone": "+1 972.555.0199"})
    assert patched.status_code == 200, patched.text
    assert patched.json()["phone"] == "+19725550199"


# ---------------------------------------------------------------------------
# Bulk import / seed defaults are unchanged
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bulk_import_still_creates_active_listings(db_session):
    owner = await create_owner(db_session)
    await db_session.commit()

    result = await bulk_import_restaurants(
        db_session,
        [
            RestaurantBasicDetailIn(
                name="Imported Kitchen",
                address_line1="1 Import Way",
                city="Irving",
                state="TX",
                postal_code="75038",
                phone="(972) 555-0101",
            )
        ],
        owner_id=owner.id,
        actor_id="admin-sub",
        actor_role="admin",
    )
    assert result.created == 1
    location = (await db_session.execute(select(RestaurantLocation))).scalar_one()
    assert location.status == "active"
    # Same US rule as every other phone field: stored canonical.
    assert location.phone == "+19725550101"


@pytest.mark.asyncio
async def test_bulk_import_reports_an_invalid_phone_per_row_and_keeps_going(db_session):
    owner = await create_owner(db_session)
    await db_session.commit()

    def row(name: str, phone: str | None) -> RestaurantBasicDetailIn:
        return RestaurantBasicDetailIn(
            name=name,
            address_line1=f"{name} Street",
            city="Irving",
            state="TX",
            postal_code="75038",
            phone=phone,
        )

    result = await bulk_import_restaurants(
        db_session,
        [row("Good One", "972-555-0102"), row("Bad Phone", "97255501420"), row("No Phone", None)],
        owner_id=owner.id,
        actor_id="admin-sub",
        actor_role="admin",
    )
    assert (result.created, result.errors) == (2, 1)
    bad = next(r for r in result.rows if r.name == "Bad Phone")
    assert bad.status.value == "error"
    assert "10-digit US phone" in bad.detail
    stored = {
        loc.address_line1: loc.phone
        for loc in (await db_session.execute(select(RestaurantLocation))).scalars().all()
    }
    assert stored == {"Good One Street": "+19725550102", "No Phone Street": None}
