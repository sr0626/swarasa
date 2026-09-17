"""audit_log writes — backend/CLAUDE.md "Audit log" pattern, implemented
verbatim. Required on writes to: restaurant_brand, restaurant_location,
location_manager, owner_account (root CLAUDE.md "ALWAYS — Quality";
menu_item/deal don't exist until Phase 2). `owner_account` was missing a
caller until `auth_service.update_me` added one (docs/PROJECT_PLAN.csv
"Broaden PATCH /auth/me beyond owner-only" — found during that fix's
self-review, not a new requirement).

Never commits — the caller commits as part of the same transaction as the
write being audited, so the audit row and the write it describes always
land together (root/backend CLAUDE.md "ALWAYS use database transactions
for multi-step writes").
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog


async def log(
    db: AsyncSession,
    table_name: str,
    record_id: int,
    action: str,
    actor_id: str,
    actor_role: str,
    old_val: dict[str, Any] | None = None,
    new_val: dict[str, Any] | None = None,
) -> None:
    entry = AuditLog(
        table_name=table_name,
        record_id=record_id,
        action=action,
        actor_id=actor_id,
        actor_role=actor_role,
        old_val=old_val,
        new_val=new_val,
    )
    db.add(entry)
    # Do not commit here — caller commits as part of the same transaction.
