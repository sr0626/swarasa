"""owner_account — the top of the ownership hierarchy.

owner_account (1) -> restaurant_brand (N) -> restaurant_location (N)

Identity itself lives in Cognito (see root CLAUDE.md "Auth: AWS
Cognito"); this table is the local business record for an owner —
Stripe linkage, contact info, and the FK target for brands/locations/
free offers. `cognito_sub` is the join key back to the Cognito user.

`personal_data_deleted_at` (added for CCPA support, see
`app/models/data_deletion_request.py` and DECISIONS.md "CCPA data
export/deletion"): set by `privacy_service.execute_deletion` when a
`data_deletion_request` for this owner's Cognito `sub` is approved.
Marks that `full_name`/`phone`/`email` have been redacted — the row
itself is kept (never hard-deleted), because `restaurant_brand.owner_id`
and other FKs depend on it and, more fundamentally, the business records
an owner manages (brand/location name, address, menu) are this
platform's own business-directory content, not the owner's personal
information — only the identifying fields on THIS row are in CCPA
deletion scope. `cognito_sub` itself is intentionally left unredacted
(still the live join key for login and for the deletion-request queue's
own idempotency; it is an opaque identifier with no directly-identifying
content on its own, same treatment as everywhere else in this schema).
"""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.admin_free_offer import AdminFreeOffer
    from app.models.restaurant_brand import RestaurantBrand


class OwnerAccount(TimestampMixin, Base):
    __tablename__ = "owner_account"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    # Join key back to the Cognito "owner" user pool group. Cognito is
    # the source of truth for credentials/MFA/social login — this table
    # never stores a password (root CLAUDE.md "NEVER store passwords").
    cognito_sub: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)

    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Stripe: one Customer + one Subscription per owner (root CLAUDE.md
    # "Billing model" — "one subscription per owner, one Subscription
    # Item per paid location"). The per-location Subscription Item id
    # lives on restaurant_location.stripe_sub_item_id instead.
    stripe_customer_id: Mapped[str | None] = mapped_column(
        String(255), unique=True, nullable=True
    )
    stripe_sub_id: Mapped[str | None] = mapped_column(
        String(255), unique=True, nullable=True
    )

    # See docstring above. NULL = never had a CCPA deletion executed.
    personal_data_deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    brands: Mapped[list["RestaurantBrand"]] = relationship(
        back_populates="owner"
    )
    free_offers: Mapped[list["AdminFreeOffer"]] = relationship(
        back_populates="owner"
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<OwnerAccount id={self.id} email={self.email!r}>"
