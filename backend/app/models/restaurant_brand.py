"""restaurant_brand — the "restaurant" as presented to the public.

owner_account (1) -> restaurant_brand (N) -> restaurant_location (N)

One owner can have multiple brands (same or different names). A brand
may be unclaimed: `owner_id` is nullable and `is_claimed` defaults to
false so admin-seeded listings can exist and be searchable before any
owner claims them (see root CLAUDE.md "owner_id nullable on
restaurant_brand", DECISIONS.md "Claim flow").
"""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.owner_account import OwnerAccount
    from app.models.restaurant_cuisine import RestaurantCuisine
    from app.models.restaurant_location import RestaurantLocation
    from app.models.user_follow import UserFollow


class RestaurantBrand(TimestampMixin, Base):
    __tablename__ = "restaurant_brand"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    # Nullable: unclaimed listings have no owner yet. ON DELETE SET NULL
    # so a (hypothetical) owner_account removal reverts the brand to
    # unclaimed rather than cascading data loss.
    owner_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("owner_account.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Restaurant's own website URL. Added for the CSV bulk-import feature
    # (docs/PROJECT_PLAN.csv "CSV bulk restaurant import") — brand-level,
    # not location-level: a restaurant's website describes the concept as
    # a whole, the same rationale `restaurant_cuisine.py` already uses for
    # keeping cuisine tags at the brand level rather than per-location (see
    # that model's docstring and docs/DATA_MODEL.md's matching judgment
    # call). String(500) matches `claim_request.google_business_profile_url`'s
    # sizing convention for a URL column in this schema.
    website: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Claim flow — see DECISIONS.md "Claim flow": Google Business Profile
    # match or phone verification, admin-reviewed. Unclaimed brands stay
    # visible/searchable with a "Claim this listing" CTA.
    is_claimed: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    claimed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Soft delete (migration 0011, docs/API_CONTRACTS.md "DELETE
    # /restaurants/{id}"): NULL = live, non-NULL = the admin deleted this
    # listing. The row is kept (slug stays reserved, audit/follower history
    # intact); every public/owner/manager read path filters on
    # `deleted_at IS NULL`. Deleting also deactivates all the brand's
    # locations in the same transaction (`restaurant_service.delete_restaurant`).
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    owner: Mapped["OwnerAccount | None"] = relationship(back_populates="brands")
    locations: Mapped[list["RestaurantLocation"]] = relationship(
        back_populates="brand"
    )
    cuisines: Mapped[list["RestaurantCuisine"]] = relationship(
        back_populates="brand"
    )
    followers: Mapped[list["UserFollow"]] = relationship(back_populates="brand")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<RestaurantBrand id={self.id} name={self.name!r}>"
