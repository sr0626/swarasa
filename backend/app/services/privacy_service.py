"""CCPA data export / deletion business logic.

See docs/API_CONTRACTS.md "Privacy (CCPA data export / deletion)" and
docs/DECISIONS.md "CCPA data export/deletion" for the full reasoning
behind every judgment call referenced inline below. Short version:

- Scope is this app's own database only — Cognito's own account/identity
  record is a separate system and out of scope (see DECISIONS.md).
- A caller's personal data is found by their Cognito `sub` across every
  table that stores it (`owner_account.cognito_sub`,
  `location_manager.user_id`, `user_follow.user_id`,
  `claim_request.claimant_user_id`, `audit_log.actor_id`) — not gated by
  their *current* role claim, since the same identity can appear in more
  than one of these regardless of which pool group they're in right now
  (e.g. a `registered_user` can have historic `claim_request` rows —
  `POST /claim` allows any authenticated user).
- Export is synchronous (no async job, no email) — see DECISIONS.md.
- Deletion is a reviewed request (`data_deletion_request`), not executed
  at submission time — see DECISIONS.md and
  `app/models/data_deletion_request.py`.
- `audit_log` rows are retained, never touched by deletion (legitimate
  business/legal record-keeping — see DECISIONS.md); `user_follow` rows
  are hard-deleted (pure preference data, no retention reason);
  `location_manager`/`claim_request` rows are kept but have their
  identifying column redacted to `_REDACTED_MARKER` (preserves
  access-control/business history shape without the identifier).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.dependencies.pagination import Pagination
from app.models.audit_log import AuditLog
from app.models.claim_request import ClaimRequest
from app.models.data_deletion_request import DataDeletionRequest
from app.models.location_manager import LocationManager
from app.models.owner_account import OwnerAccount
from app.models.user_follow import UserFollow
from app.schemas.privacy import (
    AuditLogExportOut,
    ClaimRequestExportOut,
    DataDeletionListResponse,
    DataDeletionRequestCreate,
    DataDeletionRequestOut,
    DataExportOut,
    FollowExportOut,
    LocationManagerExportOut,
    OwnerAccountExportOut,
)
from app.services import audit_service
from app.services.auth_service import get_owner_account_by_sub

# Shared tombstone value for a redacted identity column — not per-row
# unique, deliberately: this marks "a now-deleted identity used to be
# here" without leaving any correlatable trace of which one (see module
# docstring / DECISIONS.md).
_REDACTED_MARKER = "deleted-user"

_EXPORT_NOTICE = (
    "This export covers personal data held directly by this app "
    "(location manager assignments, restaurant follows, claim requests, "
    "and your owner account record if you have one). Cognito account "
    "details (login email, password, MFA) are managed separately by AWS "
    "Cognito and are not included here. Entries under audit_log_entries "
    "are retained even after a data-deletion request, for legitimate "
    "business and legal record-keeping purposes."
)


async def _gather(db: AsyncSession, cognito_sub: str) -> dict[str, Any]:
    """Every row across the schema keyed to this Cognito sub. Shared by
    export and by both the submission-time and approval-time deletion
    scope computations, so the two never drift out of sync with each
    other about what "this identity's data" actually means.
    """
    owner = await get_owner_account_by_sub(db, cognito_sub)

    manager_rows = (
        await db.execute(
            select(LocationManager).where(LocationManager.user_id == cognito_sub)
        )
    ).scalars().all()

    follow_rows = (
        await db.execute(select(UserFollow).where(UserFollow.user_id == cognito_sub))
    ).scalars().all()

    claim_rows = (
        await db.execute(
            select(ClaimRequest).where(ClaimRequest.claimant_user_id == cognito_sub)
        )
    ).scalars().all()

    audit_rows = (
        await db.execute(
            select(AuditLog)
            .where(AuditLog.actor_id == cognito_sub)
            .order_by(AuditLog.created_at.desc())
        )
    ).scalars().all()

    return {
        "owner": owner,
        "managers": manager_rows,
        "follows": follow_rows,
        "claims": claim_rows,
        "audit": audit_rows,
    }


def _data_scope(gathered: dict[str, Any]) -> dict[str, int]:
    pending_claims = sum(1 for c in gathered["claims"] if c.status == "pending_review")
    return {
        "owner_account": 1 if gathered["owner"] is not None else 0,
        "location_manager_assignments": len(gathered["managers"]),
        "follows": len(gathered["follows"]),
        "claim_requests": len(gathered["claims"]),
        "claim_requests_pending": pending_claims,
        "audit_log_entries": len(gathered["audit"]),
    }


async def export_my_data(db: AsyncSession, current_user) -> DataExportOut:
    """GET /auth/me/data-export. Read-only — never lazily provisions an
    owner_account row just because an export was requested (unlike
    `GET /auth/me`, which does provision on first call for the `owner`
    role; a read of possibly-nonexistent data shouldn't have that
    side effect).
    """
    gathered = await _gather(db, current_user.cognito_sub)

    owner_out = None
    if gathered["owner"] is not None:
        o = gathered["owner"]
        owner_out = OwnerAccountExportOut(
            id=o.id,
            cognito_sub=o.cognito_sub,
            email=o.email,
            full_name=o.full_name,
            phone=o.phone,
            stripe_customer_id=o.stripe_customer_id,
            created_at=o.created_at,
            personal_data_deleted_at=o.personal_data_deleted_at,
        )

    return DataExportOut(
        cognito_sub=current_user.cognito_sub,
        role=current_user.role,
        email=current_user.email,
        generated_at=datetime.now(timezone.utc),
        owner_account=owner_out,
        location_manager_assignments=[
            LocationManagerExportOut(
                location_id=m.location_id,
                is_active=m.is_active,
                assigned_at=m.assigned_at,
                revoked_at=m.revoked_at,
            )
            for m in gathered["managers"]
        ],
        follows=[
            FollowExportOut(brand_id=f.brand_id, followed_at=f.created_at)
            for f in gathered["follows"]
        ],
        claim_requests=[
            ClaimRequestExportOut(
                claim_id=c.id,
                brand_id=c.brand_id,
                status=c.status,
                proof_method=c.proof_method,
                submitted_at=c.submitted_at,
                reviewed_at=c.reviewed_at,
            )
            for c in gathered["claims"]
        ],
        audit_log_entries=[
            AuditLogExportOut(
                table_name=a.table_name,
                record_id=a.record_id,
                action=a.action,
                actor_role=a.actor_role,
                created_at=a.created_at,
            )
            for a in gathered["audit"]
        ],
        notice=_EXPORT_NOTICE,
    )


def _to_out(req: DataDeletionRequest) -> DataDeletionRequestOut:
    return DataDeletionRequestOut(
        request_id=req.id,
        status=req.status,
        requester_role=req.requester_role,
        reason=req.reason,
        data_scope=req.data_scope,
        submitted_at=req.submitted_at,
        reviewed_at=req.reviewed_at,
        reviewer_notes=req.reviewer_notes,
        completed_at=req.completed_at,
    )


async def create_deletion_request(
    db: AsyncSession, current_user, body: DataDeletionRequestCreate
) -> DataDeletionRequestOut:
    """POST /auth/me/data-deletion. Creates a pending request only — does
    NOT delete anything yet (see module docstring / DECISIONS.md).
    """
    existing = (
        await db.execute(
            select(DataDeletionRequest).where(
                DataDeletionRequest.requester_user_id == current_user.cognito_sub,
                DataDeletionRequest.status == "pending_review",
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise AppError(
            409,
            "A data deletion request is already pending for your account",
            "deletion_already_pending",
        )

    gathered = await _gather(db, current_user.cognito_sub)
    request = DataDeletionRequest(
        requester_user_id=current_user.cognito_sub,
        requester_role=current_user.role,
        reason=body.reason,
        data_scope=_data_scope(gathered),
        status="pending_review",
    )
    db.add(request)
    await db.commit()
    await db.refresh(request)
    return _to_out(request)


async def list_my_deletion_requests(
    db: AsyncSession, current_user, pagination: Pagination
) -> DataDeletionListResponse:
    base_stmt = select(DataDeletionRequest).where(
        DataDeletionRequest.requester_user_id == current_user.cognito_sub
    )
    total = (
        await db.execute(
            select(func.count())
            .select_from(DataDeletionRequest)
            .where(DataDeletionRequest.requester_user_id == current_user.cognito_sub)
        )
    ).scalar_one()
    rows = (
        await db.execute(
            base_stmt.order_by(DataDeletionRequest.submitted_at.desc())
            .offset(pagination.offset)
            .limit(pagination.page_size)
        )
    ).scalars().all()

    return DataDeletionListResponse(
        results=[_to_out(r) for r in rows],
        page=pagination.page,
        page_size=pagination.page_size,
        total=total,
    )


async def _get_request_or_404(db: AsyncSession, request_id: int) -> DataDeletionRequest:
    request = await db.get(DataDeletionRequest, request_id)
    if request is None:
        raise AppError(404, "Data deletion request not found", "not_found")
    return request


async def get_deletion_request(
    db: AsyncSession, request_id: int, current_user
) -> DataDeletionRequestOut:
    """GET /data-deletion/{id} — the requester (own request only) or admin."""
    request = await _get_request_or_404(db, request_id)
    if (
        current_user.role != "admin"
        and request.requester_user_id != current_user.cognito_sub
    ):
        raise AppError(403, "Not authorized to view this request", "forbidden")
    return _to_out(request)


async def _get_pending_or_409(db: AsyncSession, request_id: int) -> DataDeletionRequest:
    request = await _get_request_or_404(db, request_id)
    if request.status != "pending_review":
        raise AppError(
            409, "This request has already been reviewed", "request_not_pending"
        )
    return request


async def approve_deletion_request(
    db: AsyncSession, request_id: int, admin_sub: str, reviewer_notes: str | None
) -> DataDeletionRequestOut:
    """POST /data-deletion/{id}/approve (admin). Executes the actual
    redaction/deletion in one transaction, then marks the request
    completed. See module docstring for what happens to each table.
    """
    request = await _get_pending_or_409(db, request_id)
    cognito_sub = request.requester_user_id

    gathered = await _gather(db, cognito_sub)

    # Safety guard: a PENDING claim under this identity can't be silently
    # redacted mid-review — admin has to resolve it first (approve/reject
    # via the normal /claim flow) so the claimant identity on record for
    # that decision stays meaningful. See DECISIONS.md.
    pending_claims = [c for c in gathered["claims"] if c.status == "pending_review"]
    if pending_claims:
        raise AppError(
            409,
            "This identity has a pending claim request — resolve it via "
            "/claim/{id}/approve or /claim/{id}/reject before approving "
            "this deletion",
            "pending_claim_blocks_deletion",
        )

    now = datetime.now(timezone.utc)

    # user_follow: hard delete — pure preference data, no retention need.
    for follow in gathered["follows"]:
        await db.delete(follow)

    # location_manager: redact the identifying column, deactivate if
    # still active. On root CLAUDE.md's audit-required table list, so
    # every changed row gets an audit_log entry.
    for manager in gathered["managers"]:
        old_val = {"user_id": manager.user_id, "is_active": manager.is_active}
        manager.user_id = _REDACTED_MARKER
        if manager.is_active:
            manager.is_active = False
            manager.revoked_at = now
        await audit_service.log(
            db,
            table_name="location_manager",
            record_id=manager.id,
            action="update",
            actor_id=admin_sub,
            actor_role="admin",
            old_val=old_val,
            new_val={"user_id": manager.user_id, "is_active": manager.is_active},
        )

    # claim_request: redact the identifying column only. Not on the
    # audit-required table list (same treatment claim_service already
    # gives claim_request's own status transitions — only the resulting
    # restaurant_brand write is audited).
    for claim in gathered["claims"]:
        claim.claimant_user_id = _REDACTED_MARKER

    # owner_account: anonymize in place, never hard-delete (see
    # app/models/owner_account.py docstring). On the audit-required list.
    if gathered["owner"] is not None:
        owner: OwnerAccount = gathered["owner"]
        old_val = {
            "full_name": owner.full_name,
            "phone": owner.phone,
            "email": owner.email,
        }
        owner.full_name = None
        owner.phone = None
        owner.email = f"deleted-owner-{owner.id}@deleted.swarasa.invalid"
        owner.personal_data_deleted_at = now
        await audit_service.log(
            db,
            table_name="owner_account",
            record_id=owner.id,
            action="update",
            actor_id=admin_sub,
            actor_role="admin",
            old_val=old_val,
            new_val={
                "full_name": owner.full_name,
                "phone": owner.phone,
                "email": owner.email,
            },
        )

    # audit_log: deliberately untouched — see module docstring.

    request.status = "completed"
    request.reviewed_by = admin_sub
    request.reviewed_at = now
    request.reviewer_notes = reviewer_notes
    request.completed_at = now

    await db.commit()
    await db.refresh(request)
    return _to_out(request)


async def reject_deletion_request(
    db: AsyncSession, request_id: int, admin_sub: str, reviewer_notes: str
) -> DataDeletionRequestOut:
    """POST /data-deletion/{id}/reject (admin) — e.g. a legal hold or an
    active dispute. Declines without touching any data.
    """
    request = await _get_pending_or_409(db, request_id)
    request.status = "rejected"
    request.reviewed_by = admin_sub
    request.reviewed_at = datetime.now(timezone.utc)
    request.reviewer_notes = reviewer_notes
    await db.commit()
    await db.refresh(request)
    return _to_out(request)
