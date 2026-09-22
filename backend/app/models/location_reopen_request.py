"""location_reopen_request — admin-reviewed request to bring a
`closed_pending_reopen` location back to `active`.

See `app/models/restaurant_location.py` module docstring "Location status
lifecycle" for the full status model. An owner can self-service every
status transition EXCEPT the one out of `closed_pending_reopen` — that one
requires this table's admin-reviewed workflow, the same shape as
`claim_request` (submission row + admin approve/reject, with a real side
effect on approval) rather than `listing_report` (submission + triage only,
never itself changes listing data). Chosen over the `listing_report` shape
deliberately: approving a reopen request DOES change `restaurant_location`
data (`status -> active`), same as approving a claim changes
`restaurant_brand.owner_id` — `listing_report`'s admin action never writes
back to the listing at all, so it's the wrong precedent to copy for this
one. See docs/DECISIONS.md "Location status lifecycle" for the full
reasoning, and `app/services/location_reopen_service.py` for the approval
side effect itself.

Field-naming/shape notes, kept consistent with `claim_request`
(`app/models/claim_request.py`) rather than re-deciding a new shape:
- `status` values are `pending_review` | `approved` | `rejected`, matching
  `claim_request.status` exactly.
- `reviewer_notes` matches `claim_request.reviewer_notes` (usable on
  approval too, not reject-only).
- `requested_by_user_id` matches `claim_request.claimant_user_id`'s own
  naming spirit (Cognito `sub`, no local identity table — same pattern as
  `location_manager.user_id`/`user_follow.user_id`) but named for what it
  actually is here (the request's submitter, not a "claimant").
- `notes` (submitter-authored, e.g. "renovation finished, reopening under
  new management") is the requester-side counterpart to `reviewer_notes` —
  optional, since a bare "please reopen" is a valid request on its own.

Partial unique index (like `claim_request`'s "one pending claim per
brand"): at most one *pending* reopen request per location at a time, so a
second submission while one is already in review 409s cleanly instead of
silently creating a duplicate the admin queue would show twice.
"""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.restaurant_location import RestaurantLocation


class LocationReopenRequest(TimestampMixin, Base):
    __tablename__ = "location_reopen_request"
    __table_args__ = (
        # Cheap ordered scan for the admin review queue (oldest pending
        # first) and its status filter — same pattern as
        # `ix_claim_request_status_submitted`.
        Index(
            "ix_location_reopen_request_status_submitted",
            "status",
            "submitted_at",
        ),
        # Partial unique: at most one *pending* reopen request per location
        # at a time — see module docstring.
        Index(
            "uq_location_reopen_request_pending_location",
            "location_id",
            unique=True,
            postgresql_where=text("status = 'pending_review'"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    location_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("restaurant_location.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Cognito sub of the owner who submitted the request.
    requested_by_user_id: Mapped[str] = mapped_column(
        String(36), nullable=False, index=True
    )

    # Owner-authored optional context (e.g. "renovation finished").
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 'pending_review' | 'approved' | 'rejected'
    status: Mapped[str] = mapped_column(
        String(16), default="pending_review", nullable=False
    )

    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Admin Cognito sub who resolved the request (approve or reject).
    reviewed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    reviewer_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    location: Mapped["RestaurantLocation"] = relationship()

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<LocationReopenRequest id={self.id} location_id={self.location_id} "
            f"status={self.status!r}>"
        )
