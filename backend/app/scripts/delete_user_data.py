"""Dev/test utility: delete one user's local DB rows so the same email can
be reused across manual sign-up tests, without leaving stale rows behind
from a prior attempt.

NOT the CCPA deletion flow (app/services/privacy_service.py) -- that's a
real end-user right, admin-reviewed, and deliberately redacts/anonymizes
rather than hard-deleting (audit_log retained, owner_account anonymized in
place -- see docs/DECISIONS.md "CCPA data export/deletion"). This is the
opposite: an unreviewed, immediate, full removal, meant only for a
developer clearing out their own throwaway test account. Never point this
at a real user's data.

Ownership hierarchy safety (root CLAUDE.md "Ownership hierarchy"):
restaurant_brand.owner_id is ON DELETE SET NULL (see
app/models/restaurant_brand.py), so deleting an owner_account row never
hard-deletes a brand/location -- it just unclaims it. If the test owner
actually created real brands/locations, this reports them (unclaimed_brand_
count) rather than silently destroying platform content; the caller decides
whether that's expected for their test.

Every other table this touches keys off Cognito `sub` as a bare string
column, not a foreign key to owner_account (location_manager.user_id,
claim_request.claimant_user_id, user_follow.user_id, user_profile.cognito_sub,
data_deletion_request.requester_user_id, audit_log.actor_id -- see each
model's own docstring for why), so this deletes by that string directly.
"""
from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session_factory
from app.models.audit_log import AuditLog
from app.models.claim_request import ClaimRequest
from app.models.data_deletion_request import DataDeletionRequest
from app.models.location_manager import LocationManager
from app.models.owner_account import OwnerAccount
from app.models.user_activity_event import UserActivityEvent
from app.models.user_follow import UserFollow
from app.models.user_profile import UserProfile
from app.services.cognito_service import find_sub_by_email


class DeleteUserDataError(Exception):
    """Raised when the target user can't be resolved or found."""


async def delete_user_data(
    email: str | None = None,
    cognito_sub: str | None = None,
    *,
    db: AsyncSession | None = None,
) -> dict:
    """`db` is normally left unset (a real session is opened via
    `get_session_factory()`, same as `seed_dev_data.run_seed`) -- the
    parameter exists so tests can inject the in-memory SQLite session from
    `tests/integration/conftest.py`'s `db_session` fixture instead.
    """
    if not email and not cognito_sub:
        raise DeleteUserDataError("Provide either email or cognito_sub.")

    sub = cognito_sub
    if not sub:
        sub = find_sub_by_email(email)  # sync boto3 call, same as elsewhere
        if not sub:
            raise DeleteUserDataError(
                f"No Cognito user found for email {email!r} -- nothing to delete "
                "locally either way (this only cleans local DB rows; the "
                "Cognito user itself, if it still exists under a different "
                "state, is not touched by this function)."
            )

    if db is not None:
        return await _delete_rows(db, sub)

    session_factory = get_session_factory()
    async with session_factory() as owned_db:
        return await _delete_rows(owned_db, sub)


async def _delete_rows(db: AsyncSession, sub: str) -> dict:
    counts: dict[str, int] = {}

    for label, model, column in (
        ("location_manager", LocationManager, LocationManager.user_id),
        ("claim_request", ClaimRequest, ClaimRequest.claimant_user_id),
        ("user_follow", UserFollow, UserFollow.user_id),
        ("user_activity_event", UserActivityEvent, UserActivityEvent.user_sub),
        ("user_profile", UserProfile, UserProfile.cognito_sub),
        (
            "data_deletion_request",
            DataDeletionRequest,
            DataDeletionRequest.requester_user_id,
        ),
        ("audit_log", AuditLog, AuditLog.actor_id),
    ):
        result = await db.execute(delete(model).where(column == sub))
        counts[label] = result.rowcount or 0

    owner_result = await db.execute(
        select(OwnerAccount).where(OwnerAccount.cognito_sub == sub)
    )
    owner = owner_result.scalar_one_or_none()
    unclaimed_brand_count = 0
    owner_account_deleted = False
    if owner is not None:
        # Triggers the ON DELETE SET NULL on restaurant_brand.owner_id at
        # the DB level -- brands are never destroyed here.
        await db.refresh(owner, attribute_names=["brands"])
        unclaimed_brand_count = len(owner.brands)
        await db.delete(owner)
        owner_account_deleted = True

    await db.commit()

    return {
        "ok": True,
        "cognito_sub": sub,
        "owner_account_deleted": owner_account_deleted,
        "unclaimed_brand_count": unclaimed_brand_count,
        "rows_deleted": counts,
    }
