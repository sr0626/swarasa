"""Integration tests: hide/show for the menu (2026-09-24) — item
(`menu_item.is_hidden`), group (`menu_section.is_hidden`) and the ENTIRE
menu (`restaurant_location.menu_hidden`). Nothing is ever deleted; hidden
content stays in the management read (`GET …/menu/manage`) and is excluded
from the public read (`GET …/menu`).

Covers: defaults visible / existing rows unaffected, the visibility matrix
(item, group, entire menu; public vs management), un-hide restores exactly
what was visible before, permissions matrix (403 unassigned manager / other
owner / registered_user, 401 anonymous), audit_log old/new values, validation,
reorder still seeing hidden rows, cross-location ids, and the public
empty-state rule (everything hidden -> the public menu is empty).
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

import app.main as app_main
from app.dependencies.auth import get_current_user, get_current_user_optional
from app.models.audit_log import AuditLog
from app.models.menu_item import MenuItem
from app.models.menu_section import MenuSection
from app.models.restaurant_location import RestaurantLocation
from factories import (
    create_brand,
    create_location,
    create_location_manager,
    create_menu_item,
    create_menu_section,
    create_owner,
)


def _base(location_id: int) -> str:
    return f"/locations/{location_id}/menu"


async def _setup(db_session):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id)
    await db_session.commit()
    return owner, brand, location


async def _seed_menu(db_session, location_id: int):
    """One group with two items + one ungrouped item."""
    section = await create_menu_section(db_session, location_id=location_id, name="Mains", display_order=0)
    a = await create_menu_item(db_session, location_id=location_id, section_id=section.id, name="Biryani")
    b = await create_menu_item(
        db_session, location_id=location_id, section_id=section.id, name="Korma", display_order=1
    )
    loose = await create_menu_item(db_session, location_id=location_id, section_id=None, name="Chai")
    await db_session.commit()
    return section, a, b, loose


def _names(menu: dict) -> dict:
    return {
        "ungrouped": [i["name"] for i in menu["ungrouped_items"]],
        "sections": {s["name"]: [i["name"] for i in s["items"]] for s in menu["sections"]},
    }


async def _public(client, location_id):
    response = await client.get(_base(location_id))
    assert response.status_code == 200, response.text
    return response.json()


async def _manage(client, location_id):
    response = await client.get(f"{_base(location_id)}/manage")
    assert response.status_code == 200, response.text
    return response.json()


async def _audits(db_session, table_name, record_id):
    stmt = (
        select(AuditLog)
        .where(AuditLog.table_name == table_name, AuditLog.record_id == record_id)
        .order_by(AuditLog.id)
    )
    return (await db_session.execute(stmt)).scalars().all()


# ---------------------------------------------------------------------------
# Defaults + existing rows
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_everything_defaults_to_visible(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session)
    section, a, b, loose = await _seed_menu(db_session, location.id)
    as_user("owner", sub=owner.cognito_sub)

    # Rows created without any visibility input (i.e. every pre-existing row).
    assert (section.is_hidden, a.is_hidden, b.is_hidden, loose.is_hidden) == (False, False, False, False)
    assert location.menu_hidden is False

    public = await _public(client, location.id)
    assert public["menu_hidden"] is False
    assert _names(public) == {"ungrouped": ["Chai"], "sections": {"Mains": ["Biryani", "Korma"]}}
    assert all(i["is_hidden"] is False for i in public["ungrouped_items"])

    # Rows created through the API are visible too.
    created = await client.post(f"{_base(location.id)}/items", json={"name": "Lassi", "price": "$4"})
    assert created.status_code == 201
    assert created.json()["is_hidden"] is False
    created_section = await client.post(f"{_base(location.id)}/sections", json={"name": "Drinks"})
    assert created_section.json()["is_hidden"] is False


# ---------------------------------------------------------------------------
# Visibility matrix: item / group / entire menu, public vs management
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_hide_and_show_one_item(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session)
    section, a, b, loose = await _seed_menu(db_session, location.id)
    as_user("owner", sub=owner.cognito_sub)
    base = _base(location.id)

    hidden = await client.patch(f"{base}/items/{a.id}", json={"is_hidden": True})
    assert hidden.status_code == 200, hidden.text
    assert hidden.json()["is_hidden"] is True
    assert hidden.json()["name"] == "Biryani"  # nothing else changed

    public = await _public(client, location.id)
    assert _names(public) == {"ungrouped": ["Chai"], "sections": {"Mains": ["Korma"]}}
    assert "Biryani" not in str(public)

    manage = await _manage(client, location.id)
    assert _names(manage) == {"ungrouped": ["Chai"], "sections": {"Mains": ["Biryani", "Korma"]}}
    flags = {i["name"]: i["is_hidden"] for i in manage["sections"][0]["items"]}
    assert flags == {"Biryani": True, "Korma": False}

    # Hide an ungrouped one too.
    assert (await client.patch(f"{base}/items/{loose.id}", json={"is_hidden": True})).status_code == 200
    assert (await _public(client, location.id))["ungrouped_items"] == []

    shown = await client.patch(f"{base}/items/{a.id}", json={"is_hidden": False})
    assert shown.json()["is_hidden"] is False
    assert _names(await _public(client, location.id))["sections"] == {"Mains": ["Biryani", "Korma"]}

    # Nothing was deleted.
    assert (await db_session.execute(select(func.count()).select_from(MenuItem))).scalar_one() == 3


@pytest.mark.asyncio
async def test_hide_group_hides_its_items_and_show_restores_exactly(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session)
    section, a, b, loose = await _seed_menu(db_session, location.id)
    as_user("owner", sub=owner.cognito_sub)
    base = _base(location.id)

    # Korma is individually hidden BEFORE the group is hidden.
    assert (await client.patch(f"{base}/items/{b.id}", json={"is_hidden": True})).status_code == 200
    hidden = await client.patch(f"{base}/sections/{section.id}", json={"is_hidden": True})
    assert hidden.status_code == 200, hidden.text
    assert hidden.json()["is_hidden"] is True

    public = await _public(client, location.id)
    assert public["sections"] == []  # the hidden group AND its items are gone
    assert _names(public)["ungrouped"] == ["Chai"]
    assert "Mains" not in str(public) and "Biryani" not in str(public)

    manage = await _manage(client, location.id)
    assert manage["sections"][0]["is_hidden"] is True
    assert [i["name"] for i in manage["sections"][0]["items"]] == ["Biryani", "Korma"]

    # The items' own flags were untouched by hiding the group...
    await db_session.refresh(a)
    await db_session.refresh(b)
    assert (a.is_hidden, b.is_hidden) == (False, True)

    # ...so showing the group restores exactly what was visible before.
    assert (await client.patch(f"{base}/sections/{section.id}", json={"is_hidden": False})).status_code == 200
    assert _names(await _public(client, location.id))["sections"] == {"Mains": ["Biryani"]}
    assert (await db_session.execute(select(func.count()).select_from(MenuSection))).scalar_one() == 1


@pytest.mark.asyncio
async def test_hide_entire_menu_and_show_again(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session)
    section, a, b, loose = await _seed_menu(db_session, location.id)
    as_user("owner", sub=owner.cognito_sub)
    base = _base(location.id)

    # An individually-hidden item must stay hidden after the menu is re-shown.
    assert (await client.patch(f"{base}/items/{b.id}", json={"is_hidden": True})).status_code == 200

    hidden = await client.put(f"{base}/visibility", json={"is_hidden": True})
    assert hidden.status_code == 200, hidden.text
    assert hidden.json() == {"location_id": location.id, "is_hidden": True}

    public = await _public(client, location.id)
    assert public["menu_hidden"] is True
    assert public["ungrouped_items"] == [] and public["sections"] == []
    assert "Chai" not in str(public) and "Mains" not in str(public)

    manage = await _manage(client, location.id)
    assert manage["menu_hidden"] is True
    assert _names(manage) == {"ungrouped": ["Chai"], "sections": {"Mains": ["Biryani", "Korma"]}}

    shown = await client.put(f"{base}/visibility", json={"is_hidden": False})
    assert shown.json()["is_hidden"] is False
    public = await _public(client, location.id)
    assert public["menu_hidden"] is False
    assert _names(public) == {"ungrouped": ["Chai"], "sections": {"Mains": ["Biryani"]}}


@pytest.mark.asyncio
async def test_public_read_never_shows_hidden_even_to_the_owner(client, db_session, as_user):
    """The public page passes the visitor's token; an owner previewing their
    own page must see what diners see (the editor uses `/manage`)."""
    owner, _brand, location = await _setup(db_session)
    section, a, b, loose = await _seed_menu(db_session, location.id)
    as_user("owner", sub=owner.cognito_sub)
    assert (await client.patch(f"{_base(location.id)}/items/{a.id}", json={"is_hidden": True})).status_code == 200

    user = as_user("owner", sub=owner.cognito_sub)

    async def _override():
        return user

    app_main.app.dependency_overrides[get_current_user_optional] = _override
    assert _names(await _public(client, location.id))["sections"] == {"Mains": ["Korma"]}


@pytest.mark.asyncio
async def test_everything_hidden_leaves_an_empty_public_menu(client, db_session, as_user, as_anonymous):
    owner, _brand, location = await _setup(db_session)
    section, a, b, loose = await _seed_menu(db_session, location.id)
    as_user("owner", sub=owner.cognito_sub)
    base = _base(location.id)
    for item in (a, b, loose):
        assert (await client.patch(f"{base}/items/{item.id}", json={"is_hidden": True})).status_code == 200

    app_main.app.dependency_overrides.pop(get_current_user, None)
    public = await _public(client, location.id)
    # Empty lists -> the public page renders no Menu section at all.
    assert public["ungrouped_items"] == []
    assert [s["items"] for s in public["sections"]] == [[]]  # the (visible) group with no visible items

    # Hiding the group as well drops it from the public read entirely.
    as_user("owner", sub=owner.cognito_sub)
    assert (await client.patch(f"{base}/sections/{section.id}", json={"is_hidden": True})).status_code == 200
    app_main.app.dependency_overrides.pop(get_current_user, None)
    public = await _public(client, location.id)
    assert public["ungrouped_items"] == [] and public["sections"] == []


@pytest.mark.asyncio
async def test_hiding_is_scoped_to_its_own_location(client, db_session, as_user):
    owner, brand, location = await _setup(db_session)
    other = await create_location(db_session, brand_id=brand.id)
    await create_menu_item(db_session, location_id=other.id, name="Other dish")
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)

    assert (await client.put(f"{_base(location.id)}/visibility", json={"is_hidden": True})).status_code == 200
    assert _names(await _public(client, other.id))["ungrouped"] == ["Other dish"]


@pytest.mark.asyncio
async def test_reorder_still_sees_hidden_rows(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session)
    section, a, b, loose = await _seed_menu(db_session, location.id)
    as_user("owner", sub=owner.cognito_sub)
    base = _base(location.id)
    assert (await client.patch(f"{base}/items/{a.id}", json={"is_hidden": True})).status_code == 200

    # The FULL set (hidden included) is what reorder expects, and the
    # response is the management view (hidden rows present + flagged).
    reordered = await client.put(
        f"{base}/items/order", json={"section_id": section.id, "ids": [b.id, a.id]}
    )
    assert reordered.status_code == 200, reordered.text
    items = reordered.json()["sections"][0]["items"]
    assert [(i["name"], i["is_hidden"]) for i in items] == [("Korma", False), ("Biryani", True)]
    assert _names(await _public(client, location.id))["sections"] == {"Mains": ["Korma"]}


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_is_hidden_validation(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session)
    section, a, _b, _loose = await _seed_menu(db_session, location.id)
    as_user("owner", sub=owner.cognito_sub)
    base = _base(location.id)

    assert (await client.patch(f"{base}/items/{a.id}", json={"is_hidden": None})).status_code == 400
    assert (await client.patch(f"{base}/sections/{section.id}", json={"is_hidden": None})).status_code == 400
    assert (await client.patch(f"{base}/items/{a.id}", json={"is_hidden": "maybe"})).status_code == 422
    assert (await client.put(f"{base}/visibility", json={})).status_code == 422
    assert (await client.put(f"{base}/visibility", json={"is_hidden": None})).status_code == 422
    await db_session.refresh(a)
    assert a.is_hidden is False


# ---------------------------------------------------------------------------
# Permissions matrix
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_owner_manager_admin_can_toggle_visibility(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session)
    section, a, _b, _loose = await _seed_menu(db_session, location.id)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location.id, user_id=manager_sub, is_active=True)
    await db_session.commit()
    base = _base(location.id)

    for role, sub in (("owner", owner.cognito_sub), ("manager", manager_sub), ("admin", None)):
        as_user(role, sub=sub)
        assert (await client.patch(f"{base}/items/{a.id}", json={"is_hidden": True})).status_code == 200, role
        assert (await client.patch(f"{base}/items/{a.id}", json={"is_hidden": False})).status_code == 200, role
        assert (await client.patch(f"{base}/sections/{section.id}", json={"is_hidden": True})).status_code == 200, role
        assert (await client.patch(f"{base}/sections/{section.id}", json={"is_hidden": False})).status_code == 200, role
        assert (await client.put(f"{base}/visibility", json={"is_hidden": True})).status_code == 200, role
        assert (await client.put(f"{base}/visibility", json={"is_hidden": False})).status_code == 200, role
        assert (await client.get(f"{base}/manage")).status_code == 200, role


@pytest.mark.asyncio
async def test_unauthorized_callers_cannot_toggle_or_read_management_view(
    client, db_session, as_user, as_anonymous
):
    owner, brand, location = await _setup(db_session)
    other_owner = await create_owner(db_session)
    other_location = await create_location(db_session, brand_id=brand.id)
    unassigned_sub = str(uuid.uuid4())
    await create_location_manager(
        db_session, location_id=other_location.id, user_id=unassigned_sub, is_active=True
    )
    section, a, _b, _loose = await _seed_menu(db_session, location.id)
    base = _base(location.id)

    def requests():
        return [
            ("patch", f"{base}/items/{a.id}", {"is_hidden": True}),
            ("patch", f"{base}/sections/{section.id}", {"is_hidden": True}),
            ("put", f"{base}/visibility", {"is_hidden": True}),
            ("get", f"{base}/manage", None),
        ]

    async def send(method, url, body):
        kwargs = {"json": body} if body is not None else {}
        return await getattr(client, method)(url, **kwargs)

    for role, sub in (
        ("manager", unassigned_sub),  # assigned to a DIFFERENT location
        ("owner", other_owner.cognito_sub),  # someone else's brand
        ("registered_user", None),
    ):
        as_user(role, sub=sub)
        for method, url, body in requests():
            response = await send(method, url, body)
            assert response.status_code == 403, (role, method, url, response.text)

    app_main.app.dependency_overrides.pop(get_current_user, None)
    for method, url, body in requests():
        response = await send(method, url, body)
        assert response.status_code == 401, (method, url, response.text)

    # Nothing changed anywhere.
    await db_session.refresh(a)
    await db_session.refresh(section)
    await db_session.refresh(location)
    assert (a.is_hidden, section.is_hidden, location.menu_hidden) == (False, False, False)


@pytest.mark.asyncio
async def test_cross_location_ids_are_404(client, db_session, as_user):
    owner, brand, location = await _setup(db_session)
    other = await create_location(db_session, brand_id=brand.id)
    foreign_section = await create_menu_section(db_session, location_id=other.id)
    foreign_item = await create_menu_item(db_session, location_id=other.id)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)
    base = _base(location.id)

    assert (await client.patch(f"{base}/items/{foreign_item.id}", json={"is_hidden": True})).status_code == 404
    assert (
        await client.patch(f"{base}/sections/{foreign_section.id}", json={"is_hidden": True})
    ).status_code == 404
    await db_session.refresh(foreign_item)
    assert foreign_item.is_hidden is False


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_visibility_changes_are_audited_with_old_and_new_values(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session)
    section, a, _b, _loose = await _seed_menu(db_session, location.id)
    as_user("owner", sub=owner.cognito_sub)
    base = _base(location.id)

    await client.patch(f"{base}/items/{a.id}", json={"is_hidden": True})
    await client.patch(f"{base}/items/{a.id}", json={"is_hidden": False})
    item_audits = await _audits(db_session, "menu_item", a.id)
    assert [(x.action, x.old_val["is_hidden"], x.new_val["is_hidden"]) for x in item_audits] == [
        ("update", False, True),
        ("update", True, False),
    ]
    assert item_audits[0].actor_id == owner.cognito_sub and item_audits[0].actor_role == "owner"

    await client.patch(f"{base}/sections/{section.id}", json={"is_hidden": True})
    section_audits = await _audits(db_session, "menu_section", section.id)
    assert [(x.old_val["is_hidden"], x.new_val["is_hidden"]) for x in section_audits] == [(False, True)]

    await client.put(f"{base}/visibility", json={"is_hidden": True})
    await client.put(f"{base}/visibility", json={"is_hidden": True})  # idempotent: no second row
    await client.put(f"{base}/visibility", json={"is_hidden": False})
    location_audits = await _audits(db_session, "restaurant_location", location.id)
    assert [(x.action, x.old_val, x.new_val) for x in location_audits] == [
        ("update", {"menu_hidden": False}, {"menu_hidden": True}),
        ("update", {"menu_hidden": True}, {"menu_hidden": False}),
    ]

    fresh = await db_session.get(RestaurantLocation, location.id)
    await db_session.refresh(fresh)
    assert fresh.menu_hidden is False
