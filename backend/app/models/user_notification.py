"""user_notification — in-app (bell) notifications for `registered_user`
accounts. First kind: `deal_new` — a followed restaurant added a deal.

Design (docs/API_CONTRACTS.md "Notifications"):
- `user_sub` is the recipient's Cognito `sub` as a bare string, same join key
  and "no local registered_user table" reasoning as `user_follow.user_id` —
  deliberately NOT a foreign key.
- Follows are BRAND-level (`user_follow.brand_id`), while a deal belongs to
  one LOCATION, so a notification records the specific `location_id` (link
  target: `/restaurant/{brand}/{location-slug}`) and fans out to every
  follower of that location's brand.
- `title` is a snapshot of the deal title at creation time (so the bell never
  needs a join to the deal). `deal_id` cascades: deleting a mistaken deal
  retracts its alerts. `location_id` cascades too.
- `kind` is plain text (validated in the service), so a later kind needs no
  migration.
- `read_at` NULL = unread. Index `(user_sub, read_at, created_at)` serves
  both the unread-count and the newest-first list.

Not on root CLAUDE.md's audited-entity list; the originating `deal` create
is already audited. Included in the caller's CCPA export and hard-deleted on
an approved deletion request (`privacy_service`).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.restaurant_location import RestaurantLocation


class UserNotification(Base):
    __tablename__ = "user_notification"
    __table_args__ = (
        Index("ix_user_notification_user_read_created", "user_sub", "read_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    # Cognito `sub` of the recipient (registered_user). See module docstring.
    user_sub: Mapped[str] = mapped_column(String(36), nullable=False)

    # 'deal_new' (validated in notification_service)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)

    location_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("restaurant_location.id", ondelete="CASCADE"), nullable=False
    )
    deal_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("deal.id", ondelete="CASCADE"), nullable=True
    )

    # Snapshot of the deal title at creation time.
    title: Mapped[str] = mapped_column(String(255), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    location: Mapped[RestaurantLocation] = relationship()

    def __repr__(self) -> str:  # pragma: no cover
        return f"<UserNotification id={self.id} user_sub={self.user_sub!r} kind={self.kind!r}>"
