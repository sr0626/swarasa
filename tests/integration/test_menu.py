"""Integration tests: the menu engine (`menu_section` + `menu_item`) —
docs/API_CONTRACTS.md "Menu (`menu_section`, `menu_item`)".

Covers:
  - permissions matrix on every write route: owner of the brand, assigned
    manager, admin -> ok; unassigned manager / other owner / registered_user
    -> 403; anonymous -> 401.
  - validation: name/price mandatory + trimmed + length caps, description
    optional, section name required.
  - sizes: exactly one of price / sizes, size label + price required,
    1..6 sizes, switching pricing form on PATCH, round-trip, audit values.
  - audit_log row on EVERY write (create/update/delete/reorder/section
    delete/photo) for both tables.
  - reorder (sections, items in a group, stale-set 409), item moves between
    groups, per-location caps.
  - section delete: default ungroups its items (non-destructive),
    `?delete_items=true` deletes them.
  - public read: structured shape + ordering, ungrouped-first, free tier
    (no is_paid gate), 404 for non-active location / soft-deleted brand
    (owner + admin exceptions), no data leakage across locations.
  - photos: flag OFF (default) -> endpoints 403 `menu_photos_disabled` and
    NO photo URL anywhere; flag ON -> upload-url / attach / replace / remove
    work, key-shape validation, URLs appear.
  - hard-deleting a location that has menu rows still works (DB cascade).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

import app.main as app_main
from app.dependencies.auth import get_current_user_optional
from app.models.audit_log import AuditLog
from app.models.menu_item import MenuItem
from app.models.menu_section import MenuSection
from app.models.platform_config import PlatformConfig
from app.models.restaurant_location import RestaurantLocation
from app.schemas.menu import MAX_ITEMS_PER_LOCATION, MAX_SECTIONS_PER_LOCATION
from app.services import s3_service
from factories import (
    create_brand,
    create_location,
    create_location_manager,
    create_menu_item,
    create_menu_section,
    create_owner,
)


class _FakeS3Client:
    def generate_presigned_post(self, Bucket, Key, Fields=None, Conditions=None, ExpiresIn=None):
        return {
            "url": f"https://fake-s3.example.com/{Bucket}",
            "fields": {**(Fields or {}), "key": Key},
            "conditions": Conditions,
        }


@pytest.fixture(autouse=True)
def fake_s3(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("S3_MEDIA_BUCKET", "test-media-bucket")
    monkeypatch.setattr(s3_service, "_get_s3_client", lambda: _FakeS3Client())


def _as_both(as_user, role, *, sub=None):
    """Public GET routes depend on `get_current_user_optional`, not the
    `get_current_user` the `as_user` fixture overrides — override both."""
    user = as_user(role, sub=sub)

    async def _override():
        return user

    app_main.app.dependency_overrides[get_current_user_optional] = _override
    return user


async def _setup(db_session, **location_overrides):
    owner = await create_owner(db_session)
    brand = await create_brand(db_session, owner_id=owner.id, is_claimed=True)
    location = await create_location(db_session, brand_id=brand.id, **location_overrides)
    await db_session.commit()
    return owner, brand, location


async def _set_photos_flag(db_session, value):
    db_session.add(PlatformConfig(key="menu_item_photos_enabled", value=value))
    await db_session.commit()


async def _audits(db_session, table_name, record_id=None):
    stmt = select(AuditLog).where(AuditLog.table_name == table_name)
    if record_id is not None:
        stmt = stmt.where(AuditLog.record_id == record_id)
    return (await db_session.execute(stmt.order_by(AuditLog.id))).scalars().all()


def _base(location_id):
    return f"/locations/{location_id}/menu"


# ---------------------------------------------------------------------------
# Permissions matrix
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_owner_manager_admin_can_write_menu(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session)
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location.id, user_id=manager_sub, is_active=True)
    await db_session.commit()

    for role, sub in (("owner", owner.cognito_sub), ("manager", manager_sub), ("admin", None)):
        as_user(role, sub=sub)
        section = await client.post(f"{_base(location.id)}/sections", json={"name": f"By {role}"})
        assert section.status_code == 201, (role, section.text)
        item = await client.post(
            f"{_base(location.id)}/items", json={"name": f"Dish {role}", "price": "$9"}
        )
        assert item.status_code == 201, (role, item.text)


@pytest.mark.asyncio
async def test_forbidden_and_unauthorized_callers_cannot_write(client, db_session, as_user, as_anonymous):
    owner, brand, location = await _setup(db_session)
    other_owner = await create_owner(db_session)
    other_location = await create_location(db_session, brand_id=brand.id)
    unassigned_sub = str(uuid.uuid4())
    await create_location_manager(
        db_session, location_id=other_location.id, user_id=unassigned_sub, is_active=True
    )
    section = await create_menu_section(db_session, location_id=location.id)
    item = await create_menu_item(db_session, location_id=location.id)
    await db_session.commit()

    def requests():
        base = _base(location.id)
        return [
            ("post", f"{base}/sections", {"name": "X"}),
            ("patch", f"{base}/sections/{section.id}", {"name": "Y"}),
            ("delete", f"{base}/sections/{section.id}", None),
            ("put", f"{base}/sections/order", {"ids": [section.id]}),
            ("post", f"{base}/items", {"name": "X", "price": "$1"}),
            ("patch", f"{base}/items/{item.id}", {"name": "Y"}),
            ("delete", f"{base}/items/{item.id}", None),
            ("put", f"{base}/items/order", {"section_id": None, "ids": [item.id]}),
            ("post", f"{base}/photo-upload-url", {"content_type": "image/jpeg"}),
            ("put", f"{base}/items/{item.id}/photo", {"s3_key": "raw/x"}),
            ("delete", f"{base}/items/{item.id}/photo", None),
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

    as_anonymous  # noqa: B018 - fixture: drop any auth override
    from app.dependencies.auth import get_current_user

    app_main.app.dependency_overrides.pop(get_current_user, None)
    for method, url, body in requests():
        response = await send(method, url, body)
        assert response.status_code == 401, (method, url, response.text)

    # Nothing changed.
    assert (await db_session.execute(select(func.count()).select_from(MenuItem))).scalar_one() == 1


@pytest.mark.asyncio
async def test_cross_location_ids_are_404(client, db_session, as_user):
    owner, brand, location = await _setup(db_session)
    other = await create_location(db_session, brand_id=brand.id)
    foreign_section = await create_menu_section(db_session, location_id=other.id)
    foreign_item = await create_menu_item(db_session, location_id=other.id)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)

    base = _base(location.id)
    assert (await client.patch(f"{base}/sections/{foreign_section.id}", json={"name": "Z"})).status_code == 404
    assert (await client.delete(f"{base}/sections/{foreign_section.id}")).status_code == 404
    assert (await client.patch(f"{base}/items/{foreign_item.id}", json={"name": "Z"})).status_code == 404
    assert (await client.delete(f"{base}/items/{foreign_item.id}")).status_code == 404
    # Can't file an item under another location's group either.
    response = await client.post(
        f"{base}/items", json={"name": "Z", "price": "$1", "section_id": foreign_section.id}
    )
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Sections: CRUD + validation + audit
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_section_crud_and_audit(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session)
    as_user("owner", sub=owner.cognito_sub)
    base = _base(location.id)

    created = await client.post(
        f"{base}/sections", json={"name": "  Appetizers  ", "description": "  Served with chutney  "}
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["name"] == "Appetizers"  # trimmed
    assert body["description"] == "Served with chutney"
    assert body["display_order"] == 0
    section_id = body["id"]

    second = await client.post(f"{base}/sections", json={"name": "Main Course"})
    assert second.json()["display_order"] == 1
    assert second.json()["description"] is None

    patched = await client.patch(
        f"{base}/sections/{section_id}", json={"name": "Starters", "description": None}
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["name"] == "Starters"
    assert patched.json()["description"] is None

    assert (await client.delete(f"{base}/sections/{section_id}")).status_code == 204

    audits = await _audits(db_session, "menu_section", section_id)
    assert [a.action for a in audits] == ["create", "update", "delete"]
    assert audits[0].old_val is None and audits[0].new_val["name"] == "Appetizers"
    assert audits[1].old_val["description"] == "Served with chutney"
    assert audits[1].new_val["name"] == "Starters"
    assert audits[2].old_val["name"] == "Starters" and audits[2].new_val is None
    assert all(a.actor_id == owner.cognito_sub and a.actor_role == "owner" for a in audits)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"name": ""},
        {"name": "   "},
        {"name": "x" * 101},
        {"name": "ok", "description": "d" * 501},
    ],
)
async def test_section_validation_rejects_bad_input(client, db_session, as_user, payload):
    owner, _brand, location = await _setup(db_session)
    as_user("owner", sub=owner.cognito_sub)
    response = await client.post(f"{_base(location.id)}/sections", json=payload)
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "validation_error"


@pytest.mark.asyncio
async def test_section_patch_null_name_is_400_and_blank_description_clears(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session)
    section = await create_menu_section(db_session, location_id=location.id, description="old")
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)

    response = await client.patch(f"{_base(location.id)}/sections/{section.id}", json={"name": None})
    assert response.status_code == 400
    assert response.json()["code"] == "bad_request"

    response = await client.patch(f"{_base(location.id)}/sections/{section.id}", json={"description": "   "})
    assert response.status_code == 200
    assert response.json()["description"] is None


@pytest.mark.asyncio
async def test_section_cap(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session)
    for i in range(MAX_SECTIONS_PER_LOCATION):
        db_session.add(MenuSection(location_id=location.id, name=f"S{i}", display_order=i))
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)

    response = await client.post(f"{_base(location.id)}/sections", json={"name": "One too many"})
    assert response.status_code == 409
    assert response.json()["code"] == "menu_section_limit_reached"


# ---------------------------------------------------------------------------
# Items: CRUD + validation + audit
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_item_crud_and_audit(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session)
    section = await create_menu_section(db_session, location_id=location.id)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)
    base = _base(location.id)

    created = await client.post(
        f"{base}/items",
        json={
            "name": "  Chicken Biryani ",
            "description": "  Slow-cooked  ",
            "price": " Market price ",
            "section_id": section.id,
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["name"] == "Chicken Biryani"
    assert body["description"] == "Slow-cooked"
    assert body["price"] == "Market price"  # free text, trimmed, never parsed
    assert body["sizes"] is None
    assert body["section_id"] == section.id
    assert body["photo_url"] is None and body["photo_thumbnail_url"] is None
    item_id = body["id"]

    patched = await client.patch(
        f"{base}/items/{item_id}", json={"price": "12 / 18", "description": None}
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["price"] == "12 / 18"
    assert patched.json()["description"] is None

    assert (await client.delete(f"{base}/items/{item_id}")).status_code == 204
    assert (await db_session.get(MenuItem, item_id)) is None

    audits = await _audits(db_session, "menu_item", item_id)
    assert [a.action for a in audits] == ["create", "update", "delete"]
    assert audits[0].new_val["price"] == "Market price"
    assert audits[0].new_val["section_id"] == section.id
    assert audits[1].old_val["price"] == "Market price" and audits[1].new_val["price"] == "12 / 18"
    assert audits[2].old_val["price"] == "12 / 18" and audits[2].new_val is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        {"price": "$1"},  # name missing
        {"name": "", "price": "$1"},
        {"name": "   ", "price": "$1"},
        {"name": "x" * 151, "price": "$1"},
        {"name": "Dish"},  # neither price nor sizes
        {"name": "Dish", "price": ""},
        {"name": "Dish", "price": "   "},
        {"name": "Dish", "price": "p" * 51},
        {"name": "Dish", "price": "$1", "description": "d" * 1001},
    ],
)
async def test_item_validation_rejects_bad_input(client, db_session, as_user, payload):
    owner, _brand, location = await _setup(db_session)
    as_user("owner", sub=owner.cognito_sub)
    response = await client.post(f"{_base(location.id)}/items", json=payload)
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "validation_error"


@pytest.mark.asyncio
async def test_item_patch_null_name_is_400(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session)
    item = await create_menu_item(db_session, location_id=location.id)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)

    response = await client.patch(f"{_base(location.id)}/items/{item.id}", json={"name": None})
    assert response.status_code == 400
    assert response.json()["code"] == "bad_request"
    # An empty (post-trim) name is a plain validation error.
    response = await client.patch(f"{_base(location.id)}/items/{item.id}", json={"name": "  "})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_item_patch_cannot_clear_the_only_price(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session)
    item = await create_menu_item(db_session, location_id=location.id, price="$5")
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)

    response = await client.patch(f"{_base(location.id)}/items/{item.id}", json={"price": None})
    assert response.status_code == 400, response.text
    await db_session.refresh(item)
    assert item.price == "$5"


@pytest.mark.asyncio
async def test_item_cap(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session)
    for i in range(MAX_ITEMS_PER_LOCATION):
        db_session.add(MenuItem(location_id=location.id, name=f"I{i}", price="$1", display_order=i))
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)

    response = await client.post(f"{_base(location.id)}/items", json={"name": "Extra", "price": "$1"})
    assert response.status_code == 409
    assert response.json()["code"] == "menu_item_limit_reached"


# ---------------------------------------------------------------------------
# Sizes
# ---------------------------------------------------------------------------

_SIZES = [
    {"label": "Personal", "price": "$10"},
    {"label": "Double", "price": "$15"},
    {"label": "Family Pack", "price": "$25"},
]


@pytest.mark.asyncio
async def test_sized_item_round_trip_and_public_shape(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session)
    as_user("owner", sub=owner.cognito_sub)
    base = _base(location.id)

    created = await client.post(
        f"{base}/items",
        json={
            "name": "Veg Biryani",
            "sizes": [{"label": "  Personal ", "price": " $10 "}, *_SIZES[1:]],
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["price"] is None
    assert body["sizes"] == _SIZES  # trimmed, order preserved

    public = await client.get(base)
    assert public.status_code == 200
    item = public.json()["ungrouped_items"][0]
    assert item["price"] is None
    assert item["sizes"] == _SIZES


@pytest.mark.asyncio
async def test_sizes_rules_on_create(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session)
    as_user("owner", sub=owner.cognito_sub)
    url = f"{_base(location.id)}/items"

    bad_payloads = [
        # both a single price and sizes
        {"name": "D", "price": "$1", "sizes": _SIZES},
        # empty list
        {"name": "D", "sizes": []},
        # too many (>6)
        {"name": "D", "sizes": [{"label": f"S{i}", "price": "$1"} for i in range(7)]},
        # missing label / missing price / blank after trim
        {"name": "D", "sizes": [{"price": "$1"}]},
        {"name": "D", "sizes": [{"label": "Small"}]},
        {"name": "D", "sizes": [{"label": "  ", "price": "$1"}]},
        {"name": "D", "sizes": [{"label": "Small", "price": "  "}]},
        # length caps
        {"name": "D", "sizes": [{"label": "l" * 41, "price": "$1"}]},
        {"name": "D", "sizes": [{"label": "Small", "price": "p" * 51}]},
    ]
    for payload in bad_payloads:
        response = await client.post(url, json=payload)
        assert response.status_code == 422, (payload, response.text)

    # Boundary: exactly 6 sizes is fine.
    ok = await client.post(
        url, json={"name": "D", "sizes": [{"label": f"S{i}", "price": "$1"} for i in range(6)]}
    )
    assert ok.status_code == 201, ok.text
    assert len(ok.json()["sizes"]) == 6


@pytest.mark.asyncio
async def test_switching_price_form_on_patch(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session)
    item = await create_menu_item(db_session, location_id=location.id, price="$10")
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)
    url = f"{_base(location.id)}/items/{item.id}"

    # One price -> sizes: sending sizes clears the single price.
    to_sizes = await client.patch(url, json={"sizes": _SIZES})
    assert to_sizes.status_code == 200, to_sizes.text
    assert to_sizes.json()["price"] is None and to_sizes.json()["sizes"] == _SIZES

    # Sizes -> one price: sending price clears the sizes.
    to_price = await client.patch(url, json={"price": "$12"})
    assert to_price.status_code == 200, to_price.text
    assert to_price.json()["price"] == "$12" and to_price.json()["sizes"] is None

    # Explicit null for the other form alongside the new one is fine too.
    again = await client.patch(url, json={"price": None, "sizes": _SIZES[:2]})
    assert again.status_code == 200, again.text
    assert again.json()["sizes"] == _SIZES[:2] and again.json()["price"] is None

    # Both at once -> 422; clearing sizes without a price -> 400; empty list -> 422.
    assert (await client.patch(url, json={"price": "$1", "sizes": _SIZES})).status_code == 422
    assert (await client.patch(url, json={"sizes": None})).status_code == 400
    assert (await client.patch(url, json={"sizes": []})).status_code == 422
    assert (
        await client.patch(url, json={"sizes": [{"label": "A", "price": ""}]})
    ).status_code == 422

    # Editing only the name leaves the pricing untouched.
    renamed = await client.patch(url, json={"name": "Renamed"})
    assert renamed.status_code == 200
    assert renamed.json()["sizes"] == _SIZES[:2]

    # Audit trail carries the sizes in old/new values.
    audits = await _audits(db_session, "menu_item", item.id)
    assert audits[0].old_val["price"] == "$10" and audits[0].old_val["sizes"] is None
    assert audits[0].new_val["price"] is None and audits[0].new_val["sizes"] == _SIZES
    assert audits[1].old_val["sizes"] == _SIZES and audits[1].new_val["price"] == "$12"


@pytest.mark.asyncio
async def test_sized_item_create_audit_includes_sizes(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session)
    as_user("owner", sub=owner.cognito_sub)
    created = await client.post(
        f"{_base(location.id)}/items", json={"name": "Veg Biryani", "sizes": _SIZES}
    )
    audits = await _audits(db_session, "menu_item", created.json()["id"])
    assert audits[0].action == "create"
    assert audits[0].new_val["sizes"] == _SIZES
    assert audits[0].new_val["price"] is None


# ---------------------------------------------------------------------------
# Moving between groups + reorder
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_move_item_between_groups_appends_and_can_ungroup(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session)
    a = await create_menu_section(db_session, location_id=location.id, display_order=0)
    b = await create_menu_section(db_session, location_id=location.id, display_order=1)
    await create_menu_item(db_session, location_id=location.id, section_id=b.id, display_order=0)
    item = await create_menu_item(db_session, location_id=location.id, section_id=a.id, display_order=0)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)
    url = f"{_base(location.id)}/items/{item.id}"

    moved = await client.patch(url, json={"section_id": b.id})
    assert moved.status_code == 200
    assert moved.json()["section_id"] == b.id
    assert moved.json()["display_order"] == 1  # appended after the existing item

    ungrouped = await client.patch(url, json={"section_id": None})
    assert ungrouped.status_code == 200
    assert ungrouped.json()["section_id"] is None


@pytest.mark.asyncio
async def test_reorder_sections_and_items_with_audit(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session)
    s1 = await create_menu_section(db_session, location_id=location.id, name="A", display_order=0)
    s2 = await create_menu_section(db_session, location_id=location.id, name="B", display_order=1)
    s3 = await create_menu_section(db_session, location_id=location.id, name="C", display_order=2)
    i1 = await create_menu_item(db_session, location_id=location.id, section_id=s1.id, name="i1", display_order=0)
    i2 = await create_menu_item(db_session, location_id=location.id, section_id=s1.id, name="i2", display_order=1)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)
    base = _base(location.id)

    reordered = await client.put(f"{base}/sections/order", json={"ids": [s3.id, s1.id, s2.id]})
    assert reordered.status_code == 200, reordered.text
    assert [s["name"] for s in reordered.json()["sections"]] == ["C", "A", "B"]
    # s2 stayed at index... 2 (was 1) -> changed too; every changed row is audited.
    assert len(await _audits(db_session, "menu_section", s3.id)) == 1
    assert len(await _audits(db_session, "menu_section", s1.id)) == 1
    assert len(await _audits(db_session, "menu_section", s2.id)) == 1
    audit = (await _audits(db_session, "menu_section", s3.id))[0]
    assert audit.old_val["display_order"] == 2 and audit.new_val["display_order"] == 0

    swapped = await client.put(f"{base}/items/order", json={"section_id": s1.id, "ids": [i2.id, i1.id]})
    assert swapped.status_code == 200, swapped.text
    section_a = next(s for s in swapped.json()["sections"] if s["name"] == "A")
    assert [i["name"] for i in section_a["items"]] == ["i2", "i1"]
    assert len(await _audits(db_session, "menu_item", i1.id)) == 1


@pytest.mark.asyncio
async def test_reorder_rejects_stale_or_foreign_sets(client, db_session, as_user):
    owner, brand, location = await _setup(db_session)
    other = await create_location(db_session, brand_id=brand.id)
    s1 = await create_menu_section(db_session, location_id=location.id, display_order=0)
    s2 = await create_menu_section(db_session, location_id=location.id, display_order=1)
    foreign = await create_menu_section(db_session, location_id=other.id)
    i1 = await create_menu_item(db_session, location_id=location.id, section_id=s1.id)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)
    base = _base(location.id)

    # Missing one, or containing a foreign id -> 409, nothing reordered.
    missing = await client.put(f"{base}/sections/order", json={"ids": [s2.id]})
    assert missing.status_code == 409 and missing.json()["code"] == "menu_out_of_date"
    foreign_resp = await client.put(f"{base}/sections/order", json={"ids": [s1.id, s2.id, foreign.id]})
    assert foreign_resp.status_code == 409
    # Duplicate ids -> 422.
    dupes = await client.put(f"{base}/sections/order", json={"ids": [s1.id, s1.id]})
    assert dupes.status_code == 422
    # Item order for the wrong group (item lives in s1, not s2) -> 409.
    wrong_group = await client.put(f"{base}/items/order", json={"section_id": s2.id, "ids": [i1.id]})
    assert wrong_group.status_code == 409
    # Unknown section -> 404.
    unknown = await client.put(f"{base}/items/order", json={"section_id": foreign.id, "ids": []})
    assert unknown.status_code == 404
    assert await _audits(db_session, "menu_section") == []


# ---------------------------------------------------------------------------
# Section delete
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_section_default_moves_items_to_ungrouped(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session)
    section = await create_menu_section(db_session, location_id=location.id, name="Desserts")
    existing = await create_menu_item(db_session, location_id=location.id, name="Existing", display_order=0)
    a = await create_menu_item(db_session, location_id=location.id, section_id=section.id, name="A", display_order=0)
    b = await create_menu_item(db_session, location_id=location.id, section_id=section.id, name="B", display_order=1)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)

    response = await client.delete(f"{_base(location.id)}/sections/{section.id}")
    assert response.status_code == 204, response.text

    menu = (await client.get(_base(location.id))).json()
    assert menu["sections"] == []
    assert [i["name"] for i in menu["ungrouped_items"]] == ["Existing", "A", "B"]

    # Each moved item + the section itself is audited.
    a_audit = (await _audits(db_session, "menu_item", a.id))[0]
    assert a_audit.action == "update"
    assert a_audit.old_val["section_id"] == section.id and a_audit.new_val["section_id"] is None
    assert [x.action for x in await _audits(db_session, "menu_section", section.id)] == ["delete"]
    assert await _audits(db_session, "menu_item", existing.id) == []
    _ = b


@pytest.mark.asyncio
async def test_delete_section_with_delete_items_removes_them(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session)
    section = await create_menu_section(db_session, location_id=location.id)
    a = await create_menu_item(db_session, location_id=location.id, section_id=section.id)
    keep = await create_menu_item(db_session, location_id=location.id)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)

    response = await client.delete(f"{_base(location.id)}/sections/{section.id}?delete_items=true")
    assert response.status_code == 204, response.text
    assert await db_session.get(MenuItem, a.id) is None
    assert await db_session.get(MenuItem, keep.id) is not None
    assert [x.action for x in await _audits(db_session, "menu_item", a.id)] == ["delete"]
    assert [x.action for x in await _audits(db_session, "menu_section", section.id)] == ["delete"]


# ---------------------------------------------------------------------------
# Public read
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_public_menu_shape_order_and_free_tier(client, db_session, as_anonymous):
    _owner, _brand, location = await _setup(db_session, is_paid=False)
    other = await create_location(db_session, brand_id=_brand.id)
    s_main = await create_menu_section(
        db_session, location_id=location.id, name="Main Course", description="Rice extra", display_order=1
    )
    s_app = await create_menu_section(db_session, location_id=location.id, name="Appetizers", display_order=0)
    await create_menu_item(db_session, location_id=location.id, name="Z ungrouped", display_order=0)
    await create_menu_item(db_session, location_id=location.id, section_id=s_main.id, name="Curry", display_order=0)
    await create_menu_item(db_session, location_id=location.id, section_id=s_app.id, name="Samosa", display_order=1)
    await create_menu_item(db_session, location_id=location.id, section_id=s_app.id, name="Pakora", display_order=0)
    await create_menu_item(db_session, location_id=other.id, name="Other location dish")
    await db_session.commit()

    response = await client.get(_base(location.id))  # anonymous, free-tier location
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["location_id"] == location.id
    assert body["menu_photos_enabled"] is False
    assert [i["name"] for i in body["ungrouped_items"]] == ["Z ungrouped"]
    assert [s["name"] for s in body["sections"]] == ["Appetizers", "Main Course"]
    assert [i["name"] for i in body["sections"][0]["items"]] == ["Pakora", "Samosa"]
    assert body["sections"][1]["description"] == "Rice extra"
    assert body["sections"][0]["description"] is None
    assert all(i["price"] == "$10" for s in body["sections"] for i in s["items"])
    assert "Other location dish" not in response.text


@pytest.mark.asyncio
async def test_empty_menu_and_unknown_location(client, db_session, as_anonymous):
    _owner, _brand, location = await _setup(db_session)
    empty = await client.get(_base(location.id))
    assert empty.status_code == 200
    assert empty.json()["sections"] == [] and empty.json()["ungrouped_items"] == []
    assert (await client.get("/locations/999999/menu")).status_code == 404


@pytest.mark.asyncio
async def test_hidden_location_menu_404_for_public_visible_to_owner_and_admin(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session, status="owner_deactivated")
    await create_menu_item(db_session, location_id=location.id, name="Secret")
    manager_sub = str(uuid.uuid4())
    await create_location_manager(db_session, location_id=location.id, user_id=manager_sub, is_active=True)
    await db_session.commit()

    anon = await client.get(_base(location.id))
    assert anon.status_code == 404
    assert anon.json()["code"] == "not_found"

    _as_both(as_user, "registered_user")
    assert (await client.get(_base(location.id))).status_code == 404

    for role, sub in (("owner", owner.cognito_sub), ("manager", manager_sub), ("admin", None)):
        _as_both(as_user, role, sub=sub)
        response = await client.get(_base(location.id))
        assert response.status_code == 200, (role, response.text)
        assert response.json()["ungrouped_items"][0]["name"] == "Secret"


@pytest.mark.asyncio
async def test_soft_deleted_brand_menu_404_except_admin(client, db_session, as_user):
    owner, brand, location = await _setup(db_session)
    await create_menu_item(db_session, location_id=location.id)
    brand.deleted_at = datetime.now(timezone.utc)
    await db_session.commit()

    _as_both(as_user, "owner", sub=owner.cognito_sub)
    assert (await client.get(_base(location.id))).status_code == 404
    # ...and the owner's WRITE routes 404 as well (require_location_write_access).
    write = await client.post(f"{_base(location.id)}/items", json={"name": "N", "price": "$1"})
    assert write.status_code == 404

    _as_both(as_user, "admin")
    assert (await client.get(_base(location.id))).status_code == 200


# ---------------------------------------------------------------------------
# Photos: flag OFF (default) vs ON
# ---------------------------------------------------------------------------

_GOOD_KEY = "raw/locations/{lid}/menu/" + "a" * 32 + ".jpg"


@pytest.mark.asyncio
@pytest.mark.parametrize("flag_value", [None, "false", "garbage"])
async def test_photos_off_rejects_endpoints_and_exposes_no_urls(client, db_session, as_user, flag_value):
    owner, _brand, location = await _setup(db_session)
    # An item that ALREADY has stored photo keys (e.g. attached while the
    # flag was on): still must not surface while the flag is off.
    item = await create_menu_item(
        db_session,
        location_id=location.id,
        photo_s3_key="processed/locations/1/menu/x.jpg",
        photo_thumbnail_s3_key="thumbnails/locations/1/menu/x.jpg",
    )
    if flag_value is not None:
        await _set_photos_flag(db_session, flag_value)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)
    base = _base(location.id)

    upload = await client.post(f"{base}/photo-upload-url", json={"content_type": "image/jpeg"})
    assert upload.status_code == 403
    assert upload.json()["code"] == "menu_photos_disabled"
    attach = await client.put(
        f"{base}/items/{item.id}/photo", json={"s3_key": _GOOD_KEY.format(lid=location.id)}
    )
    assert attach.status_code == 403 and attach.json()["code"] == "menu_photos_disabled"
    remove = await client.delete(f"{base}/items/{item.id}/photo")
    assert remove.status_code == 403 and remove.json()["code"] == "menu_photos_disabled"

    # No photo URL in the public read, the management read (same endpoint),
    # or any write response.
    for response in (
        await client.get(base),
        await client.patch(f"{base}/items/{item.id}", json={"name": "Renamed"}),
        await client.post(f"{base}/items", json={"name": "New", "price": "$1"}),
    ):
        assert response.status_code in (200, 201)
        assert "processed/" not in response.text and "thumbnails/" not in response.text
        assert "media.test.example.com" not in response.text
    public = (await client.get(base)).json()
    assert public["menu_photos_enabled"] is False
    assert all(i["photo_url"] is None for i in public["ungrouped_items"])
    # The stored keys were untouched (flipping the flag back restores them).
    await db_session.refresh(item)
    assert item.photo_s3_key == "processed/locations/1/menu/x.jpg"


@pytest.mark.asyncio
async def test_photos_on_full_flow(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session)
    item = await create_menu_item(db_session, location_id=location.id)
    await _set_photos_flag(db_session, "true")
    as_user("owner", sub=owner.cognito_sub)
    base = _base(location.id)

    upload = await client.post(f"{base}/photo-upload-url", json={"content_type": "image/png"})
    assert upload.status_code == 200, upload.text
    body = upload.json()
    assert body["s3_key"].startswith(f"raw/locations/{location.id}/menu/")
    assert body["s3_key"].endswith(".png")
    assert body["fields"]["key"] == body["s3_key"]
    assert body["upload_url"].startswith("https://")

    bad_type = await client.post(f"{base}/photo-upload-url", json={"content_type": "application/pdf"})
    assert bad_type.status_code == 400 and bad_type.json()["code"] == "unsupported_content_type"

    attached = await client.put(f"{base}/items/{item.id}/photo", json={"s3_key": body["s3_key"]})
    assert attached.status_code == 200, attached.text
    processed = body["s3_key"].replace("raw/", "processed/", 1).replace(".png", ".jpg")
    thumb = body["s3_key"].replace("raw/", "thumbnails/", 1).replace(".png", ".jpg")
    assert attached.json()["photo_url"] == f"https://media.test.example.com/{processed}"
    assert attached.json()["photo_thumbnail_url"] == f"https://media.test.example.com/{thumb}"

    # Public read now carries it, and the flag.
    public = (await client.get(base)).json()
    assert public["menu_photos_enabled"] is True
    assert public["ungrouped_items"][0]["photo_url"] == f"https://media.test.example.com/{processed}"

    # Replace.
    second = await client.post(f"{base}/photo-upload-url", json={"content_type": "image/jpeg"})
    replaced = await client.put(f"{base}/items/{item.id}/photo", json={"s3_key": second.json()["s3_key"]})
    assert replaced.status_code == 200
    assert replaced.json()["photo_url"] != attached.json()["photo_url"]

    # Remove.
    removed = await client.delete(f"{base}/items/{item.id}/photo")
    assert removed.status_code == 200
    assert removed.json()["photo_url"] is None
    await db_session.refresh(item)
    assert item.photo_s3_key is None and item.photo_thumbnail_s3_key is None

    # attach, replace and remove each wrote an audit row on the item.
    audits = await _audits(db_session, "menu_item", item.id)
    assert [a.action for a in audits] == ["update", "update", "update"]
    assert audits[0].old_val["photo_s3_key"] is None and audits[0].new_val["photo_s3_key"] == processed


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "key",
    [
        "raw/locations/{other}/menu/" + "a" * 32 + ".jpg",  # another location's prefix
        "raw/locations/{lid}/photos/" + "a" * 32 + ".jpg",  # the gallery prefix, not menu
        "raw/locations/{lid}/menu/../photos/" + "a" * 32 + ".jpg",
        "raw/locations/{lid}/menu/notahexname.jpg",
        "raw/locations/{lid}/menu/" + "a" * 32 + ".gif",
        "processed/locations/{lid}/menu/" + "a" * 32 + ".jpg",
        "raw/locations/{lid}/menu/sub/" + "a" * 32 + ".jpg",
    ],
)
async def test_photo_attach_rejects_foreign_or_malformed_keys(client, db_session, as_user, key):
    owner, brand, location = await _setup(db_session)
    other = await create_location(db_session, brand_id=brand.id)
    item = await create_menu_item(db_session, location_id=location.id)
    await _set_photos_flag(db_session, "true")
    as_user("owner", sub=owner.cognito_sub)

    response = await client.put(
        f"{_base(location.id)}/items/{item.id}/photo",
        json={"s3_key": key.format(lid=location.id, other=other.id)},
    )
    assert response.status_code == 400, response.text
    assert response.json()["code"] == "invalid_s3_key"
    await db_session.refresh(item)
    assert item.photo_s3_key is None


# ---------------------------------------------------------------------------
# Location hard delete with menu rows
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_permanent_location_delete_cascades_menu(client, db_session, as_user):
    owner, _brand, location = await _setup(db_session, status="owner_deactivated")
    section = await create_menu_section(db_session, location_id=location.id)
    await create_menu_item(db_session, location_id=location.id, section_id=section.id)
    await create_menu_item(db_session, location_id=location.id)
    await db_session.commit()
    as_user("owner", sub=owner.cognito_sub)

    response = await client.delete(f"/locations/{location.id}/permanent")
    assert response.status_code == 204, response.text

    assert (
        await db_session.execute(select(RestaurantLocation).where(RestaurantLocation.id == location.id))
    ).scalar_one_or_none() is None
    for model in (MenuSection, MenuItem):
        count = (
            await db_session.execute(
                select(func.count()).select_from(model).where(model.location_id == location.id)
            )
        ).scalar_one()
        assert count == 0
