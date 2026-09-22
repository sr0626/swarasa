"""DEV-ONLY: force-set a `restaurant_location.status` directly, bypassing the
normal owner-self-service (`POST /locations/{id}/status`) and admin-reopen
(`/location-reopen-requests/{id}/approve`) API paths -- for manually
exercising the status lifecycle on the real dev site/DB (search visibility,
direct-URL 404s, owner console rendering, the "coming soon" section) without
needing a matching owner Cognito session for every transition, including the
one transition (`closed_pending_reopen` -> `active`) that the normal APIs
deliberately make one-way for an owner.

Same "no NAT Gateway / no bastion / no RDS Data API -> run inside the
deployed Lambda via the management-command dispatch table" reasoning as
`dev_unclaim.py` and `app/scripts/management.py`'s own module docstring.

Reversible -- just run it again with a different `--status`. Writes an
audit_log row (root CLAUDE.md "ALWAYS write an audit_log entry ... on
restaurant_location"), same shape as `location_service.update_location_status`
would write, actor tagged `system:dev_set_location_status` so it's
distinguishable in the audit trail from a real owner/admin action. Never run
against production.

Run via the `dev_set_location_status` management command:
    aws lambda invoke --function-name <fn> \\
        --payload '{"_management_command": "dev_set_location_status", \\
                     "location_id": 123, "status": "coming_soon"}' \\
        --cli-binary-format raw-in-base64-out out.json
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session_factory
from app.models.restaurant_location import RestaurantLocation
from app.services import audit_service


class DevSetLocationStatusError(Exception):
    """Raised for a bad location_id/status -- caught by the management
    command wrapper and returned as `{"ok": False, "error": ...}`, same
    pattern as `BulkImportError`/`ClearManagerAssignmentsError`."""


async def set_location_status(db: AsyncSession, location_id: int, new_status: str) -> dict:
    """Flushes (does not commit) -- caller owns the transaction, same
    "testable core, session-factory wrapper for the Lambda entry point"
    split as `dev_unclaim.py`'s `unclaim_restaurants`/`run_dev_unclaim`."""
    if new_status not in RestaurantLocation.STATUSES:
        raise DevSetLocationStatusError(
            f"Unknown status {new_status!r}. Valid values: {list(RestaurantLocation.STATUSES)}"
        )

    location = await db.get(RestaurantLocation, location_id)
    if location is None:
        raise DevSetLocationStatusError(f"No restaurant_location with id={location_id}")

    old_status = location.status
    if old_status == new_status:
        return {
            "location_id": location_id,
            "old_status": old_status,
            "new_status": new_status,
            "changed": False,
        }

    location.status = new_status
    await audit_service.log(
        db,
        table_name="restaurant_location",
        record_id=location.id,
        action="update",
        actor_id="system:dev_set_location_status",
        actor_role="admin",
        old_val={"status": old_status},
        new_val={"status": new_status},
    )
    await db.flush()
    return {
        "location_id": location_id,
        "old_status": old_status,
        "new_status": new_status,
        "changed": True,
    }


async def run_dev_set_location_status(location_id: int, new_status: str) -> dict:
    session_factory = get_session_factory()
    async with session_factory() as db:
        result = await set_location_status(db, location_id, new_status)
        await db.commit()
        return result
