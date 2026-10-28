"""Integration tests: admin taxonomy management (`/admin/taxonomy`,
docs/API_CONTRACTS.md "Admin taxonomy management").

Covers: admin-only auth; list with usage counts + inactive rows; create
(explicit + derived slug, 201, audit row, generic 409 on slug / display-name
clash); rename; deactivate / reactivate (no data stripped, audit old/new);
no-op PATCH writes no audit; 404; no DELETE route; and the inactive-tag
visibility rules (public filter options, search predicate, public location
payload vs editor payload, PUT retention semantics).
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

import app.main as app_main
from app.dependencies.auth import get_current_user_optional
from app.models.audit_log import AuditLog
from app.models.cuisine_tag import CuisineTag
from app.models.location_cuisine import LocationCuisine
from app.services import cuisine_service
from factories import create_brand, create_cuisine_tag, create_location, create_owner


def _as_both(as_user, role, *, sub=None, email=None):
    """`GET /locations/{id}` resolves its caller via `get_current_user_optional`."""
    user = as_user(role, sub=sub, email=email)

    async def _override():
        return user

    app_main.app.dependency_overrides[get_current_user_optional] = _override
    return user


async def _audit(db_session, record_id: int) -> list[AuditLog]:
    rows = await db_session.execute(
        select(AuditLog)
        .where(AuditLog.table_name == "cuisine_tag", AuditLog.record_id == record_id)
        .order_by(AuditLog.id)
    )
    return list(rows.scalars().all())


async def _location_with_owner(db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id)
    return owner, location


@pytest.mark.asyncio
async def test_requires_admin(client, db_session, as_user, as_anonymous):
    assert (await client.get("/admin/taxonomy")).status_code in (401, 403)
    for role in ("owner", "manager", "registered_user"):
        as_user(role)
        assert (await client.get("/admin/taxonomy")).status_code == 403
        post = await client.post("/admin/taxonomy", json={"display_name": "X", "category": "type"})
        assert post.status_code == 403
        assert (await client.patch("/admin/taxonomy/1", json={"is_active": False})).status_code == 403


@pytest.mark.asyncio
async def test_list_has_usage_counts_inactive_rows_and_categories(client, db_session, as_user):
    owner, loc1 = await _location_with_owner(db_session)
    loc2 = await create_location(db_session, brand_id=loc1.brand_id, slug="second")
    used = await create_cuisine_tag(db_session, name="biryani", display_name="Biryani", category="signature")
    retired = await create_cuisine_tag(
        db_session, name="old_type", display_name="Old Type", category="type", is_active=False
    )
    unused = await create_cuisine_tag(db_session, name="dosa", display_name="Dosa", category="signature")
    for loc in (loc1, loc2):
        db_session.add(LocationCuisine(location_id=loc.id, cuisine_tag_id=used.id))
    db_session.add(LocationCuisine(location_id=loc1.id, cuisine_tag_id=retired.id))
    await db_session.commit()

    as_user("admin")
    resp = await client.get("/admin/taxonomy")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    by_name = {t["name"]: t for t in body["results"]}
    assert by_name["biryani"]["usage_count"] == 2
    assert by_name["old_type"]["usage_count"] == 1
    assert by_name["old_type"]["is_active"] is False
    assert by_name["dosa"]["usage_count"] == 0
    assert by_name["dosa"]["created_at"].endswith(("Z", "+00:00"))
    assert body["categories"] == ["regional", "dietary", "type", "signature", "dining_time"]
    assert unused.id == by_name["dosa"]["id"]


@pytest.mark.asyncio
async def test_create_tag_with_derived_slug_writes_audit(client, db_session, as_user):
    admin = as_user("admin")
    resp = await client.post(
        "/admin/taxonomy", json={"display_name": "  Street   Food Cart ", "category": "type"}
    )
    assert resp.status_code == 201, resp.text
    tag = resp.json()
    assert tag["name"] == "street_food_cart"
    assert tag["display_name"] == "Street Food Cart"
    assert tag["is_active"] is True
    assert tag["usage_count"] == 0

    audit = await _audit(db_session, tag["id"])
    assert len(audit) == 1
    assert audit[0].action == "create"
    assert audit[0].actor_id == admin.cognito_sub
    assert audit[0].actor_role == "admin"
    assert audit[0].old_val is None
    assert audit[0].new_val["name"] == "street_food_cart"

    # Now offered publicly.
    listed = await client.get("/cuisine-tags?category=type")
    assert "street_food_cart" in {t["name"] for t in listed.json()["results"]}


@pytest.mark.asyncio
async def test_create_tag_with_explicit_slug_and_validation(client, db_session, as_user):
    as_user("admin")
    ok = await client.post(
        "/admin/taxonomy", json={"display_name": "Pop-up", "category": "type", "name": "popup"}
    )
    assert ok.status_code == 201
    assert ok.json()["name"] == "popup"

    bad_slug = await client.post(
        "/admin/taxonomy", json={"display_name": "X", "category": "type", "name": "Bad Slug!"}
    )
    assert bad_slug.status_code == 422
    bad_cat = await client.post("/admin/taxonomy", json={"display_name": "X", "category": "nope"})
    assert bad_cat.status_code == 422
    blank = await client.post("/admin/taxonomy", json={"display_name": "   ", "category": "type"})
    assert blank.status_code == 422
    underivable = await client.post("/admin/taxonomy", json={"display_name": "!!!", "category": "type"})
    assert underivable.status_code == 422


@pytest.mark.asyncio
async def test_create_conflicts_return_generic_409(client, db_session, as_user):
    await create_cuisine_tag(db_session, name="biryani", display_name="Biryani", category="signature")
    await db_session.commit()
    as_user("admin")

    slug_clash = await client.post(
        "/admin/taxonomy", json={"display_name": "Different", "category": "type", "name": "biryani"}
    )
    assert slug_clash.status_code == 409
    assert slug_clash.json()["code"] == "conflict"
    assert "biryani" not in slug_clash.json()["detail"].lower()

    name_clash = await client.post(
        "/admin/taxonomy", json={"display_name": "BIRYANI", "category": "signature"}
    )
    assert name_clash.status_code == 409

    # Same display name in a different category is fine.
    other_cat = await client.post(
        "/admin/taxonomy", json={"display_name": "Biryani", "category": "type", "name": "biryani_type"}
    )
    assert other_cat.status_code == 201


@pytest.mark.asyncio
async def test_rename_updates_display_name_only_and_audits(client, db_session, as_user):
    tag = await create_cuisine_tag(db_session, name="chai", display_name="Chai", category="signature")
    await db_session.commit()
    admin = as_user("admin")

    resp = await client.patch(f"/admin/taxonomy/{tag.id}", json={"display_name": "Masala Chai"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["display_name"] == "Masala Chai"
    assert resp.json()["name"] == "chai"  # slug is immutable

    audit = await _audit(db_session, tag.id)
    assert [a.action for a in audit] == ["update"]
    assert audit[0].actor_id == admin.cognito_sub
    assert audit[0].old_val["display_name"] == "Chai"
    assert audit[0].new_val["display_name"] == "Masala Chai"


@pytest.mark.asyncio
async def test_rename_to_existing_name_in_category_is_409(client, db_session, as_user):
    a = await create_cuisine_tag(db_session, name="a_tag", display_name="Alpha", category="type")
    await create_cuisine_tag(db_session, name="b_tag", display_name="Beta", category="type")
    await db_session.commit()
    as_user("admin")

    clash = await client.patch(f"/admin/taxonomy/{a.id}", json={"display_name": "beta"})
    assert clash.status_code == 409
    # Renaming to its own name (case change) is not a clash.
    same = await client.patch(f"/admin/taxonomy/{a.id}", json={"display_name": "ALPHA"})
    assert same.status_code == 200


@pytest.mark.asyncio
async def test_deactivate_and_reactivate_keep_location_links(client, db_session, as_user):
    _, loc = await _location_with_owner(db_session)
    tag = await create_cuisine_tag(db_session, name="food_truck", display_name="Food Truck", category="type")
    db_session.add(LocationCuisine(location_id=loc.id, cuisine_tag_id=tag.id))
    await db_session.commit()
    as_user("admin")

    off = await client.patch(f"/admin/taxonomy/{tag.id}", json={"is_active": False})
    assert off.status_code == 200
    assert off.json()["is_active"] is False
    assert off.json()["usage_count"] == 1  # link NOT stripped

    links = (await db_session.execute(select(LocationCuisine))).scalars().all()
    assert len(links) == 1

    # Not offered in public filter options any more.
    listed = await client.get("/cuisine-tags")
    assert "food_truck" not in {t["name"] for t in listed.json()["results"]}

    on = await client.patch(f"/admin/taxonomy/{tag.id}", json={"is_active": True})
    assert on.json()["is_active"] is True
    listed = await client.get("/cuisine-tags")
    assert "food_truck" in {t["name"] for t in listed.json()["results"]}

    audit = await _audit(db_session, tag.id)
    assert [(a.old_val["is_active"], a.new_val["is_active"]) for a in audit] == [
        (True, False),
        (False, True),
    ]


@pytest.mark.asyncio
async def test_noop_patch_writes_no_audit_and_validation(client, db_session, as_user):
    tag = await create_cuisine_tag(db_session, name="lassi", display_name="Lassi", category="signature")
    await db_session.commit()
    as_user("admin")

    same = await client.patch(f"/admin/taxonomy/{tag.id}", json={"is_active": True})
    assert same.status_code == 200
    assert await _audit(db_session, tag.id) == []

    assert (await client.patch(f"/admin/taxonomy/{tag.id}", json={})).status_code == 422
    assert (await client.patch("/admin/taxonomy/999999", json={"is_active": False})).status_code == 404


@pytest.mark.asyncio
async def test_there_is_no_delete_route(client, db_session, as_user):
    tag = await create_cuisine_tag(db_session, name="kebab", display_name="Kebab", category="signature")
    await db_session.commit()
    as_user("admin")
    assert (await client.delete(f"/admin/taxonomy/{tag.id}")).status_code == 405
    assert await db_session.get(CuisineTag, tag.id) is not None


# --- Inactive-tag visibility -------------------------------------------------


@pytest.mark.asyncio
async def test_inactive_tag_hidden_from_public_but_visible_to_editor(client, db_session, as_user, as_anonymous):
    owner, loc = await _location_with_owner(db_session)
    live = await create_cuisine_tag(db_session, name="andhra", display_name="Andhra", category="regional")
    retired = await create_cuisine_tag(
        db_session, name="retired", display_name="Retired", category="type", is_active=False
    )
    db_session.add(LocationCuisine(location_id=loc.id, cuisine_tag_id=live.id))
    db_session.add(LocationCuisine(location_id=loc.id, cuisine_tag_id=retired.id))
    await db_session.commit()

    public = await client.get(f"/locations/{loc.id}")
    assert public.status_code == 200
    assert [t["name"] for t in public.json()["cuisine_tags"]] == ["andhra"]

    _as_both(as_user, "owner", sub=owner.cognito_sub, email=owner.email)
    mine = await client.get(f"/locations/{loc.id}")
    assert {t["name"] for t in mine.json()["cuisine_tags"]} == {"andhra", "retired"}

    # A different owner is NOT an editor of this location.
    other = await create_owner(db_session)
    await db_session.commit()
    _as_both(as_user, "owner", sub=other.cognito_sub, email=other.email)
    theirs = await client.get(f"/locations/{loc.id}")
    assert [t["name"] for t in theirs.json()["cuisine_tags"]] == ["andhra"]


@pytest.mark.asyncio
async def test_inactive_tag_does_not_match_search_predicates(db_session):
    _, loc = await _location_with_owner(db_session)
    retired = await create_cuisine_tag(
        db_session, name="retired", display_name="Retired", category="type", is_active=False
    )
    db_session.add(LocationCuisine(location_id=loc.id, cuisine_tag_id=retired.id))
    await db_session.commit()

    from app.models.restaurant_location import RestaurantLocation

    by_name = await db_session.execute(
        select(RestaurantLocation.id).where(cuisine_service.location_has_any_tag(["retired"]))
    )
    assert by_name.scalars().all() == []
    by_text = await db_session.execute(
        select(RestaurantLocation.id).where(cuisine_service.location_has_tag_named("Retired"))
    )
    assert by_text.scalars().all() == []


@pytest.mark.asyncio
async def test_put_keeps_resent_inactive_tag_drops_omitted_and_never_adds_new(
    client, db_session, as_user
):
    owner, loc = await _location_with_owner(db_session)
    live = await create_cuisine_tag(db_session, name="andhra", display_name="Andhra", category="regional")
    retired = await create_cuisine_tag(
        db_session, name="retired", display_name="Retired", category="type", is_active=False
    )
    never_had = await create_cuisine_tag(
        db_session, name="never", display_name="Never", category="type", is_active=False
    )
    db_session.add(LocationCuisine(location_id=loc.id, cuisine_tag_id=retired.id))
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    kept = await client.put(
        f"/locations/{loc.id}/cuisine-tags",
        json={"cuisine_tag_ids": [live.id, retired.id, never_had.id]},
    )
    assert kept.status_code == 200, kept.text
    assert sorted(t["name"] for t in kept.json()["results"]) == ["andhra", "retired"]

    dropped = await client.put(
        f"/locations/{loc.id}/cuisine-tags", json={"cuisine_tag_ids": [live.id]}
    )
    assert [t["name"] for t in dropped.json()["results"]] == ["andhra"]
