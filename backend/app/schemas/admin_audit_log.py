"""`GET /admin/audit-log` -- see docs/API_CONTRACTS.md "GET /admin/audit-log".
Read-only admin view over the `audit_log` table."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from app.schemas.utc import UtcDatetime


class AdminAuditLogEntryOut(BaseModel):
    id: int
    table_name: str
    record_id: int
    action: str
    actor_id: str
    actor_role: str
    # Resolved best-effort (batched); null for system actors and unresolved subs.
    actor_email: str | None = None
    # Human label: the email, "deleted account", a system-script label, or the
    # short (8-char) sub when nothing could be resolved.
    actor_label: str
    summary: str
    # Raw before/after JSON snapshots. Plain data: clients MUST render as
    # escaped text. A snapshot over the size cap is replaced by
    # `{"_truncated": true, "_preview": "<first chars as text>"}`.
    old_val: dict[str, Any] | None = None
    new_val: dict[str, Any] | None = None
    created_at: UtcDatetime


class AdminAuditLogResponse(BaseModel):
    results: list[AdminAuditLogEntryOut]
    page: int
    page_size: int
    total: int
    # Distinct `table_name` values in the whole table (NOT narrowed by the
    # filters) -- feeds the entity-type filter menu.
    entity_types: list[str]
    # True when the Cognito email lookup failed (emails null, short subs shown).
    email_lookup_degraded: bool = False
