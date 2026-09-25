"""cuisine_tag — platform-controlled taxonomy tags.

Source of truth for tag content is `docs/TAXONOMY.md` (regional
cuisine, dietary, restaurant type, signature offering, dining time
categories). Only admins can add/rename/deactivate tags — no public
write API (see TAXONOMY.md "Seed Script Notes").
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, Boolean, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.location_cuisine import LocationCuisine


class CuisineTag(TimestampMixin, Base):
    __tablename__ = "cuisine_tag"
    __table_args__ = (
        Index("ix_cuisine_tag_category", "category"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    # Tag slug, e.g. "andhra", "vegetarian", "biryani" — see TAXONOMY.md.
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)

    # regional | dietary | type | signature | dining_time
    category: Mapped[str] = mapped_column(String(32), nullable=False)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    location_links: Mapped[list["LocationCuisine"]] = relationship(
        back_populates="cuisine_tag"
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<CuisineTag id={self.id} name={self.name!r}>"
