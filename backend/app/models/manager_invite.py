"""manager_invite — a pending "manage this location" invitation addressed to
an email address that may not have an account yet.

Why it exists (docs/PROJECT_PLAN.csv "Manager invite-by-email"): assigning a
manager (`POST /locations/{id}/managers`) needs the person to ALREADY have a
Cognito account. SES is deferred, so the platform cannot email an invitation;
instead the owner (or an admin acting for them) creates an invite, gets back a
single-use link ONCE, and shares it themselves. The invitee signs up / signs
in with the invited email, opens the link, and accepts — only then does a real
`location_manager` row get created, through the SAME validation as a normal
assignment (cross-owner rule, paid-tier caps, audit_log).

Design notes:
- The raw token is never stored: only `token_hash` (SHA-256 hex of a 32-byte
  random token). A leaked database row cannot be turned back into a working
  link.
- `email` is stored lowercased. It is third-party personal data (the invitee
  may never create an account), so it is REDACTED (`REDACTED_EMAIL`) as soon
  as the invite reaches a terminal state (accepted / revoked) and on CCPA
  deletion; see `manager_invite_service` and `privacy_service`.
- `invited_by_owner_id` is always the OWNER of the location's brand (also when
  an admin created the invite on the owner's behalf; the admin is recorded in
  `audit_log`). `ON DELETE CASCADE`: an invite is meaningless without the
  owner who issued it.
- Status is derived, not stored: accepted_at set -> accepted, revoked_at set
  -> revoked, expires_at in the past -> expired, otherwise pending.
- No unique (location_id, email) constraint: creating a new invite for the
  same email on the same location revokes the previous pending one in the
  service (the raw token of an old invite cannot be re-shown, so "re-invite"
  must mean "issue a fresh link").
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

REDACTED_EMAIL = "redacted"


class ManagerInvite(Base):
    __tablename__ = "manager_invite"
    __table_args__ = (
        Index("uq_manager_invite_token_hash", "token_hash", unique=True),
        Index("ix_manager_invite_location", "location_id"),
        Index("ix_manager_invite_email", "email"),
        # Backs the per-owner daily creation rate limit.
        Index("ix_manager_invite_owner_created", "invited_by_owner_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    # Lowercased invitee email; REDACTED_EMAIL once terminal / deleted.
    email: Mapped[str] = mapped_column(String(255), nullable=False)

    location_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("restaurant_location.id", ondelete="CASCADE"), nullable=False
    )
    invited_by_owner_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("owner_account.id", ondelete="CASCADE"), nullable=False
    )

    # SHA-256 hex digest of the raw token (64 chars). Never the token itself.
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<ManagerInvite id={self.id} location_id={self.location_id}>"
