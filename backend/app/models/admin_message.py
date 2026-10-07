"""admin_message — a message from a signed-in owner/manager to the platform
admins ("Contact admin"). See docs/API_CONTRACTS.md "Contact admin".

Sender identity is a snapshot (Cognito `sub`, role, email, optional name)
taken at send time, so the admin inbox stays readable if the account is
later removed. `related_location_id` is optional (SET NULL on location
delete). Lifecycle: `open` -> `resolved` (re-openable), stamped with
`resolved_at` / `resolved_by` (admin Cognito sub).

Audit: NOT on the root CLAUDE.md audited-entity list, but the admin's
resolve/re-open writes are recorded in `audit_log` anyway
(`admin_message_service.update_message_status`) since they are admin
actions on another user's record.
"""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.restaurant_location import RestaurantLocation


class AdminMessage(Base):
    __tablename__ = "admin_message"
    __table_args__ = (
        Index("ix_admin_message_status_created", "status", "created_at"),
        Index("ix_admin_message_sender_created", "sender_cognito_sub", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    sender_cognito_sub: Mapped[str] = mapped_column(String(64), nullable=False)
    # 'owner' | 'manager'
    sender_role: Mapped[str] = mapped_column(String(16), nullable=False)
    sender_email: Mapped[str] = mapped_column(String(254), nullable=False)
    sender_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    subject: Mapped[str] = mapped_column(String(120), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)

    related_location_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("restaurant_location.id", ondelete="SET NULL"),
        nullable=True,
    )

    # 'open' | 'resolved'
    status: Mapped[str] = mapped_column(
        String(16), default="open", server_default="open", nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[str | None] = mapped_column(String(64), nullable=True)

    location: Mapped["RestaurantLocation | None"] = relationship()

    def __repr__(self) -> str:  # pragma: no cover
        return f"<AdminMessage id={self.id} role={self.sender_role!r} status={self.status!r}>"
