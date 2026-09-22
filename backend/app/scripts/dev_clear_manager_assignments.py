"""Dev/test utility: soft-remove (deactivate) one manager's active
`location_manager` assignments, so the manager cap / cross-owner /
reassignment paths added in `app/services/location_manager_service.py`
can be exercised repeatedly by hand against the real dev site without
manually clicking through "remove manager" in the owner portal for each
assignment.

NOT the manager-initiated `DELETE /locations/{id}/managers/{manager_id}`
endpoint (that stays the real, owner/admin-only, audited API path this
script also uses under the hood) -- this is a batch convenience wrapper
around the same `location_manager_service.deactivate_manager`-equivalent
write, callable by manager email instead of needing each assignment's id,
and reachable from a developer's own machine the same way
`dev_unclaim_restaurants.py` reaches `dev_unclaim_restaurants`.

Same soft-delete posture as everywhere else in this schema (root
CLAUDE.md "NEVER delete or truncate any DB table"): sets `is_active=false`
+ `revoked_at=now()`, writes one `audit_log` row per row touched, never
hard-deletes. Reversible: re-assign the manager via `POST
/locations/{id}/managers` (or the API/UI) afterward.

Run via the `dev_clear_manager_assignments` management command:
    aws lambda invoke --function-name <fn> \\
        --payload '{"_management_command": "dev_clear_manager_assignments", \\
                     "manager_email": "manager@example.com"}' \\
        --cli-binary-format raw-in-base64-out out.json
Optional payload key `location_ids` (list[int]) scopes the clear to just
those locations; omitted, ALL of that manager's active assignments are
cleared.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session_factory
from app.models.location_manager import LocationManager
from app.services import audit_service
from app.services.cognito_service import find_sub_by_email


class ClearManagerAssignmentsError(Exception):
    """Raised when `manager_email` doesn't resolve to a Cognito user."""


async def clear_manager_assignments(
    db: AsyncSession, manager_email: str, location_ids: list[int] | None = None
) -> dict:
    """Flushes but does not commit -- the caller owns the transaction (same
    pattern as `dev_unclaim.unclaim_restaurants`)."""
    sub = find_sub_by_email(manager_email)
    if sub is None:
        raise ClearManagerAssignmentsError(
            f"No Cognito user found for email {manager_email!r} (no_such_user)."
        )

    stmt = select(LocationManager).where(
        LocationManager.user_id == sub, LocationManager.is_active == True  # noqa: E712
    )
    if location_ids:
        stmt = stmt.where(LocationManager.location_id.in_(location_ids))
    rows = (await db.execute(stmt)).scalars().all()

    cleared_location_ids: list[int] = []
    for row in rows:
        old_val = {"is_active": row.is_active, "revoked_at": None}
        row.is_active = False
        row.revoked_at = datetime.now(timezone.utc)
        await audit_service.log(
            db,
            table_name="location_manager",
            record_id=row.id,
            action="update",
            actor_id="system:dev_clear_manager_assignments",
            actor_role="admin",
            old_val=old_val,
            new_val={"is_active": False, "revoked_at": row.revoked_at.isoformat()},
        )
        cleared_location_ids.append(row.location_id)

    await db.flush()
    return {
        "manager_email": manager_email,
        "manager_sub": sub,
        "cleared_location_ids": cleared_location_ids,
    }


async def run_clear_manager_assignments(
    manager_email: str, location_ids: list[int] | None = None
) -> dict:
    session_factory = get_session_factory()
    async with session_factory() as db:
        result = await clear_manager_assignments(db, manager_email, location_ids)
        await db.commit()
    return result
