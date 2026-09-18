"""listing_report — public "report a problem / suggest an update" submissions.

Lets any visitor (anonymous or signed in) flag wrong information on a
restaurant listing (wrong address, closed, wrong hours, ...). Modeled on
`claim_request`'s shape: a submission row plus a small admin triage
lifecycle (`new` -> `resolved` | `dismissed`) with `reviewed_by` /
`reviewed_at` / `reviewer_notes`. See docs/DATA_MODEL.md "listing_report"
and docs/API_CONTRACTS.md "Listing reports (`/reports`)".

Differences from `claim_request`, all deliberate:
- The submitter may be anonymous, so `reporter_user_id` (Cognito `sub`,
  filled only when the caller sent a valid token) and `reporter_email`
  (optional, for a follow-up) are both nullable.
- No partial-unique "one pending per brand" index — several visitors can
  legitimately report the same listing, and duplicates are cheap to close.
- `brand_id` is required and `location_id` optional (SET NULL) — a report
  is about a specific restaurant, and for multi-location brands optionally
  about one location. Both cascade/null the same way `claim_request` does.
- Not on the audit_log-required table list (root CLAUDE.md "ALWAYS —
  Quality"); same treatment `claim_request` gets for its own transitions.
  A report never edits listing data — an admin acts on it separately via
  the normal (audited) listing endpoints.
"""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.restaurant_brand import RestaurantBrand
    from app.models.restaurant_location import RestaurantLocation


class ListingReport(TimestampMixin, Base):
    __tablename__ = "listing_report"
    __table_args__ = (
        # Cheap ordered scan for the admin triage queue (oldest 'new'
        # first) and its status filter.
        Index("ix_listing_report_status_submitted", "status", "submitted_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    brand_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("restaurant_brand.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    location_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("restaurant_location.id", ondelete="SET NULL"),
        nullable=True,
    )

    # 'address_incorrect' | 'hours_incorrect' | 'phone_incorrect' |
    # 'price_incorrect' | 'menu_incorrect' | 'permanently_closed' | 'other'
    # — validated at the API boundary (schemas/listing_report.py), stored
    # as plain text so adding a category never needs a migration.
    category: Mapped[str] = mapped_column(String(32), nullable=False)

    details: Mapped[str] = mapped_column(Text, nullable=False)

    # Optional, so an admin can follow up. Never shown publicly.
    reporter_email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    # Cognito sub, set only when the request carried a valid token.
    reporter_user_id: Mapped[str | None] = mapped_column(
        String(36), nullable=True, index=True
    )

    # 'new' | 'resolved' | 'dismissed'
    status: Mapped[str] = mapped_column(String(16), default="new", nullable=False)

    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Admin Cognito sub who resolved/dismissed the report.
    reviewed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    reviewer_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    brand: Mapped["RestaurantBrand"] = relationship()
    location: Mapped["RestaurantLocation | None"] = relationship()

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<ListingReport id={self.id} brand_id={self.brand_id} "
            f"category={self.category!r} status={self.status!r}>"
        )
