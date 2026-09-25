"""restaurant_cuisine — DEPRECATED brand-level tag join (superseded by `location_cuisine`).

Tags used to be brand-level. Branches of one restaurant differ (a vegetarian
branch, a nut-free kitchen, one branch without breakfast), so tags now live
per LOCATION in `location_cuisine` (migration 0016, docs/DECISIONS.md
"Cuisine/dietary tags are per location").

This table is intentionally KEPT (not dropped) so migration 0016 is safely
reversible and a rollback of the app still finds its data; migration 0016
backfilled `location_cuisine` from it once. NO application code reads or
writes it any more — the API never touches it. It will be dropped in a later
"contract" migration once the per-location rollout has soaked. Do not add
new usages.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RestaurantCuisine(Base):
    __tablename__ = "restaurant_cuisine"
    __table_args__ = (
        UniqueConstraint("brand_id", "cuisine_tag_id", name="uq_restaurant_cuisine_brand_tag"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    brand_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("restaurant_brand.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    cuisine_tag_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("cuisine_tag.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # No relationships on purpose: nothing reads this deprecated table.

    def __repr__(self) -> str:  # pragma: no cover
        return f"<RestaurantCuisine brand_id={self.brand_id} cuisine_tag_id={self.cuisine_tag_id}>"
