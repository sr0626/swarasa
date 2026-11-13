"""Catering quote requests — a signed-in diner (`registered_user`) describes
a catering order once (event date, headcount, items + tray sizes) and sends it
to up to N subscribed restaurants, each of which answers with a quote.

Three tables, one migration (0024_catering_requests):

  catering_request            the diner's request (one row per submit)
  catering_request_item       what they want (item name, size, quantity)
  catering_request_recipient  one row per chosen restaurant LOCATION: status
                              (pending/quoted/declined/expired) + the quote

Design notes (docs/DATA_MODEL.md "Catering requests"):
- `requester_user_sub` is the diner's Cognito `sub` as a bare string, the same
  join key / "no local registered_user table" reasoning as `user_follow` and
  `user_notification` — deliberately NOT a foreign key. `requester_email` and
  `requester_name` are SNAPSHOTS taken at submit time (the inbox must stay
  readable and an admin must be able to search by email without a Cognito
  call). The restaurant only sees the email/phone after it submits a quote
  (see `catering_inbox_service`).
- Children cascade from the request, so an approved CCPA deletion that removes
  the request removes its items and every restaurant's quote text with it.
- `status` columns are plain text (allowed values in comments, validated in
  the services), same precedent as `claim_request.status` /
  `restaurant_location.status`: adding a value later needs no migration.
- Money is stored as integer cents (`quote_amount_cents`); never a float.
- Expiry is lazy (`catering_service.expire_due_requests`): no cron.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

# catering_request.status
REQUEST_OPEN = "open"
REQUEST_CLOSED = "closed"  # expired (expires_at passed)
REQUEST_CANCELLED = "cancelled"  # cancelled by the requester

# catering_request.delivery_or_pickup
FULFILLMENT_DELIVERY = "delivery"
FULFILLMENT_PICKUP = "pickup"
FULFILLMENTS = (FULFILLMENT_DELIVERY, FULFILLMENT_PICKUP)

# catering_request_item.size — the tray sizes the product asked for, plus a
# catch-all.
ITEM_SIZES = ("full_tray", "medium_tray", "flat_tray", "other")

# catering_request_recipient.status
RECIPIENT_PENDING = "pending"
RECIPIENT_QUOTED = "quoted"
RECIPIENT_DECLINED = "declined"
RECIPIENT_EXPIRED = "expired"


class CateringRequest(Base):
    __tablename__ = "catering_request"
    __table_args__ = (
        Index("ix_catering_request_requester_created", "requester_user_sub", "created_at"),
        Index("ix_catering_request_status_expires", "status", "expires_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    requester_user_sub: Mapped[str] = mapped_column(String(36), nullable=False)
    requester_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    requester_email: Mapped[str] = mapped_column(String(254), nullable=False)
    requester_phone: Mapped[str | None] = mapped_column(String(20), nullable=True)

    event_date: Mapped[date] = mapped_column(Date, nullable=False)
    headcount: Mapped[int] = mapped_column(Integer, nullable=False)
    delivery_or_pickup: Mapped[str] = mapped_column(String(16), nullable=False)
    delivery_city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    delivery_zip: Mapped[str | None] = mapped_column(String(10), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(
        String(16), default=REQUEST_OPEN, server_default=REQUEST_OPEN, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    items: Mapped[list["CateringRequestItem"]] = relationship(
        back_populates="request",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="CateringRequestItem.id",
    )
    recipients: Mapped[list["CateringRequestRecipient"]] = relationship(
        back_populates="request",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="CateringRequestRecipient.id",
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<CateringRequest id={self.id} status={self.status!r}>"


class CateringRequestItem(Base):
    __tablename__ = "catering_request_item"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    request_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("catering_request.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    item_name: Mapped[str] = mapped_column(String(120), nullable=False)
    size: Mapped[str] = mapped_column(String(16), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)

    request: Mapped[CateringRequest] = relationship(back_populates="items")


class CateringRequestRecipient(Base):
    __tablename__ = "catering_request_recipient"
    __table_args__ = (
        UniqueConstraint("request_id", "location_id", name="uq_catering_recipient_request_location"),
        Index("ix_catering_recipient_location_status", "location_id", "status"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    request_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("catering_request.id", ondelete="CASCADE"), nullable=False
    )
    location_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("restaurant_location.id", ondelete="CASCADE"), nullable=False
    )

    status: Mapped[str] = mapped_column(
        String(16), default=RECIPIENT_PENDING, server_default=RECIPIENT_PENDING, nullable=False
    )
    quote_amount_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    quote_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    quoted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    quoted_by_user_sub: Mapped[str | None] = mapped_column(String(36), nullable=True)
    viewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    request: Mapped[CateringRequest] = relationship(back_populates="recipients")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<CateringRequestRecipient id={self.id} status={self.status!r}>"
