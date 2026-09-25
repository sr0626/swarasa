"""location_cuisine — join table between restaurant_location and cuisine_tag.

Cuisine / dietary / type / signature / dining-time tags are PER LOCATION
(docs/DECISIONS.md "Cuisine/dietary tags are per location", migration 0016):
branches of one restaurant differ — a vegetarian branch, a nut-free kitchen,
regional menus, one branch that does not serve breakfast — so each location
carries its own set. This replaces the brand-level `restaurant_cuisine`
table (kept, deprecated, unread; see that model).

Composite primary key (location_id, cuisine_tag_id): a tag is on a location
at most once, and there is no surrogate id nothing needs. `ON DELETE CASCADE`
on both sides: deleting a location (or, in principle, a tag) removes the link
rows, never the other side.
"""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.cuisine_tag import CuisineTag


class LocationCuisine(Base):
    __tablename__ = "location_cuisine"
    __table_args__ = (
        # Filter direction (tag -> locations) for `GET /search`; the PK
        # already covers location -> tags.
        Index("ix_location_cuisine_cuisine_tag_id", "cuisine_tag_id"),
    )

    location_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("restaurant_location.id", ondelete="CASCADE"),
        primary_key=True,
    )
    cuisine_tag_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("cuisine_tag.id", ondelete="CASCADE"),
        primary_key=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    cuisine_tag: Mapped["CuisineTag"] = relationship(back_populates="location_links")

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<LocationCuisine location_id={self.location_id} "
            f"cuisine_tag_id={self.cuisine_tag_id}>"
        )
