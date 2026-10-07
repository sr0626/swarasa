"""Who created a brand / location, for the admin Listings page
(`GET /admin/listings`, docs/API_CONTRACTS.md).

Source of truth is `audit_log`: every brand/location create writes a
`create` row whose `actor_id` is the caller's Cognito `sub` (or a
`system:<script>` marker for non-interactive actors) and `actor_role` is
owner|manager|admin (root CLAUDE.md "ALWAYS — Quality"). The EARLIEST create
row per record wins. A record with no audit row (predates audit logging /
purged) falls back to its own `created_at` and an unknown creator — never a
guess.

Email resolution is batched and best-effort, never N+1 (`resolve_emails`):
  1. ONE `owner_account` query for every non-system sub (owners, and any
     actor who is also an owner) — a CCPA-deleted owner resolves to "no
     email", never the tombstone value.
  2. For subs still unknown: ONE Cognito `ListUsersInGroup` sweep per
     distinct role seen (`manager`, `admin`) — a whole group in 1-2 calls.
  3. Last resort: `find_email_by_sub` per remaining sub, capped
     (`PER_SUB_LOOKUP_CAP`) so a page of odd rows can't fan out into dozens
     of Cognito calls.
Any Cognito failure is swallowed (logged by exception type only) and the
sub degrades to its short form — a display-only enrichment must never fail
the admin page. Results live for one request only (the returned dict).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog
from app.models.owner_account import OwnerAccount
from app.schemas.admin_listings import CreatorOut
from app.services import cognito_service

logger = logging.getLogger("app.services.admin_actor_service")

SYSTEM_PREFIX = "system:"
PER_SUB_LOOKUP_CAP = 10
_HUMAN_ROLES = ("owner", "manager", "admin")
_ROLE_TO_GROUP = {
    "manager": cognito_service.MANAGER_GROUP,
    "admin": cognito_service.ADMIN_GROUP,
}


@dataclass(frozen=True)
class ResolvedActor:
    email: str | None
    # An owner whose CCPA deletion was executed — shown as "(deleted account)".
    deleted: bool = False


def short_sub(sub: str) -> str:
    return sub[:8]


def system_actor_label(actor_id: str) -> str:
    """Human label for a `system:<script>` actor: bulk imports read
    "import", the seed script "seed", anything else its script name."""
    name = actor_id[len(SYSTEM_PREFIX) :] if actor_id.startswith(SYSTEM_PREFIX) else actor_id
    if "import" in name:
        return "import"
    if "seed" in name:
        return "seed"
    return name.replace("_", " ") or "system"


def classify_role(actor_id: str, actor_role: str) -> str:
    """owner|manager|admin for a signed-in actor, `system` for scripts."""
    if actor_id.startswith(SYSTEM_PREFIX) or actor_role not in _HUMAN_ROLES:
        return "system"
    return actor_role


async def resolve_emails(
    db: AsyncSession, actors: dict[str, str]
) -> tuple[dict[str, ResolvedActor], bool]:
    """`actors` maps sub -> role (as recorded in the audit row). Returns
    `(resolved, degraded)`: a `ResolvedActor` for every sub that could be
    resolved (unresolvable subs are simply absent — callers fall back to
    `short_sub`), and `degraded=True` when a Cognito lookup FAILED (as
    opposed to a sub simply not being found)."""
    subs = {sub for sub in actors if not sub.startswith(SYSTEM_PREFIX)}
    resolved: dict[str, ResolvedActor] = {}
    degraded = False
    if not subs:
        return resolved, degraded

    rows = (
        await db.execute(
            select(
                OwnerAccount.cognito_sub,
                OwnerAccount.email,
                OwnerAccount.personal_data_deleted_at,
            ).where(OwnerAccount.cognito_sub.in_(subs))
        )
    ).all()
    for sub, email, deleted_at in rows:
        resolved[sub] = (
            ResolvedActor(email=None, deleted=True)
            if deleted_at is not None
            else ResolvedActor(email=email)
        )

    unresolved = subs - resolved.keys()
    if not unresolved:
        return resolved, degraded

    groups = {
        _ROLE_TO_GROUP[actors[sub]] for sub in unresolved if actors[sub] in _ROLE_TO_GROUP
    }
    for group in sorted(groups):
        try:
            for sub, email in cognito_service.list_group_emails(group).items():
                if sub in unresolved:
                    resolved[sub] = ResolvedActor(email=email)
        except Exception as exc:  # noqa: BLE001 - display-only enrichment, never fail the page
            degraded = True
            logger.warning("actor email lookup for group %r failed: %s", group, type(exc).__name__)

    if degraded:
        # Cognito is failing — don't fan out into per-sub calls that will fail too.
        return resolved, degraded

    remaining = sorted(unresolved - resolved.keys())[:PER_SUB_LOOKUP_CAP]
    for sub in remaining:
        try:
            email = cognito_service.find_email_by_sub(sub)
        except Exception as exc:  # noqa: BLE001
            degraded = True
            logger.warning("actor email lookup failed: %s", type(exc).__name__)
            break
        if email:
            resolved[sub] = ResolvedActor(email=email)
    return resolved, degraded


async def _earliest_create_rows(
    db: AsyncSession, table_name: str, record_ids: list[int]
) -> dict[int, tuple[str, str, datetime]]:
    """record_id -> (actor_id, actor_role, created_at) of its earliest
    `create` audit row. One query."""
    if not record_ids:
        return {}
    rows = (
        await db.execute(
            select(
                AuditLog.record_id,
                AuditLog.actor_id,
                AuditLog.actor_role,
                AuditLog.created_at,
            )
            .where(
                AuditLog.table_name == table_name,
                AuditLog.action == "create",
                AuditLog.record_id.in_(record_ids),
            )
            .order_by(AuditLog.id)
        )
    ).all()
    earliest: dict[int, tuple[str, str, datetime]] = {}
    for record_id, actor_id, actor_role, created_at in rows:
        earliest.setdefault(record_id, (actor_id, actor_role, created_at))
    return earliest


def _to_creator(
    audit: tuple[str, str, datetime] | None,
    fallback_created_at: datetime | None,
    resolved: dict[str, ResolvedActor],
) -> CreatorOut:
    if audit is None:
        return CreatorOut(created_at=fallback_created_at)
    actor_id, actor_role, created_at = audit
    role = classify_role(actor_id, actor_role)
    if role == "system":
        return CreatorOut(
            created_at=created_at,
            created_by_role="system",
            created_by_label=system_actor_label(actor_id),
        )
    actor = resolved.get(actor_id)
    if actor is None:
        label = short_sub(actor_id)
        email = None
    elif actor.deleted:
        label, email = "deleted account", None
    else:
        label, email = actor.email, actor.email
    return CreatorOut(
        created_at=created_at,
        created_by_role=role,  # type: ignore[arg-type]
        created_by_email=email,
        created_by_label=label,
    )


async def load_creators(
    db: AsyncSession,
    *,
    brands: dict[int, datetime | None],
    locations: dict[int, datetime | None],
) -> tuple[dict[int, CreatorOut], dict[int, CreatorOut]]:
    """Creator info for brands and locations together (`{id: fallback
    created_at}` in, `{id: CreatorOut}` out for each). Query cost is fixed —
    two audit queries plus one shared email resolution — regardless of how
    many records are passed."""
    brand_audit = await _earliest_create_rows(db, "restaurant_brand", list(brands))
    location_audit = await _earliest_create_rows(db, "restaurant_location", list(locations))

    actors: dict[str, str] = {}
    for actor_id, actor_role, _ in [*brand_audit.values(), *location_audit.values()]:
        actors.setdefault(actor_id, actor_role)
    resolved, _degraded = await resolve_emails(db, actors)

    return (
        {bid: _to_creator(brand_audit.get(bid), fb, resolved) for bid, fb in brands.items()},
        {lid: _to_creator(location_audit.get(lid), fb, resolved) for lid, fb in locations.items()},
    )
