"""data_deletion_request — a CCPA "right to delete" request against a
caller's own personal data in this app's database, admin-reviewed before
execution.

Backs DECISIONS.md "CCPA data export/deletion: admin-reviewed deletion
queue, synchronous export" and `docs/API_CONTRACTS.md` "Privacy (CCPA data
export / deletion)". Modeled directly on `claim_request` (same single
admin-review-queue shape: submit -> pending_review -> approve/reject) —
that table is the established precedent in this codebase for "a user
submits a request, admin reviews and resolves it" (see
`app/models/claim_request.py`), reused here rather than inventing a new
shape.

JUDGMENT CALL (flagged for review, see DECISIONS.md for the full
reasoning): deletion is NOT executed synchronously at submission time.
CCPA does not require instant execution (businesses get up to 45 days,
extendable, to respond to a verified request) and an irreversible,
whole-identity data purge is exactly the kind of action this codebase
already treats as review-worthy rather than self-service (same posture as
`claim_request` approving brand ownership). `POST /auth/me/data-deletion`
only creates this row; `POST /data-deletion/{id}/approve` (admin) is what
actually redacts/deletes data, via `app/services/privacy_service.py`.

`requester_user_id` is the caller's Cognito `sub` — same "no local
identity table" pattern as `location_manager.user_id` / `user_follow.
user_id` / `claim_request.claimant_user_id` (see `docs/DATA_MODEL.md`'s
identity note). `requester_role` is a point-in-time snapshot of the
caller's role claim at submission (informational only — the actual
redaction in `privacy_service.execute_deletion` is keyed off the Cognito
`sub` across every table that stores it, not the role, since the same
person's `sub` can appear in more than one table regardless of their
current primary role — e.g. a `registered_user` can also have historic
`claim_request` rows, per `docs/API_CONTRACTS.md` "Claim flow": any
authenticated user may submit a claim).

`data_scope` is a JSON snapshot (row counts per affected table) computed
at submission time, purely for the admin reviewer's visibility — not
re-read at approval time (`approve_deletion_request` recomputes live
counts instead, since the snapshot can go stale between submission and
review).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, Index, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class DataDeletionRequest(TimestampMixin, Base):
    __tablename__ = "data_deletion_request"
    __table_args__ = (
        # Cheap ordered scan for the single admin review queue, same
        # reasoning as claim_request's ix_claim_request_status_submitted.
        Index(
            "ix_data_deletion_request_status_submitted",
            "status",
            "submitted_at",
        ),
        # Partial unique: at most one pending deletion request per Cognito
        # identity at a time — same reasoning as
        # claim_request.uq_claim_request_pending_brand.
        Index(
            "uq_data_deletion_request_pending_user",
            "requester_user_id",
            unique=True,
            postgresql_where=text("status = 'pending_review'"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    # Cognito sub of the requester — see JUDGMENT CALL note above.
    requester_user_id: Mapped[str] = mapped_column(
        String(36), nullable=False, index=True
    )
    # Role claim at submission time — informational only, see docstring.
    requester_role: Mapped[str] = mapped_column(String(16), nullable=False)

    # 'pending_review' | 'completed' | 'rejected'
    status: Mapped[str] = mapped_column(
        String(16), default="pending_review", nullable=False
    )

    reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Row-count snapshot per affected table, computed at submission time —
    # for admin visibility only, see docstring.
    data_scope: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Admin Cognito sub who resolved the request (approve or reject).
    reviewed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    reviewer_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Set only once the redaction/deletion has actually been executed
    # (on approval) — distinct from reviewed_at so "reviewed" and
    # "executed" stay separately inspectable even though they currently
    # always happen in the same request (approve_deletion_request sets
    # both together).
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<DataDeletionRequest id={self.id} "
            f"requester_user_id={self.requester_user_id!r} status={self.status!r}>"
        )
