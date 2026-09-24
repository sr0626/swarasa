"""Menu (`menu_section` + `menu_item`) — CRUD, reorder, the public structured
read, and the flag-gated item photos. See docs/API_CONTRACTS.md "Menu" and
the model docstrings for the schema design.

Access control for every WRITE lives upstream, in the router's
`require_location_write_access` dependency (owner of the parent brand /
actively-assigned manager / admin — same pattern as deals, photos, hours);
this module trusts that a `current_user` reaching it is already authorized
for `location_id`, and only re-verifies that the section/item ids in the
request actually belong to that location (so `/locations/1/menu/items/9`
can never touch location 2's item).

The READ (`get_menu`) is PUBLIC and free-tier: the full menu with prices is
never gated on `is_paid` (docs/DECISIONS.md "Full menu with prices moved to
free tier"). It reuses `location_service.get_readable_location_or_404`, so a
non-`active` location or a soft-deleted brand's menu 404s for the public
exactly like `GET /locations/{id}` does.

Photos — built, switched OFF. `menu_item_photos_enabled` (platform_config,
default OFF) gates the whole photo capability: while off, the photo
endpoints reject with `403 menu_photos_disabled` and NO response ever
carries a photo URL (public or management). Stored photo keys are kept, so
flipping the flag back on restores them. FUTURE INTENT (not implemented, no
`is_paid` logic here yet): when paid tiers exist, gate by the location's
`is_paid` as well as this flag.

Every write on `menu_section` / `menu_item` writes an `audit_log` row in the
same transaction (root CLAUDE.md "ALWAYS — Quality"); snapshots include the
item's `price` AND `sizes`.

Visibility (added 2026-09-24, docs/DECISIONS.md "Hide menu / hide deals"):
nothing is ever deleted to hide it. Three independent, non-destructive
switches — `menu_item.is_hidden`, `menu_section.is_hidden` (hides the group
AND its items, leaving the items' own flags untouched so un-hiding restores
exactly what was visible before) and `restaurant_location.menu_hidden` (the
entire menu). ALL public-facing menu content goes through `build_menu(...,
include_hidden=False)` — the one place the rule is applied — so the public
read, the JSON-LD and the "empty menu renders no section" rule all follow
from a single filter. The management read (`GET …/menu/manage`, write
access required) uses `include_hidden=True` and reports the flags so the
editor can show a clear "Hidden" state and a one-click Show.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.menu_item import MenuItem
from app.models.menu_section import MenuSection
from app.models.restaurant_location import RestaurantLocation
from app.schemas.menu import (
    MAX_ITEMS_PER_LOCATION,
    MAX_SECTIONS_PER_LOCATION,
    MenuItemCreate,
    MenuItemOrder,
    MenuItemOut,
    MenuItemUpdate,
    MenuOut,
    MenuPhotoAttach,
    MenuSectionCreate,
    MenuSectionOrder,
    MenuSectionOut,
    MenuSectionUpdate,
    MenuSectionWithItemsOut,
    MenuSizeOut,
    MenuVisibilityOut,
)
from app.schemas.photo import UploadUrlResponse
from app.services import audit_service, location_service, platform_config_service, s3_service

_SECTION_AUDITED_FIELDS = ("name", "description", "display_order", "is_hidden")
_ITEM_AUDITED_FIELDS = (
    "section_id",
    "name",
    "description",
    "price",
    "sizes",
    "display_order",
    "photo_s3_key",
    "photo_thumbnail_s3_key",
    "is_hidden",
)


# ---------------------------------------------------------------------------
# Flag + shared helpers
# ---------------------------------------------------------------------------


async def photos_enabled(db: AsyncSession) -> bool:
    """The platform-level `menu_item_photos_enabled` flag. Default OFF: a
    missing row, an empty value or unparsable text all read as False."""
    return await platform_config_service.get_config_bool(
        db, platform_config_service.MENU_ITEM_PHOTOS_ENABLED_KEY, default=False
    )


async def _require_photos_enabled(db: AsyncSession) -> None:
    if not await photos_enabled(db):
        # Generic on purpose (never says how to enable it).
        raise AppError(403, "Menu item photos are not available.", "menu_photos_disabled")


def _section_snapshot(section: MenuSection) -> dict[str, Any]:
    return {field: getattr(section, field) for field in _SECTION_AUDITED_FIELDS}


def _item_snapshot(item: MenuItem) -> dict[str, Any]:
    """JSON-safe before/after snapshot for audit_log — includes `sizes`
    (a fresh list of plain dicts, so a later in-place edit can't mutate an
    already-captured snapshot)."""
    data = {field: getattr(item, field) for field in _ITEM_AUDITED_FIELDS}
    if item.sizes is not None:
        data["sizes"] = [dict(size) for size in item.sizes]
    return data


def _section_out(section: MenuSection) -> MenuSectionOut:
    return MenuSectionOut(
        id=section.id,
        location_id=section.location_id,
        name=section.name,
        description=section.description,
        display_order=section.display_order,
        is_hidden=section.is_hidden,
    )


def _item_out(item: MenuItem, photos_on: bool) -> MenuItemOut:
    photo_url: str | None = None
    photo_thumbnail_url: str | None = None
    if photos_on and item.photo_s3_key:
        photo_url = s3_service.resolve_media_url(item.photo_s3_key)
        photo_thumbnail_url = s3_service.resolve_media_url(
            item.photo_thumbnail_s3_key or item.photo_s3_key
        )
    return MenuItemOut(
        id=item.id,
        location_id=item.location_id,
        section_id=item.section_id,
        name=item.name,
        description=item.description,
        price=item.price,
        sizes=(
            [MenuSizeOut(label=s["label"], price=s["price"]) for s in item.sizes]
            if item.sizes is not None
            else None
        ),
        display_order=item.display_order,
        photo_url=photo_url,
        photo_thumbnail_url=photo_thumbnail_url,
        is_hidden=item.is_hidden,
    )


async def _get_location_or_404(db: AsyncSession, location_id: int) -> RestaurantLocation:
    location = await db.get(RestaurantLocation, location_id)
    if location is None:
        raise AppError(404, "Location not found", "not_found")
    return location


async def _get_section_or_404(db: AsyncSession, location_id: int, section_id: int) -> MenuSection:
    section = await db.get(MenuSection, section_id)
    if section is None or section.location_id != location_id:
        raise AppError(404, "Menu group not found", "not_found")
    return section


async def _get_item_or_404(db: AsyncSession, location_id: int, item_id: int) -> MenuItem:
    item = await db.get(MenuItem, item_id)
    if item is None or item.location_id != location_id:
        raise AppError(404, "Menu item not found", "not_found")
    return item


async def _next_section_order(db: AsyncSession, location_id: int) -> int:
    current = (
        await db.execute(
            select(func.max(MenuSection.display_order)).where(MenuSection.location_id == location_id)
        )
    ).scalar_one_or_none()
    return 0 if current is None else current + 1


async def _next_item_order(db: AsyncSession, location_id: int, section_id: int | None) -> int:
    stmt = select(func.max(MenuItem.display_order)).where(MenuItem.location_id == location_id)
    stmt = stmt.where(
        MenuItem.section_id.is_(None) if section_id is None else MenuItem.section_id == section_id
    )
    current = (await db.execute(stmt)).scalar_one_or_none()
    return 0 if current is None else current + 1


async def _count(db: AsyncSession, model: type[MenuSection] | type[MenuItem], location_id: int) -> int:
    return (
        await db.execute(
            select(func.count()).select_from(model).where(model.location_id == location_id)
        )
    ).scalar_one()


# ---------------------------------------------------------------------------
# Public structured read (also the management editor's read)
# ---------------------------------------------------------------------------


async def build_menu(
    db: AsyncSession, location_id: int, *, include_hidden: bool = False
) -> MenuOut:
    """The structured menu. `include_hidden=False` (the default, and what
    every public read uses) drops hidden items, hidden groups WITH their
    items, and — when the location's `menu_hidden` flag is set — the whole
    menu. `include_hidden=True` is the management view: everything, each
    row carrying its `is_hidden` flag."""
    photos_on = await photos_enabled(db)
    location = await _get_location_or_404(db, location_id)
    menu_hidden = bool(location.menu_hidden)
    if menu_hidden and not include_hidden:
        return MenuOut(
            location_id=location_id,
            menu_photos_enabled=photos_on,
            menu_hidden=True,
            ungrouped_items=[],
            sections=[],
        )
    sections = (
        (
            await db.execute(
                select(MenuSection)
                .where(MenuSection.location_id == location_id)
                .order_by(MenuSection.display_order, MenuSection.id)
            )
        )
        .scalars()
        .all()
    )
    items = (
        (
            await db.execute(
                select(MenuItem)
                .where(MenuItem.location_id == location_id)
                .order_by(MenuItem.display_order, MenuItem.id)
            )
        )
        .scalars()
        .all()
    )

    if not include_hidden:
        sections = [s for s in sections if not s.is_hidden]
        items = [i for i in items if not i.is_hidden]
        visible_section_ids = {s.id for s in sections}
        # An item of a hidden group is hidden with it (ungrouped items have
        # no group to hide them).
        items = [i for i in items if i.section_id is None or i.section_id in visible_section_ids]

    by_section: dict[int | None, list[MenuItemOut]] = {}
    for item in items:
        by_section.setdefault(item.section_id, []).append(_item_out(item, photos_on))

    return MenuOut(
        location_id=location_id,
        menu_photos_enabled=photos_on,
        menu_hidden=menu_hidden,
        ungrouped_items=by_section.get(None, []),
        sections=[
            MenuSectionWithItemsOut(
                id=s.id,
                name=s.name,
                description=s.description,
                display_order=s.display_order,
                items=by_section.get(s.id, []),
                is_hidden=s.is_hidden,
            )
            for s in sections
        ],
    )


async def get_menu(db: AsyncSession, location_id: int, current_user=None) -> MenuOut:
    """`GET /locations/{id}/menu` — public. 404 (via the shared visibility
    gate) for a missing/hidden location or a soft-deleted brand."""
    await location_service.get_readable_location_or_404(db, location_id, current_user)
    return await build_menu(db, location_id, include_hidden=False)


async def get_menu_for_management(db: AsyncSession, location_id: int) -> MenuOut:
    """`GET /locations/{id}/menu/manage` — the editor's read: EVERYTHING,
    hidden groups/items included and flagged. Access (owner / assigned
    manager / admin) is enforced upstream by the router dependency."""
    return await build_menu(db, location_id, include_hidden=True)


async def set_menu_hidden(
    db: AsyncSession, location_id: int, is_hidden: bool, current_user
) -> MenuVisibilityOut:
    """`PUT /locations/{id}/menu/visibility` — hide/show the ENTIRE menu.
    Idempotent: re-sending the current value changes nothing and writes no
    audit row. The change is audited on `restaurant_location` (old/new
    `menu_hidden`) in the same transaction."""
    location = await _get_location_or_404(db, location_id)
    old_hidden = bool(location.menu_hidden)
    if old_hidden != is_hidden:
        location.menu_hidden = is_hidden
        await db.flush()
        await audit_service.log(
            db,
            table_name="restaurant_location",
            record_id=location.id,
            action="update",
            actor_id=current_user.cognito_sub,
            actor_role=current_user.role,
            old_val={"menu_hidden": old_hidden},
            new_val={"menu_hidden": is_hidden},
        )
        await db.commit()
    return MenuVisibilityOut(location_id=location_id, is_hidden=is_hidden)


# ---------------------------------------------------------------------------
# Sections
# ---------------------------------------------------------------------------


async def create_section(
    db: AsyncSession, location_id: int, body: MenuSectionCreate, current_user
) -> MenuSectionOut:
    await _get_location_or_404(db, location_id)
    if await _count(db, MenuSection, location_id) >= MAX_SECTIONS_PER_LOCATION:
        raise AppError(
            409,
            f"A menu can have at most {MAX_SECTIONS_PER_LOCATION} groups.",
            "menu_section_limit_reached",
        )

    section = MenuSection(
        location_id=location_id,
        name=body.name,
        description=body.description,
        display_order=await _next_section_order(db, location_id),
    )
    db.add(section)
    await db.flush()

    await audit_service.log(
        db,
        table_name="menu_section",
        record_id=section.id,
        action="create",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=None,
        new_val=_section_snapshot(section),
    )
    await db.commit()
    await db.refresh(section)
    return _section_out(section)


async def update_section(
    db: AsyncSession, location_id: int, section_id: int, body: MenuSectionUpdate, current_user
) -> MenuSectionOut:
    section = await _get_section_or_404(db, location_id, section_id)
    old_val = _section_snapshot(section)

    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is None:
        raise AppError(400, "name cannot be cleared to null", "bad_request")
    if "is_hidden" in data and data["is_hidden"] is None:
        raise AppError(400, "is_hidden cannot be cleared to null", "bad_request")
    for field in ("name", "description", "is_hidden"):
        if field in data:
            setattr(section, field, data[field])

    await db.flush()
    await audit_service.log(
        db,
        table_name="menu_section",
        record_id=section.id,
        action="update",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=old_val,
        new_val=_section_snapshot(section),
    )
    await db.commit()
    await db.refresh(section)
    return _section_out(section)


async def delete_section(
    db: AsyncSession,
    location_id: int,
    section_id: int,
    current_user,
    *,
    delete_items: bool = False,
) -> None:
    """Delete a group. DEFAULT (`delete_items=False`) is non-destructive:
    the group's items are kept and MOVED TO UNGROUPED (appended after any
    existing ungrouped items, relative order preserved). `delete_items=True`
    (explicit opt-in) deletes them with the group. Either way every affected
    item gets its own audit row, then the group's, all in one transaction.
    """
    section = await _get_section_or_404(db, location_id, section_id)
    section_old = _section_snapshot(section)
    section_pk = section.id

    items = (
        (
            await db.execute(
                select(MenuItem)
                .where(MenuItem.location_id == location_id, MenuItem.section_id == section_pk)
                .order_by(MenuItem.display_order, MenuItem.id)
            )
        )
        .scalars()
        .all()
    )

    next_order = await _next_item_order(db, location_id, None)
    for item in items:
        item_old = _item_snapshot(item)
        item_pk = item.id
        if delete_items:
            await db.delete(item)
            await audit_service.log(
                db,
                table_name="menu_item",
                record_id=item_pk,
                action="delete",
                actor_id=current_user.cognito_sub,
                actor_role=current_user.role,
                old_val=item_old,
                new_val=None,
            )
        else:
            item.section_id = None
            item.display_order = next_order
            next_order += 1
            await db.flush()
            await audit_service.log(
                db,
                table_name="menu_item",
                record_id=item_pk,
                action="update",
                actor_id=current_user.cognito_sub,
                actor_role=current_user.role,
                old_val=item_old,
                new_val=_item_snapshot(item),
            )
    await db.flush()

    await db.delete(section)
    await audit_service.log(
        db,
        table_name="menu_section",
        record_id=section_pk,
        action="delete",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=section_old,
        new_val=None,
    )
    await db.commit()


async def reorder_sections(
    db: AsyncSession, location_id: int, body: MenuSectionOrder, current_user
) -> MenuOut:
    await _get_location_or_404(db, location_id)
    sections = (
        (await db.execute(select(MenuSection).where(MenuSection.location_id == location_id)))
        .scalars()
        .all()
    )
    by_id = {s.id: s for s in sections}
    if set(body.ids) != set(by_id):
        raise AppError(
            409,
            "The menu changed since you loaded it. Refresh and try again.",
            "menu_out_of_date",
        )

    for index, section_id in enumerate(body.ids):
        section = by_id[section_id]
        if section.display_order == index:
            continue
        old_val = _section_snapshot(section)
        section.display_order = index
        await db.flush()
        await audit_service.log(
            db,
            table_name="menu_section",
            record_id=section.id,
            action="update",
            actor_id=current_user.cognito_sub,
            actor_role=current_user.role,
            old_val=old_val,
            new_val=_section_snapshot(section),
        )
    await db.commit()
    return await build_menu(db, location_id, include_hidden=True)


# ---------------------------------------------------------------------------
# Items
# ---------------------------------------------------------------------------


def _sizes_to_json(sizes: list[Any]) -> list[dict[str, str]]:
    return [{"label": s.label, "price": s.price} for s in sizes]


async def create_item(
    db: AsyncSession, location_id: int, body: MenuItemCreate, current_user
) -> MenuItemOut:
    await _get_location_or_404(db, location_id)
    if body.section_id is not None:
        await _get_section_or_404(db, location_id, body.section_id)
    if await _count(db, MenuItem, location_id) >= MAX_ITEMS_PER_LOCATION:
        raise AppError(
            409,
            f"A menu can have at most {MAX_ITEMS_PER_LOCATION} items.",
            "menu_item_limit_reached",
        )

    item = MenuItem(
        location_id=location_id,
        section_id=body.section_id,
        name=body.name,
        description=body.description,
        price=body.price,
        sizes=_sizes_to_json(body.sizes) if body.sizes is not None else None,
        display_order=await _next_item_order(db, location_id, body.section_id),
    )
    db.add(item)
    await db.flush()

    await audit_service.log(
        db,
        table_name="menu_item",
        record_id=item.id,
        action="create",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=None,
        new_val=_item_snapshot(item),
    )
    await db.commit()
    await db.refresh(item)
    return _item_out(item, await photos_enabled(db))


async def update_item(
    db: AsyncSession, location_id: int, item_id: int, body: MenuItemUpdate, current_user
) -> MenuItemOut:
    item = await _get_item_or_404(db, location_id, item_id)
    old_val = _item_snapshot(item)

    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is None:
        raise AppError(400, "name cannot be cleared to null", "bad_request")
    if "is_hidden" in data and data["is_hidden"] is None:
        raise AppError(400, "is_hidden cannot be cleared to null", "bad_request")

    # Pricing form: send the new form's field and the other is cleared. The
    # merged result must still have exactly one of price / sizes.
    new_price, new_sizes = item.price, item.sizes
    if data.get("price") is not None:
        new_price, new_sizes = data["price"], None
    elif data.get("sizes") is not None:
        new_price, new_sizes = None, _sizes_to_json(body.sizes or [])
    else:
        if "price" in data:
            new_price = None
        if "sizes" in data:
            new_sizes = None
    if (new_price is None) == (new_sizes is None):
        raise AppError(
            400, "An item needs a price, or at least one size with a price", "bad_request"
        )

    if "section_id" in data and data["section_id"] != item.section_id:
        if data["section_id"] is not None:
            await _get_section_or_404(db, location_id, data["section_id"])
        # Moved to another group: append at the end of the destination.
        item.display_order = await _next_item_order(db, location_id, data["section_id"])
        item.section_id = data["section_id"]

    if "name" in data:
        item.name = data["name"]
    if "description" in data:
        item.description = data["description"]
    if "is_hidden" in data:
        item.is_hidden = data["is_hidden"]
    item.price = new_price
    item.sizes = new_sizes

    await db.flush()
    await audit_service.log(
        db,
        table_name="menu_item",
        record_id=item.id,
        action="update",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=old_val,
        new_val=_item_snapshot(item),
    )
    await db.commit()
    await db.refresh(item)
    return _item_out(item, await photos_enabled(db))


async def delete_item(db: AsyncSession, location_id: int, item_id: int, current_user) -> None:
    item = await _get_item_or_404(db, location_id, item_id)
    old_val = _item_snapshot(item)
    item_pk = item.id

    await db.delete(item)
    await audit_service.log(
        db,
        table_name="menu_item",
        record_id=item_pk,
        action="delete",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=old_val,
        new_val=None,
    )
    await db.commit()


async def reorder_items(
    db: AsyncSession, location_id: int, body: MenuItemOrder, current_user
) -> MenuOut:
    await _get_location_or_404(db, location_id)
    if body.section_id is not None:
        await _get_section_or_404(db, location_id, body.section_id)

    stmt = select(MenuItem).where(MenuItem.location_id == location_id)
    stmt = stmt.where(
        MenuItem.section_id.is_(None)
        if body.section_id is None
        else MenuItem.section_id == body.section_id
    )
    items = (await db.execute(stmt)).scalars().all()
    by_id = {i.id: i for i in items}
    if set(body.ids) != set(by_id):
        raise AppError(
            409,
            "The menu changed since you loaded it. Refresh and try again.",
            "menu_out_of_date",
        )

    for index, item_id in enumerate(body.ids):
        item = by_id[item_id]
        if item.display_order == index:
            continue
        old_val = _item_snapshot(item)
        item.display_order = index
        await db.flush()
        await audit_service.log(
            db,
            table_name="menu_item",
            record_id=item.id,
            action="update",
            actor_id=current_user.cognito_sub,
            actor_role=current_user.role,
            old_val=old_val,
            new_val=_item_snapshot(item),
        )
    await db.commit()
    return await build_menu(db, location_id, include_hidden=True)


# ---------------------------------------------------------------------------
# Item photos — built, switched OFF (see module docstring)
# ---------------------------------------------------------------------------


async def create_photo_upload_url(
    db: AsyncSession, location_id: int, content_type: str
) -> UploadUrlResponse:
    await _require_photos_enabled(db)
    await _get_location_or_404(db, location_id)
    url, fields, key, expires_in = s3_service.generate_menu_photo_upload_url(
        location_id, content_type
    )
    return UploadUrlResponse(upload_url=url, fields=fields, s3_key=key, expires_in=expires_in)


async def set_item_photo(
    db: AsyncSession, location_id: int, item_id: int, body: MenuPhotoAttach, current_user
) -> MenuItemOut:
    """Attach or replace an item's photo. `body.s3_key` is the RAW upload key
    from `create_photo_upload_url`; the predicted processed/thumbnail keys
    are stored immediately (same predicted-key approach as
    `POST /locations/{id}/photos`). Replacing just overwrites the stored keys
    (removing the old S3 objects is a follow-up, same as location photos)."""
    await _require_photos_enabled(db)
    item = await _get_item_or_404(db, location_id, item_id)
    processed_key, thumbnail_key = s3_service.menu_photo_keys_for_upload(body.s3_key, location_id)

    old_val = _item_snapshot(item)
    item.photo_s3_key = processed_key
    item.photo_thumbnail_s3_key = thumbnail_key
    await db.flush()
    await audit_service.log(
        db,
        table_name="menu_item",
        record_id=item.id,
        action="update",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=old_val,
        new_val=_item_snapshot(item),
    )
    await db.commit()
    await db.refresh(item)
    return _item_out(item, True)


async def remove_item_photo(
    db: AsyncSession, location_id: int, item_id: int, current_user
) -> MenuItemOut:
    await _require_photos_enabled(db)
    item = await _get_item_or_404(db, location_id, item_id)

    old_val = _item_snapshot(item)
    item.photo_s3_key = None
    item.photo_thumbnail_s3_key = None
    await db.flush()
    await audit_service.log(
        db,
        table_name="menu_item",
        record_id=item.id,
        action="update",
        actor_id=current_user.cognito_sub,
        actor_role=current_user.role,
        old_val=old_val,
        new_val=_item_snapshot(item),
    )
    await db.commit()
    await db.refresh(item)
    return _item_out(item, True)
