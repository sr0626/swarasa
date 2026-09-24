"""Menu request/response shapes — see docs/API_CONTRACTS.md "Menu
(`menu_section`, `menu_item`)" and the design notes in
`app/models/menu_section.py` / `app/models/menu_item.py`.

Validation here is the server-side source of truth (never the UI): every
free-text field is trimmed; required ones must be non-empty AFTER the trim;
length caps mirror the DB column widths. Prices and size labels are free
text — never parsed as numbers.

One price OR sizes: an item has exactly one of `price` (single free-text
price) or `sizes` (1..6 ordered `{label, price}` rows). Sending both, or
neither on create, is a `422`. On PATCH the rule is applied to whatever the
caller actually sent (both non-null -> 422) and to the MERGED stored+sent
state in `menu_service.update_item` (an item can never end up with neither).
"""
from __future__ import annotations

from typing import Annotated, Any

from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator

from app.models.menu_item import (
    ITEM_DESCRIPTION_MAX_LENGTH,
    ITEM_NAME_MAX_LENGTH,
    ITEM_PRICE_MAX_LENGTH,
    MAX_SIZES_PER_ITEM,
    SIZE_LABEL_MAX_LENGTH,
)
from app.models.menu_section import SECTION_DESCRIPTION_MAX_LENGTH, SECTION_NAME_MAX_LENGTH

# Cheap per-location caps (service-enforced, `409`). Generous for a real
# restaurant menu, small enough that the single public read stays bounded.
MAX_SECTIONS_PER_LOCATION = 30
MAX_ITEMS_PER_LOCATION = 300


def _trimmed(max_length: int) -> Any:
    return Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=max_length)]


SectionName = _trimmed(SECTION_NAME_MAX_LENGTH)
ItemName = _trimmed(ITEM_NAME_MAX_LENGTH)
PriceText = _trimmed(ITEM_PRICE_MAX_LENGTH)
SizeLabel = _trimmed(SIZE_LABEL_MAX_LENGTH)


def _blank_to_none(value: Any) -> Any:
    """Optional free-text fields: trim, and treat an empty/whitespace-only
    string as "not provided" (so a cleared textarea clears the field)."""
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


# ---------------------------------------------------------------------------
# Sizes
# ---------------------------------------------------------------------------


class MenuSizeIn(BaseModel):
    """One size option: both `label` ("Personal") and `price` ("$10") are
    required, non-empty free text after trim."""

    label: SizeLabel
    price: PriceText


class MenuSizeOut(BaseModel):
    label: str
    price: str


# ---------------------------------------------------------------------------
# Sections
# ---------------------------------------------------------------------------


class MenuSectionCreate(BaseModel):
    name: SectionName
    description: str | None = Field(default=None, max_length=SECTION_DESCRIPTION_MAX_LENGTH)

    _clean_description = field_validator("description", mode="before")(_blank_to_none)


class MenuSectionUpdate(BaseModel):
    """PATCH — `exclude_unset` semantics (same convention as
    `DealUpdate`/`LocationUpdate`). An explicit `null` on `description`
    clears it; an explicit `null` on `name` is a `400` (enforced in the
    service, since Pydantic alone can't tell "omitted" from "null")."""

    name: SectionName | None = None
    description: str | None = Field(default=None, max_length=SECTION_DESCRIPTION_MAX_LENGTH)

    _clean_description = field_validator("description", mode="before")(_blank_to_none)


class MenuSectionOut(BaseModel):
    id: int
    location_id: int
    name: str
    description: str | None
    display_order: int


# ---------------------------------------------------------------------------
# Items
# ---------------------------------------------------------------------------


class MenuItemCreate(BaseModel):
    name: ItemName
    description: str | None = Field(default=None, max_length=ITEM_DESCRIPTION_MAX_LENGTH)
    # Exactly one of `price` / `sizes` — see module docstring.
    price: PriceText | None = None
    sizes: list[MenuSizeIn] | None = Field(default=None, min_length=1, max_length=MAX_SIZES_PER_ITEM)
    # null/omitted = ungrouped (renders first, under no heading).
    section_id: int | None = None

    _clean_description = field_validator("description", mode="before")(_blank_to_none)

    @model_validator(mode="after")
    def _exactly_one_price_form(self) -> "MenuItemCreate":
        if self.price is not None and self.sizes is not None:
            raise ValueError("Provide either a single price or sizes, not both")
        if self.price is None and self.sizes is None:
            raise ValueError("A price (or at least one size with a price) is required")
        return self


class MenuItemUpdate(BaseModel):
    """PATCH — `exclude_unset` semantics. Switching pricing form: send the
    new form's field only (`{"sizes": [...]}` or `{"price": "$12"}`); the
    service clears the other one. `null` for `name` is a `400`; explicit
    `null` for `description` / `section_id` clears / ungroups."""

    name: ItemName | None = None
    description: str | None = Field(default=None, max_length=ITEM_DESCRIPTION_MAX_LENGTH)
    price: PriceText | None = None
    sizes: list[MenuSizeIn] | None = Field(default=None, min_length=1, max_length=MAX_SIZES_PER_ITEM)
    section_id: int | None = None

    _clean_description = field_validator("description", mode="before")(_blank_to_none)

    @model_validator(mode="after")
    def _not_both_price_forms(self) -> "MenuItemUpdate":
        if self.price is not None and self.sizes is not None:
            raise ValueError("Provide either a single price or sizes, not both")
        return self


class MenuItemOut(BaseModel):
    id: int
    location_id: int
    section_id: int | None
    name: str
    description: str | None
    # Exactly one is non-null: a single free-text price, OR an ordered list
    # of sizes (array order is the display order).
    price: str | None
    sizes: list[MenuSizeOut] | None
    display_order: int
    # Always null while the `menu_item_photos_enabled` platform flag is OFF
    # (docs/API_CONTRACTS.md "Menu"), and null for an item with no photo.
    photo_url: str | None
    photo_thumbnail_url: str | None


class MenuSectionWithItemsOut(BaseModel):
    id: int
    name: str
    description: str | None
    display_order: int
    items: list[MenuItemOut]


class MenuOut(BaseModel):
    """`GET /locations/{id}/menu` — the whole structured menu in one read.

    `ungrouped_items` (items with no group) render FIRST, under no heading;
    then `sections` in display order, each with its own items in display
    order. `menu_photos_enabled` tells the client whether to show the photo
    control (editor) — mirrors the platform flag; item photo URLs are null
    whenever it is false.
    """

    location_id: int
    menu_photos_enabled: bool
    ungrouped_items: list[MenuItemOut]
    sections: list[MenuSectionWithItemsOut]


# ---------------------------------------------------------------------------
# Reorder
# ---------------------------------------------------------------------------


def _reject_duplicates(ids: list[int]) -> list[int]:
    if len(set(ids)) != len(ids):
        raise ValueError("ids must not contain duplicates")
    return ids


class MenuSectionOrder(BaseModel):
    """`PUT /locations/{id}/menu/sections/order` — the FULL set of this
    location's section ids, in the new display order."""

    ids: list[int] = Field(max_length=MAX_SECTIONS_PER_LOCATION)

    _no_dupes = field_validator("ids")(_reject_duplicates)


class MenuItemOrder(BaseModel):
    """`PUT /locations/{id}/menu/items/order` — the FULL set of item ids
    currently in one group (`section_id`, or `null` for the ungrouped
    list), in the new display order."""

    section_id: int | None = None
    ids: list[int] = Field(max_length=MAX_ITEMS_PER_LOCATION)

    _no_dupes = field_validator("ids")(_reject_duplicates)


# ---------------------------------------------------------------------------
# Photos (only usable while `menu_item_photos_enabled` is on)
# ---------------------------------------------------------------------------


class MenuPhotoUploadUrlRequest(BaseModel):
    content_type: str


class MenuPhotoAttach(BaseModel):
    # The RAW key returned by the upload-url call
    # (`raw/locations/{id}/menu/{uuid}.<ext>`); the service transforms it to
    # the predicted processed/thumbnail keys before storing, same as
    # `POST /locations/{id}/photos`.
    s3_key: str = Field(min_length=1, max_length=512)
