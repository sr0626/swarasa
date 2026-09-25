"""user_follow — a registered_user following a restaurant.

JUDGMENT CALLS (flagged for review):
1. `user_id` stores the registered user's Cognito `sub` directly, same
   reasoning as `location_manager.user_id` — no local "registered_user"
   table exists in the Phase 1 entity list; Cognito is the identity
   source of truth.
2. Follow target is the **brand**, not a specific location — consistent
   with DECISIONS.md "Brand-level search results" (the public-facing card is the brand;
   a location is an implementation detail of "X locations near you").

No follow cap (DECISIONS.md "No follow cap for registered users").
"""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.restaurant_brand import RestaurantBrand


class UserFollow(Base):
    __tablename__ = "user_follow"
    __table_args__ = (
        UniqueConstraint("user_id", "brand_id", name="uq_user_follow_user_brand"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    # Cognito `sub` of the registered_user. See JUDGMENT CALL note above.
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)

    brand_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("restaurant_brand.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    brand: Mapped["RestaurantBrand"] = relationship(back_populates="followers")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<UserFollow user_id={self.user_id!r} brand_id={self.brand_id}>"
