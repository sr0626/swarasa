"""Menu — `menu_section` / `menu_item` CRUD + reorder (owner / assigned
manager / admin) and the PUBLIC structured menu read. See
docs/API_CONTRACTS.md "Menu (`menu_section`, `menu_item`)".

Its own router (backend/CLAUDE.md "one file per resource"), nested under
`/locations/{location_id}` like `deals.py`. Free-tier feature: no `is_paid`
check anywhere except the (currently switched-off) item-photo platform flag
inside `menu_service`.

Route order note: the literal `.../sections/order` and `.../items/order`
PUT routes are distinct from the `{section_id}` / `{item_id}` PATCH/DELETE
routes by HTTP method, so there is no path-parameter shadowing.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.auth import (
    CurrentUser,
    get_current_user_optional,
    require_location_write_access,
)
from app.dependencies.db import get_db
from app.schemas.menu import (
    MenuItemCreate,
    MenuItemOrder,
    MenuItemOut,
    MenuItemUpdate,
    MenuOut,
    MenuPhotoAttach,
    MenuPhotoUploadUrlRequest,
    MenuSectionCreate,
    MenuSectionOrder,
    MenuSectionOut,
    MenuSectionUpdate,
)
from app.schemas.photo import UploadUrlResponse
from app.services import menu_service

router = APIRouter(prefix="/locations", tags=["menu"])


@router.get("/{location_id}/menu", response_model=MenuOut)
async def get_location_menu(
    location_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser | None = Depends(get_current_user_optional),
) -> MenuOut:
    """PUBLIC (no auth required) — the whole structured menu. The optional
    caller only matters for the hidden-location rule (an owner/admin/
    assigned manager can still open their own non-active location's menu,
    exactly like `GET /locations/{id}`)."""
    return await menu_service.get_menu(db, location_id, current_user)


# -- sections ---------------------------------------------------------------


@router.post(
    "/{location_id}/menu/sections",
    response_model=MenuSectionOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_menu_section(
    location_id: int,
    body: MenuSectionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_location_write_access),
) -> MenuSectionOut:
    return await menu_service.create_section(db, location_id, body, current_user)


@router.put("/{location_id}/menu/sections/order", response_model=MenuOut)
async def reorder_menu_sections(
    location_id: int,
    body: MenuSectionOrder,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_location_write_access),
) -> MenuOut:
    return await menu_service.reorder_sections(db, location_id, body, current_user)


@router.patch("/{location_id}/menu/sections/{section_id}", response_model=MenuSectionOut)
async def update_menu_section(
    location_id: int,
    section_id: int,
    body: MenuSectionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_location_write_access),
) -> MenuSectionOut:
    return await menu_service.update_section(db, location_id, section_id, body, current_user)


@router.delete(
    "/{location_id}/menu/sections/{section_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
async def delete_menu_section(
    location_id: int,
    section_id: int,
    delete_items: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_location_write_access),
) -> None:
    """Default keeps the group's items (moved to ungrouped);
    `?delete_items=true` deletes them with the group."""
    await menu_service.delete_section(
        db, location_id, section_id, current_user, delete_items=delete_items
    )


# -- items ------------------------------------------------------------------


@router.post(
    "/{location_id}/menu/items",
    response_model=MenuItemOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_menu_item(
    location_id: int,
    body: MenuItemCreate,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_location_write_access),
) -> MenuItemOut:
    return await menu_service.create_item(db, location_id, body, current_user)


@router.put("/{location_id}/menu/items/order", response_model=MenuOut)
async def reorder_menu_items(
    location_id: int,
    body: MenuItemOrder,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_location_write_access),
) -> MenuOut:
    return await menu_service.reorder_items(db, location_id, body, current_user)


@router.patch("/{location_id}/menu/items/{item_id}", response_model=MenuItemOut)
async def update_menu_item(
    location_id: int,
    item_id: int,
    body: MenuItemUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_location_write_access),
) -> MenuItemOut:
    return await menu_service.update_item(db, location_id, item_id, body, current_user)


@router.delete(
    "/{location_id}/menu/items/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
async def delete_menu_item(
    location_id: int,
    item_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_location_write_access),
) -> None:
    await menu_service.delete_item(db, location_id, item_id, current_user)


# -- item photos (built, switched OFF behind the platform flag) --------------


@router.post("/{location_id}/menu/photo-upload-url", response_model=UploadUrlResponse)
async def create_menu_photo_upload_url(
    location_id: int,
    body: MenuPhotoUploadUrlRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_location_write_access),
) -> UploadUrlResponse:
    return await menu_service.create_photo_upload_url(db, location_id, body.content_type)


@router.put("/{location_id}/menu/items/{item_id}/photo", response_model=MenuItemOut)
async def set_menu_item_photo(
    location_id: int,
    item_id: int,
    body: MenuPhotoAttach,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_location_write_access),
) -> MenuItemOut:
    return await menu_service.set_item_photo(db, location_id, item_id, body, current_user)


@router.delete("/{location_id}/menu/items/{item_id}/photo", response_model=MenuItemOut)
async def remove_menu_item_photo(
    location_id: int,
    item_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_location_write_access),
) -> MenuItemOut:
    return await menu_service.remove_item_photo(db, location_id, item_id, current_user)
