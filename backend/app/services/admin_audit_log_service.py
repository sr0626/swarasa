"""`GET /admin/audit-log` -- the admin audit-log viewer (read-only).

Unlike `audit_query_service` (owner/manager feeds, scoped by entity
ownership), this is the whole `audit_log` table, newest first, filterable by
entity type (`table_name`), action, actor (email or sub) and a UTC date range.

Cost is fixed per page regardless of row count: one COUNT, one page SELECT,
one DISTINCT `table_name` query for the filter menu, and ONE shared actor
email resolution (`admin_actor_service.resolve_emails` -- owner_account in a
single query, then at most one Cognito group sweep per role, then a capped
per-sub fallback). Never one Cognito call per row; any Cognito failure only
degrades emails (`email_lookup_degraded`) and never fails the page.

Snapshots are returned as plain JSON data (the client renders them as escaped
text). Anything bigger than `SNAPSHOT_MAX_CHARS` serialized is replaced with a
text preview so one huge row can't bloat a page.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.pagination import Pagination
from app.models.audit_log import AuditLog
from app.models.owner_account import OwnerAccount
from app.schemas.admin_audit_log import AdminAuditLogEntryOut, AdminAuditLogResponse
from app.services import admin_actor_service, cognito_service
from app.services.audit_query_service import _summarize as _summarize_row

logger = logging.getLogger("app.services.admin_audit_log_service")

SNAPSHOT_MAX_CHARS = 8000
_PREVIEW_CHARS = 2000
# Shorter prefixes are too ambiguous to be a useful actor filter.
_MIN_SUB_PREFIX = 8

# Table written by the admin user-management actions (admin_users_service).
COGNITO_USER_TABLE = "cognito_user"


def bound_snapshot(snapshot: Any) -> dict[str, Any] | None:
    if not isinstance(snapshot, dict):
        return None
    try:
        text = json.dumps(snapshot, default=str, ensure_ascii=False)
    except (TypeError, ValueError):
        return {"_truncated": True, "_preview": "(unserializable snapshot)"}
    if len(text) <= SNAPSHOT_MAX_CHARS:
        return snapshot
    return {"_truncated": True, "_preview": text[:_PREVIEW_CHARS]}


def _summary(row: AuditLog) -> str:
    if row.table_name == COGNITO_USER_TABLE:
        operation = (row.new_val or {}).get("operation") if isinstance(row.new_val, dict) else None
        labels = {
            "disable": "User account disabled",
            "enable": "User account enabled",
            "confirm": "User sign-up confirmed by an administrator",
            "reset-password": "User password reset by an administrator",
        }
        return labels.get(str(operation), "User account updated")
    old = row.old_val if isinstance(row.old_val, dict) else None
    new = row.new_val if isinstance(row.new_val, dict) else None
    return _summarize_row(row.table_name, row.action, old, new)


async def _actor_filter_subs(db: AsyncSession, actor: str) -> list[str] | None:
    """Resolve an email-shaped actor filter to subs; `None` means "not an
    email, treat as a sub / sub prefix". An email that resolves to nothing
    returns `[]` (-> empty result, never "match everything")."""
    if "@" not in actor:
        return None
    subs: set[str] = set()
    rows = (
        await db.execute(
            select(OwnerAccount.cognito_sub).where(
                func.lower(OwnerAccount.email) == actor.lower(),
                OwnerAccount.personal_data_deleted_at.is_(None),
            )
        )
    ).scalars()
    subs.update(s for s in rows if s)
    try:
        sub = cognito_service.find_sub_by_email(actor)
    except Exception as exc:  # noqa: BLE001 - best effort; local owner match may still work
        logger.warning("audit-log actor email lookup failed: %s", type(exc).__name__)
        sub = None
    if sub:
        subs.add(sub)
    return sorted(subs)


def _day_start(day: date) -> datetime:
    return datetime.combine(day, time.min, tzinfo=timezone.utc)


async def get_admin_audit_log(
    db: AsyncSession,
    pagination: Pagination,
    *,
    entity: str | None = None,
    action: str | None = None,
    actor: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> AdminAuditLogResponse:
    conditions = []
    if entity:
        conditions.append(AuditLog.table_name == entity)
    if action:
        conditions.append(AuditLog.action == action)
    # UTC calendar days, both ends inclusive.
    if date_from is not None:
        conditions.append(AuditLog.created_at >= _day_start(date_from))
    if date_to is not None:
        conditions.append(AuditLog.created_at < _day_start(date_to + timedelta(days=1)))

    entity_types = list(
        (
            await db.execute(select(AuditLog.table_name).distinct().order_by(AuditLog.table_name))
        ).scalars()
    )

    actor_term = (actor or "").strip()
    if actor_term:
        subs = await _actor_filter_subs(db, actor_term)
        if subs is None:
            if len(actor_term) >= _MIN_SUB_PREFIX:
                conditions.append(AuditLog.actor_id.startswith(actor_term, autoescape=True))
            else:
                conditions.append(AuditLog.actor_id == actor_term)
        elif subs:
            conditions.append(AuditLog.actor_id.in_(subs))
        else:
            return AdminAuditLogResponse(
                results=[],
                page=pagination.page,
                page_size=pagination.page_size,
                total=0,
                entity_types=entity_types,
            )

    where = and_(*conditions) if conditions else None
    count_stmt = select(func.count()).select_from(AuditLog)
    page_stmt = select(AuditLog)
    if where is not None:
        count_stmt = count_stmt.where(where)
        page_stmt = page_stmt.where(where)
    total = (await db.execute(count_stmt)).scalar_one()
    rows = (
        (
            await db.execute(
                page_stmt.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
                .offset(pagination.offset)
                .limit(pagination.page_size)
            )
        )
        .scalars()
        .all()
    )

    actors: dict[str, str] = {}
    for row in rows:
        actors.setdefault(row.actor_id, row.actor_role)
    resolved, degraded = await admin_actor_service.resolve_emails(db, actors)

    results: list[AdminAuditLogEntryOut] = []
    for row in rows:
        if row.actor_id.startswith(admin_actor_service.SYSTEM_PREFIX):
            label = admin_actor_service.system_actor_label(row.actor_id)
            email = None
        else:
            known = resolved.get(row.actor_id)
            if known is None:
                label, email = admin_actor_service.short_sub(row.actor_id), None
            elif known.deleted:
                label, email = "deleted account", None
            else:
                label, email = known.email or admin_actor_service.short_sub(row.actor_id), known.email
        results.append(
            AdminAuditLogEntryOut(
                id=row.id,
                table_name=row.table_name,
                record_id=row.record_id,
                action=row.action,
                actor_id=row.actor_id,
                actor_role=row.actor_role,
                actor_email=email,
                actor_label=label,
                summary=_summary(row),
                old_val=bound_snapshot(row.old_val),
                new_val=bound_snapshot(row.new_val),
                created_at=row.created_at,
            )
        )

    return AdminAuditLogResponse(
        results=results,
        page=pagination.page,
        page_size=pagination.page_size,
        total=total,
        entity_types=entity_types,
        email_lookup_degraded=degraded,
    )
