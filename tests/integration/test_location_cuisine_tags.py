"""Integration tests: cuisine/dietary tags are PER LOCATION (`location_cuisine`,
migration 0016; docs/DECISIONS.md "Cuisine/dietary tags are per location").

Covers:
  - `PUT /locations/{id}/cuisine-tags`: owner / assigned manager / admin succeed;
    an unassigned manager, another owner, a registered user 403; anonymous 401;
    full replace, unknown/inactive ids ignored, `[]` clears, one audit row with
    before/after slugs, siblings untouched;
  - `GET /locations/{id}`, `/restaurants/by-slug/{brand}` cards, the by-slug
    location page and `GET /restaurants/{id}/locations` return THAT location's tags;
  - the brand-level `cuisine_tags` is the UNION of its locations' tags (public:
    active locations only; owner/admin: all), never read from the deprecated
    `restaurant_cuisine`;
  - `POST /locations`: explicit ids win, `[]` = none, omitted = copy of the
    brand's first existing location, first location of a brand starts empty;
  - `GET /search` semantics on SQLite (the PostGIS candidate query is swapped for
    an equivalent that applies the REAL per-location tag predicate): a filter
    matches only the locations that carry the tag, and the tile's tags are the
    nearest surviving location's own — including the dining-time case where only
    one of two branches serves breakfast;
  - follow list tags are the chosen location's tags.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

import app.main as app_main
from app.dependencies.auth import get_current_user_optional
from app.dependencies.pagination import Pagination
from app.models.audit_log import AuditLog
from app.models.location_cuisine import LocationCuisine
from app.models.restaurant_cuisine import RestaurantCuisine
from app.models.restaurant_location import RestaurantLocation
from app.services import cuisine_service, search_service
from factories import (
    create_brand,
    create_cuisine_tag,
    create_follow,
    create_location,
    create_location_manager,
    create_owner,
)


def _as_both(as_user, role, *, sub=None, email=None):
    user = as_user(role, sub=sub, email=email)

    async def _override():
        return user

    app_main.app.dependency_overrides[get_current_user_optional] = _override
    return user


async def _tags(db_session):
    """A small taxonomy: one tag per relevant category."""
    return {
        "andhra": await create_cuisine_tag(
            db_session, name="andhra", display_name="Andhra", category="regional"
        ),
        "nut_free": await create_cuisine_tag(
            db_session, name="nut_free", display_name="Nut Free", category="dietary"
        ),
        "breakfast": await create_cuisine_tag(
            db_session, name="breakfast_menu", display_name="Breakfast Menu", category="dining_time"
        ),
        "vegetarian": await create_cuisine_tag(
            db_session, name="vegetarian", display_name="Vegetarian", category="dietary"
        ),
    }


async def _link(db_session, location, *tags):
    for tag in tags:
        db_session.add(LocationCuisine(location_id=location.id, cuisine_tag_id=tag.id))
    await db_session.flush()


async def _two_branch_brand(db_session, **brand_kwargs):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True, **brand_kwargs)
    irving = await create_location(db_session, brand_id=brand.id, slug="irving", city="Irving")
    plano = await create_location(db_session, brand_id=brand.id, slug="plano", city="Plano")
    return owner, brand, irving, plano


def _names(rows):
    return sorted(t["name"] for t in rows)


# ---------------------------------------------------------------------------
# PUT /locations/{id}/cuisine-tags — permissions
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_owner_replaces_one_locations_tags_and_siblings_are_untouched(
    client, db_session, as_user
):
    tags = await _tags(db_session)
    owner, _brand, irving, plano = await _two_branch_brand(db_session)
    await _link(db_session, plano, tags["andhra"])
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    response = await client.put(
        f"/locations/{irving.id}/cuisine-tags",
        json={"cuisine_tag_ids": [tags["nut_free"].id, tags["breakfast"].id]},
    )
    assert response.status_code == 200, response.text
    assert _names(response.json()["results"]) == ["breakfast_menu", "nut_free"]

    plano_tags = await cuisine_service.get_location_cuisine_tags(db_session, plano.id)
    assert [t.name for t in plano_tags] == ["andhra"]  # sibling branch unchanged

    # Full replace, not merge.
    again = await client.put(
        f"/locations/{irving.id}/cuisine-tags", json={"cuisine_tag_ids": [tags["andhra"].id]}
    )
    assert _names(again.json()["results"]) == ["andhra"]


@pytest.mark.asyncio
async def test_unknown_inactive_and_duplicate_ids_are_ignored_and_empty_clears(
    client, db_session, as_user
):
    tags = await _tags(db_session)
    retired = await create_cuisine_tag(
        db_session, name="retired", display_name="Retired", category="type", is_active=False
    )
    owner, _brand, irving, _plano = await _two_branch_brand(db_session)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    response = await client.put(
        f"/locations/{irving.id}/cuisine-tags",
        json={"cuisine_tag_ids": [tags["andhra"].id, tags["andhra"].id, retired.id, 999999]},
    )
    assert response.status_code == 200, response.text
    assert _names(response.json()["results"]) == ["andhra"]

    cleared = await client.put(f"/locations/{irving.id}/cuisine-tags", json={"cuisine_tag_ids": []})
    assert cleared.status_code == 200
    assert cleared.json()["results"] == []


@pytest.mark.asyncio
async def test_write_is_audited_with_before_and_after(client, db_session, as_user):
    tags = await _tags(db_session)
    owner, _brand, irving, _plano = await _two_branch_brand(db_session)
    await _link(db_session, irving, tags["andhra"])
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    await client.put(
        f"/locations/{irving.id}/cuisine-tags", json={"cuisine_tag_ids": [tags["nut_free"].id]}
    )
    audit = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.table_name == "restaurant_location", AuditLog.record_id == irving.id
            )
        )
    ).scalar_one()
    assert audit.action == "update"
    assert audit.actor_id == owner.cognito_sub
    assert audit.old_val == {"cuisine_tags": ["andhra"]}
    assert audit.new_val == {"cuisine_tags": ["nut_free"]}


@pytest.mark.asyncio
async def test_assigned_manager_can_edit_but_unassigned_manager_cannot(
    client, db_session, as_user
):
    tags = await _tags(db_session)
    _owner, _brand, irving, plano = await _two_branch_brand(db_session)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=irving.id, user_id=manager_sub)
    await db_session.commit()
    as_user("manager", sub=manager_sub)

    ok = await client.put(
        f"/locations/{irving.id}/cuisine-tags", json={"cuisine_tag_ids": [tags["vegetarian"].id]}
    )
    assert ok.status_code == 200, ok.text
    forbidden = await client.put(
        f"/locations/{plano.id}/cuisine-tags", json={"cuisine_tag_ids": [tags["vegetarian"].id]}
    )
    assert forbidden.status_code == 403
    assert await cuisine_service.get_location_cuisine_tags(db_session, plano.id) == []


@pytest.mark.asyncio
async def test_admin_can_edit_any_location(client, db_session, as_user):
    tags = await _tags(db_session)
    _owner, _brand, irving, _plano = await _two_branch_brand(db_session)
    await db_session.commit()
    as_user("admin")

    response = await client.put(
        f"/locations/{irving.id}/cuisine-tags", json={"cuisine_tag_ids": [tags["andhra"].id]}
    )
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_other_owner_and_registered_user_forbidden_anonymous_unauthorized(
    client, db_session, as_user, as_anonymous
):
    tags = await _tags(db_session)
    _owner, _brand, irving, _plano = await _two_branch_brand(db_session)
    other_owner = await create_owner(db_session)
    await db_session.commit()
    body = {"cuisine_tag_ids": [tags["andhra"].id]}

    as_user("owner", sub=other_owner.cognito_sub, email=other_owner.email)
    assert (await client.put(f"/locations/{irving.id}/cuisine-tags", json=body)).status_code == 403

    as_user("registered_user")
    assert (await client.put(f"/locations/{irving.id}/cuisine-tags", json=body)).status_code == 403

    from app.dependencies.auth import get_current_user

    app_main.app.dependency_overrides.pop(get_current_user, None)
    assert (await client.put(f"/locations/{irving.id}/cuisine-tags", json=body)).status_code == 401
    assert await cuisine_service.get_location_cuisine_tags(db_session, irving.id) == []


@pytest.mark.asyncio
async def test_unknown_location_is_404(client, db_session, as_user):
    await _tags(db_session)
    await db_session.commit()
    as_user("admin")
    response = await client.put("/locations/987654/cuisine-tags", json={"cuisine_tag_ids": []})
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Reads: each surface shows THAT location's tags; brand = union
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_location_detail_landing_cards_and_page_show_each_branchs_own_tags(
    client, db_session, as_anonymous
):
    tags = await _tags(db_session)
    _owner, brand, irving, plano = await _two_branch_brand(db_session, slug="spice-garden")
    await _link(db_session, irving, tags["andhra"], tags["nut_free"])
    await _link(db_session, plano, tags["andhra"], tags["breakfast"])
    await db_session.commit()

    detail_irving = (await client.get(f"/locations/{irving.id}")).json()
    detail_plano = (await client.get(f"/locations/{plano.id}")).json()
    assert _names(detail_irving["cuisine_tags"]) == ["andhra", "nut_free"]
    assert _names(detail_plano["cuisine_tags"]) == ["andhra", "breakfast_menu"]

    landing = (await client.get("/restaurants/by-slug/spice-garden")).json()
    by_slug = {c["slug"]: c for c in landing["locations"]}
    assert _names(by_slug["irving"]["cuisine_tags"]) == ["andhra", "nut_free"]
    assert _names(by_slug["plano"]["cuisine_tags"]) == ["andhra", "breakfast_menu"]
    # Brand-level summary = union of the active branches.
    assert _names(landing["cuisine_tags"]) == ["andhra", "breakfast_menu", "nut_free"]

    page = (await client.get("/restaurants/by-slug/spice-garden/locations/plano")).json()
    assert _names(page["location"]["cuisine_tags"]) == ["andhra", "breakfast_menu"]
    assert _names(page["restaurant"]["cuisine_tags"]) == ["andhra", "breakfast_menu", "nut_free"]

    listing = (await client.get(f"/restaurants/{brand.id}/locations")).json()
    by_id = {r["id"]: r for r in listing["results"]}
    assert _names(by_id[irving.id]["cuisine_tags"]) == ["andhra", "nut_free"]
    assert _names(by_id[plano.id]["cuisine_tags"]) == ["andhra", "breakfast_menu"]


@pytest.mark.asyncio
async def test_public_brand_union_ignores_hidden_locations_owner_union_includes_them(
    client, db_session, as_user, as_anonymous
):
    tags = await _tags(db_session)
    owner, brand, irving, plano = await _two_branch_brand(db_session, slug="union-brand")
    plano.status = RestaurantLocation.STATUS_COMING_SOON
    await _link(db_session, irving, tags["andhra"])
    await _link(db_session, plano, tags["breakfast"])
    await db_session.commit()

    public = (await client.get(f"/restaurants/{brand.id}")).json()
    assert _names(public["cuisine_tags"]) == ["andhra"]  # hidden branch not advertised

    as_user("owner", sub=owner.cognito_sub, email=owner.email)
    mine = (await client.get("/restaurants")).json()["results"][0]
    assert _names(mine["cuisine_tags"]) == ["andhra", "breakfast_menu"]


@pytest.mark.asyncio
async def test_deprecated_restaurant_cuisine_is_never_read(client, db_session, as_anonymous):
    tags = await _tags(db_session)
    _owner, brand, irving, _plano = await _two_branch_brand(db_session, slug="old-table")
    db_session.add(RestaurantCuisine(brand_id=brand.id, cuisine_tag_id=tags["andhra"].id))
    await db_session.commit()

    assert (await client.get(f"/locations/{irving.id}")).json()["cuisine_tags"] == []
    assert (await client.get(f"/restaurants/{brand.id}")).json()["cuisine_tags"] == []


@pytest.mark.asyncio
async def test_brand_deleted_rules_unchanged(client, db_session, as_user, as_anonymous):
    tags = await _tags(db_session)
    _owner, brand, irving, _plano = await _two_branch_brand(db_session, slug="gone")
    await _link(db_session, irving, tags["andhra"])
    await db_session.commit()

    as_user("admin")
    assert (await client.delete(f"/restaurants/{brand.id}")).status_code == 204
    as_anonymous  # noqa: B018 - fixture reference
    from app.dependencies.auth import get_current_user

    app_main.app.dependency_overrides.pop(get_current_user, None)
    app_main.app.dependency_overrides.pop(get_current_user_optional, None)
    assert (await client.get(f"/locations/{irving.id}")).status_code == 404
    assert (await client.get(f"/restaurants/{brand.id}")).status_code == 404


# ---------------------------------------------------------------------------
# POST /locations — new-location tag rule
# ---------------------------------------------------------------------------


def _create_body(brand_id: int, **overrides) -> dict:
    body = {
        "brand_id": brand_id,
        "address_line1": "100 Main St",
        "city": "Frisco",
        "state": "TX",
        "postal_code": "75034",
        "phone": "(972) 555-0142",
    }
    body.update(overrides)
    return body


@pytest.mark.asyncio
async def test_first_location_starts_empty_and_explicit_ids_are_used(client, db_session, as_user):
    tags = await _tags(db_session)
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    first = await client.post("/locations", json=_create_body(brand.id))
    assert first.status_code == 201, first.text
    assert first.json()["cuisine_tags"] == []  # nothing to copy from

    explicit = await client.post(
        "/locations",
        json=_create_body(
            brand.id, address_line1="200 Oak Ave", cuisine_tag_ids=[tags["nut_free"].id]
        ),
    )
    assert _names(explicit.json()["cuisine_tags"]) == ["nut_free"]
    audit = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.table_name == "restaurant_location",
                AuditLog.record_id == explicit.json()["id"],
                AuditLog.action == "create",
            )
        )
    ).scalar_one()
    assert audit.new_val["cuisine_tags"] == ["nut_free"]


@pytest.mark.asyncio
async def test_new_location_copies_first_locations_tags_unless_told_otherwise(
    client, db_session, as_user
):
    tags = await _tags(db_session)
    owner, brand, irving, plano = await _two_branch_brand(db_session)
    # `irving` (lowest id) is the "first existing location"; plano differs.
    await _link(db_session, irving, tags["andhra"], tags["nut_free"])
    await _link(db_session, plano, tags["breakfast"])
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    copied = await client.post("/locations", json=_create_body(brand.id))
    assert copied.status_code == 201, copied.text
    assert _names(copied.json()["cuisine_tags"]) == ["andhra", "nut_free"]

    empty = await client.post(
        "/locations",
        json=_create_body(brand.id, address_line1="300 Elm St", cuisine_tag_ids=[]),
    )
    assert empty.json()["cuisine_tags"] == []
    # The source branches are untouched.
    irving_tags = await cuisine_service.get_location_cuisine_tags(db_session, irving.id)
    assert sorted(t.name for t in irving_tags) == ["andhra", "nut_free"]


# ---------------------------------------------------------------------------
# GET /search semantics (per-location filter, nearest location's tags)
# ---------------------------------------------------------------------------


def _install_sqlite_candidates(monkeypatch, db_session, distances: dict[int, float]):
    """Swap `_fetch_candidates`' PostGIS query for an equivalent SQLite one that
    applies the REAL per-location predicates from `cuisine_service` (exactly
    what `_fetch_candidates` puts in its WHERE), with canned distances."""

    async def _fetch(db, lat, lng, radius_mi, cuisine, dietary, type_, q=None):
        stmt = select(RestaurantLocation).where(RestaurantLocation.status == "active")
        for names in (cuisine, dietary, type_):
            if names:
                stmt = stmt.where(cuisine_service.location_has_any_tag(names))
        rows = (await db.execute(stmt)).scalars().all()
        return [
            search_service._CandidateRow(
                location_id=r.id,
                brand_id=r.brand_id,
                slug=r.slug,
                address_line1=r.address_line1,
                city=r.city,
                state=r.state,
                postal_code=r.postal_code,
                phone=r.phone,
                is_verified=r.is_verified,
                is_paid=r.is_paid,
                timezone=r.timezone,
                distance_mi=distances[r.id],
            )
            for r in rows
        ]

    monkeypatch.setattr(search_service, "_fetch_candidates", _fetch)


@pytest.mark.asyncio
async def test_search_breakfast_filter_returns_only_the_branch_that_serves_breakfast(
    db_session, monkeypatch
):
    tags = await _tags(db_session)
    _owner, brand, irving, plano = await _two_branch_brand(db_session)
    # Irving is the NEARER branch but does not serve breakfast; Plano does.
    await _link(db_session, irving, tags["andhra"])
    await _link(db_session, plano, tags["andhra"], tags["breakfast"])
    await db_session.commit()
    _install_sqlite_candidates(monkeypatch, db_session, {irving.id: 2.0, plano.id: 9.0})
    page = Pagination(page=1, page_size=20)

    results, total = await search_service.search(
        db_session, 32.8, -96.9, 15, ["breakfast_menu"], None, None, page
    )
    assert total == 1
    tile = results[0]
    assert tile.nearest_location.location_id == plano.id  # never Irving's address
    assert tile.nearest_location.city == plano.city
    assert tile.location_count_nearby == 1
    assert _names([t.model_dump() for t in tile.cuisine_tags]) == ["andhra", "breakfast_menu"]

    # Unfiltered: the nearest branch (Irving) and ITS OWN tags, both branches counted.
    results, total = await search_service.search(
        db_session, 32.8, -96.9, 15, None, None, None, page
    )
    assert total == 1
    tile = results[0]
    assert tile.nearest_location.location_id == irving.id
    assert tile.location_count_nearby == 2
    assert _names([t.model_dump() for t in tile.cuisine_tags]) == ["andhra"]


@pytest.mark.asyncio
async def test_search_facets_and_across_or_within_on_the_same_location(
    db_session, monkeypatch
):
    tags = await _tags(db_session)
    _owner, _brand, irving, plano = await _two_branch_brand(db_session)
    other_owner = await create_owner(db_session)
    other = await create_brand(db_session, owner_id=other_owner.id, is_claimed=True)
    elsewhere = await create_location(db_session, brand_id=other.id, slug="dallas", city="Dallas")
    # Irving: andhra only. Plano: nut_free only. So no single branch of the
    # brand has BOTH facets — the brand must NOT match cuisine=andhra AND
    # dietary=nut_free (a brand-level filter would have wrongly matched it).
    await _link(db_session, irving, tags["andhra"])
    await _link(db_session, plano, tags["nut_free"])
    await _link(db_session, elsewhere, tags["andhra"], tags["nut_free"])
    await db_session.commit()
    _install_sqlite_candidates(
        monkeypatch, db_session, {irving.id: 1.0, plano.id: 2.0, elsewhere.id: 3.0}
    )
    page = Pagination(page=1, page_size=20)

    results, total = await search_service.search(
        db_session, 32.8, -96.9, 15, ["andhra"], ["nut_free"], None, page
    )
    assert total == 1
    assert results[0].brand_id == other.id

    # OR within a facet: either branch qualifies, the nearest matching one leads.
    results, total = await search_service.search(
        db_session, 32.8, -96.9, 15, ["andhra", "nut_free"], None, None, page
    )
    by_brand = {r.brand_id: r for r in results}
    assert by_brand[_brand.id].nearest_location.location_id == irving.id
    assert by_brand[_brand.id].location_count_nearby == 2


@pytest.mark.asyncio
async def test_search_candidate_sql_filters_on_the_location_link_table():
    """The real `_fetch_candidates` statement: tag filters are evaluated on
    `restaurant_location.id` against `location_cuisine` — never the brand id,
    never the deprecated `restaurant_cuisine`."""
    from sqlalchemy.dialects import postgresql

    class _Capture:
        stmt = None

        async def execute(self, stmt):
            self.stmt = stmt

            class _R:
                def all(self):
                    return []

            return _R()

    for kwargs in (
        {"cuisine": ["andhra"], "q": None},
        {"cuisine": None, "q": "andhra"},
    ):
        db = _Capture()
        await search_service._fetch_candidates(
            db, 32.8, -96.9, 15, kwargs["cuisine"], ["nut_free"], None, kwargs["q"]
        )
        sql = str(db.stmt.compile(dialect=postgresql.dialect())).lower()
        assert "location_cuisine" in sql
        assert "restaurant_cuisine" not in sql
        assert "restaurant_location.id in (select location_cuisine.location_id" in sql


# ---------------------------------------------------------------------------
# Follow list
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_follow_tile_shows_the_chosen_locations_tags(client, db_session, as_user):
    tags = await _tags(db_session)
    _owner, brand, irving, plano = await _two_branch_brand(db_session)
    await _link(db_session, irving, tags["andhra"])
    await _link(db_session, plano, tags["breakfast"])
    sub = str(uuid.uuid4())
    await create_follow(db_session, user_id=sub, brand_id=brand.id)
    await db_session.commit()
    as_user("registered_user", sub=sub)

    row = (await client.get("/auth/me/follows")).json()["results"][0]
    # No deals -> the first (lowest id) active location = irving.
    assert row["nearest_location"]["location_id"] == irving.id
    assert _names(row["cuisine_tags"]) == ["andhra"]


# ---------------------------------------------------------------------------
# Deleting a location removes its links, not the tag or siblings' links
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_link_rows_cascade_with_the_location(client, db_session, as_user):
    tags = await _tags(db_session)
    owner, _brand, irving, plano = await _two_branch_brand(db_session)
    irving.status = RestaurantLocation.STATUS_OWNER_DEACTIVATED
    await _link(db_session, irving, tags["andhra"])
    await _link(db_session, plano, tags["andhra"])
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub, email=owner.email)

    assert (await client.delete(f"/locations/{irving.id}/permanent")).status_code == 204
    rows = (await db_session.execute(select(LocationCuisine))).scalars().all()
    assert [(r.location_id, r.cuisine_tag_id) for r in rows] == [(plano.id, tags["andhra"].id)]
