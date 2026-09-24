"""menu_section — an optional, owner-named group of menu items on a
`restaurant_location` ("Appetizers", "Main Course", ...).

Free-tier feature (docs/DECISIONS.md "Full menu with prices moved to free
tier"): the whole menu, prices included, is public and NOT gated on
`restaurant_location.is_paid`. Only the optional per-item photo is the
future paid piece — see `menu_item.py`.

Design notes
------------
* `name` is free text (trimmed, required, <=100 chars — validated in
  `app/schemas/menu.py`). `description` is an optional free-text blurb shown
  under the group heading ("Served with basmati rice"); every group carries
  its own, which is what makes "multiple optional group descriptions" work.
* `display_order` is a plain integer sort key (0-based, dense after any
  reorder). Ties are broken by `id` at read time so ordering is always
  deterministic.
* `location_id` is `ON DELETE CASCADE`, exactly like `deal.location_id`: a
  section has no dependents that should block deleting its location, and
  `location_service.remove_location` uses a Core `delete()` (not the ORM
  unit-of-work) precisely so the DB's own cascade does the work — see that
  function's comment. Deleting a SECTION never cascades to its items at the
  DB level (`menu_item.section_id` is `ON DELETE SET NULL`); the service
  layer decides explicitly whether to ungroup or delete them so it can audit
  each affected item.
* `is_hidden` (added 2026-09-24, migration 0014): hides the whole group AND
  its items from the public menu without touching the items' own
  `is_hidden` (so un-hiding the group restores exactly what was visible
  before). Default false, no backfill.
* No ORM `relationship()` to items/location on purpose: every access path
  is an explicit query in `app/services/menu_service.py`, and skipping
  relationships means an ORM `session.delete(section)` can never try to
  NULL a NOT NULL FK behind the service's back (the failure that forced
  `remove_location` onto Core `delete()`).
"""
from __future__ import annotations

from sqlalchemy import BigInteger, Boolean, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin

SECTION_NAME_MAX_LENGTH = 100
SECTION_DESCRIPTION_MAX_LENGTH = 500


class MenuSection(TimestampMixin, Base):
    __tablename__ = "menu_section"
    __table_args__ = (Index("ix_menu_section_location_order", "location_id", "display_order"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    location_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("restaurant_location.id", ondelete="CASCADE"),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(String(SECTION_NAME_MAX_LENGTH), nullable=False)
    description: Mapped[str | None] = mapped_column(
        String(SECTION_DESCRIPTION_MAX_LENGTH), nullable=True
    )

    display_order: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )

    is_hidden: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<MenuSection id={self.id} location_id={self.location_id} name={self.name!r}>"
