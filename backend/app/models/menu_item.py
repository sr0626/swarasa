"""menu_item — one dish/drink on a location's menu.

Free-tier feature: name, description and price(s) are public for every
location regardless of `is_paid` (docs/DECISIONS.md "Full menu with prices
moved to free tier"). The OPTIONAL item photo (`photo_s3_key` /
`photo_thumbnail_s3_key`) is the one piece designed to become paid-gated
later ("dish photos", BRD 3.3). Until billing exists the photo capability is
fully built but switched OFF behind the `menu_item_photos_enabled` row of
`platform_config` (default off — see `app/services/menu_service.py`); when
off, no photo URL is ever returned and no photo endpoint accepts writes.
FUTURE INTENT (deliberately NOT implemented now, no `is_paid` logic yet):
when paid tiers land, the gate becomes "flag on AND location is_paid".

Pricing: one price OR sizes
---------------------------
An item carries EITHER a single free-text `price` OR an ordered list of
`sizes` (`[{"label": "Personal", "price": "$10"}, {"label": "Double",
"price": "$15"}]`) — never both, never neither ("price is mandatory" holds
either way). The rule is enforced in `app/schemas/menu.py` (request shape)
and re-checked on the merged state in `app/services/menu_service.py`
(PATCH); the DB columns are both nullable because the invariant spans two
columns and is enforced in the service layer like the other cross-field
rules in this codebase (e.g. `deal` start/end).

* `price` — free text (`"$12"`, `"Market price"`, `"₹250"`), NEVER parsed or
  coerced to a number: Indian-restaurant menus routinely have size variants,
  "MP", and per-piece pricing that a numeric column would mangle. Non-empty
  after trim, <=50 chars. NULL when the item is sized.
* `sizes` — bounded (<=6), ordered JSON list on the item row rather than a
  child table. Why JSON: sizes have no identity or life of their own (they
  are never referenced from anywhere, never queried across items, and are
  always read/written as a unit with the item), so a `menu_item_size` table
  would only add a join to every public read, a second table to cascade on
  location delete, and a second audit surface; inline JSON audits with the
  item (old/new snapshots include the list) for free. Plain `JSON` (not
  Postgres `JSONB`/`ARRAY`) so the SQLite test DB works — same precedent as
  `deal.applicable_days` and `restaurant_location.specialties`. Array order
  IS the display order (no per-size order column). NULL for a single-price
  item.

Other notes
-----------
* `location_id` is stored redundantly next to `section_id` so the
  per-location ownership/permission check and the public read are a single
  indexed predicate with no join, and so ungrouped items (`section_id IS
  NULL`) still belong to a location.
* `section_id` is nullable: an item can be ungrouped. Ungrouped items render
  FIRST on the public menu, under no heading. FK is `ON DELETE SET NULL` —
  a safety net: deleting a section (service-level) explicitly ungroups or
  deletes its items itself, with audit rows, so the DB action only ever
  fires for direct SQL / future bulk tooling, where "keep the dish, lose the
  group" is the non-destructive outcome.
* `location_id` is `ON DELETE CASCADE` (same reasoning as
  `menu_section.location_id` and `deal.location_id`): hard-deleting a
  location via Core `delete()` cascades the whole menu away.
* `is_hidden` (added 2026-09-24, migration 0014) is the non-destructive
  "hide this dish" switch (e.g. sold out): a hidden item stays in the
  owner's editor (marked "Hidden", one-click Show) but is excluded from the
  public menu read and everything derived from it. Default false, so
  existing rows stay visible with no backfill.
* No ORM relationships — see `menu_section.py`.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import BigInteger, Boolean, ForeignKey, Index, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin

ITEM_NAME_MAX_LENGTH = 150
ITEM_DESCRIPTION_MAX_LENGTH = 1000
ITEM_PRICE_MAX_LENGTH = 50
SIZE_LABEL_MAX_LENGTH = 40
MAX_SIZES_PER_ITEM = 6
PHOTO_KEY_MAX_LENGTH = 512


class MenuItem(TimestampMixin, Base):
    __tablename__ = "menu_item"
    __table_args__ = (
        Index("ix_menu_item_location_section_order", "location_id", "section_id", "display_order"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    location_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("restaurant_location.id", ondelete="CASCADE"),
        nullable=False,
    )
    section_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("menu_section.id", ondelete="SET NULL"),
        nullable=True,
    )

    name: Mapped[str] = mapped_column(String(ITEM_NAME_MAX_LENGTH), nullable=False)
    description: Mapped[str | None] = mapped_column(
        String(ITEM_DESCRIPTION_MAX_LENGTH), nullable=True
    )

    # Exactly one of `price` / `sizes` is non-NULL — see module docstring.
    price: Mapped[str | None] = mapped_column(String(ITEM_PRICE_MAX_LENGTH), nullable=True)
    sizes: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)

    display_order: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )

    # Non-destructive hide switch — see module docstring.
    is_hidden: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )

    # Processed (1200px) and thumbnail (400px) S3 keys, same predicted-key
    # convention as `restaurant_photo` (see `app/media/key_transform.py`).
    # Resolved to CloudFront URLs at read time, never stored as URLs. Only
    # ever read/written while `menu_item_photos_enabled` is on.
    photo_s3_key: Mapped[str | None] = mapped_column(String(PHOTO_KEY_MAX_LENGTH), nullable=True)
    photo_thumbnail_s3_key: Mapped[str | None] = mapped_column(
        String(PHOTO_KEY_MAX_LENGTH), nullable=True
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<MenuItem id={self.id} location_id={self.location_id} name={self.name!r}>"
