"""GET /auth/me/activity — owner-scoped read of `audit_log`.

The app already writes an `audit_log` row for every write on
`restaurant_brand`/`restaurant_location`/`location_manager` (root
CLAUDE.md "ALWAYS write an audit_log entry ..."), including manager edits
made on an owner's behalf, but nothing ever let an owner see that
history. This is that read path.

Scoping: `audit_log` is polymorphic (`table_name` + `record_id`, no real
FK — see `app/models/audit_log.py`'s docstring), so "rows this owner may
see" is computed by tracing each candidate table's own ownership chain
back to `restaurant_brand.owner_id`, NOT by trusting `actor_id` (an
owner's manager writes plenty of audit rows with `actor_id` == the
manager's own sub, not the owner's — those must still show up here) and
NOT by trusting the JWT alone (root CLAUDE.md "NEVER trust JWT claims for
manager location access" — same posture applies to "never trust a claim
about which entities are mine"):

  - `restaurant_brand`   -> owned directly (`owner_id == this owner`)
  - `restaurant_location` -> owned via `brand_id` in the owner's brands
  - `location_manager`   -> owned via `location_id` in the owner's
                             (owned) locations

`menu_item`/`deal` are on root CLAUDE.md's audit-required table list too,
but neither table exists yet (Phase 2 — see backend/CLAUDE.md "Phase 1 —
Do NOT Build Yet"); no `audit_log` row can carry those `table_name`
values today, so they're deliberately left out of the filter rather than
referencing models that don't exist. `owner_account` is also on that
list but is NOT included here on purpose — that's the owner's own
account record, already covered by `GET /auth/me` and
`GET /auth/me/data-export`, not a "thing the owner manages" the way a
brand/location/manager-assignment is (matches the task's own entity
list).

Every SQL scoping check here is a real DB query, never a client-supplied
id trusted at face value — same posture as every `require_*_access`
dependency in `app/dependencies/auth.py`.
"""
from __future__ import annotations

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.pagination import Pagination
from app.models.audit_log import AuditLog
from app.models.location_manager import LocationManager
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.schemas.audit import OwnerActivityListResponse, OwnerActivityOut
from app.services import cognito_service
from app.services.auth_service import get_owner_account_by_sub

_ENTITY_LABELS = {
    "restaurant_brand": "Restaurant",
    "restaurant_location": "Location",
    "location_manager": "Manager assignment",
}

_FIELD_LABELS = {
    "name": "name",
    "description": "description",
    "website": "website",
    "about": "about text",
    "specialties": "specialties",
    "address_line1": "address",
    "address_line2": "address",
    "city": "city",
    "state": "state",
    "postal_code": "postal code",
    "country": "country",
    "phone": "phone number",
    "timezone": "timezone",
    "latitude": "map location",
    "longitude": "map location",
    "is_active": "active status",
    "is_verified": "verification status",
    "is_paid": "paid status",
    "is_claimed": "claim status",
    "hours_updated_days": "hours",
    "user_id": "assigned manager",
    "revoked_at": "manager assignment",
}

_ROLE_LABELS = {
    "owner": "owner",
    "manager": "manager",
    "admin": "platform admin",
}


def _summarize(table_name: str, action: str, old_val: dict | None, new_val: dict | None) -> str:
    """A short, human-readable one-liner for one audit_log row — never the
    raw old_val/new_val JSON (task brief: "keep it simple ... not a full
    JSON diff dump").
    """
    entity = _ENTITY_LABELS.get(table_name, table_name.replace("_", " ").capitalize())
    old_val = old_val or {}
    new_val = new_val or {}

    # location_manager only ever gets created (assign) or updated (the
    # is_active/revoked_at activate-or-revoke toggle — see
    # location_manager_service.py) — call both out specifically rather
    # than the generic "added"/"updated" phrasing, on every action, so
    # this branch runs before the generic create/delete handling below.
    if table_name == "location_manager":
        if action == "create" or (action == "update" and new_val.get("is_active") is True and old_val.get("is_active") is not True):
            return "Manager assigned"
        if action == "update" and new_val.get("is_active") is False:
            return "Manager access revoked"
        if action == "delete":
            return "Manager assignment removed"

    if action == "create":
        return f"{entity} added"
    if action == "delete":
        return f"{entity} removed"

    if table_name == "restaurant_location" and set(old_val) == {"is_active"} and set(new_val) == {"is_active"}:
        return "Location reactivated" if new_val.get("is_active") else "Location deactivated"

    if table_name == "restaurant_brand" and new_val.get("is_claimed") and not old_val.get("is_claimed"):
        return "Restaurant claimed"

    if table_name == "restaurant_location" and "hours_updated_days" in new_val:
        return "Hours updated"

    changed_keys: list[str] = []
    for key, value in new_val.items():
        if old_val.get(key) != value and key not in changed_keys:
            changed_keys.append(key)
    for key in old_val:
        if key not in new_val and key not in changed_keys:
            changed_keys.append(key)

    if not changed_keys:
        return f"{entity} updated"

    labels: list[str] = []
    for key in changed_keys:
        label = _FIELD_LABELS.get(key, key.replace("_", " "))
        if label not in labels:
            labels.append(label)

    return f"{entity} {', '.join(labels)} updated"


def _resolve_actor_label(
    actor_id: str, actor_role: str, current_user, cache: dict[str, tuple[str, bool]]
) -> tuple[str, bool]:
    """Returns `(label, resolved)`. `resolved=True` means `label` is a
    real human-readable identity (the caller themselves, or an email
    resolved via Cognito); `resolved=False` means `label` is the
    role + truncated-id fallback (task brief: "otherwise just show
    actor_role + a truncated actor id and note the gap").

    A Cognito lookup happens at most once per distinct `actor_id` on a
    page (cached in `cache`) — the same "email is a display-only,
    best-effort field" posture `location_manager_service._to_out` and
    `cognito_service.find_email_by_sub` already use, just memoized here
    since a single activity page can repeat the same actor across many
    rows.
    """
    if actor_id == current_user.cognito_sub:
        return "You", True

    if actor_id in cache:
        return cache[actor_id]

    email = None
    try:
        email = cognito_service.find_email_by_sub(actor_id)
    except Exception:  # noqa: BLE001 - display-only field, never break the read path
        email = None

    if email:
        result = (email, True)
    else:
        role_label = _ROLE_LABELS.get(actor_role, actor_role)
        truncated = actor_id[:8] + "…" if len(actor_id) > 8 else actor_id
        result = (f"{role_label} ({truncated})", False)

    cache[actor_id] = result
    return result


async def list_owner_activity(
    db: AsyncSession, current_user, pagination: Pagination
) -> OwnerActivityListResponse:
    """GET /auth/me/activity — auth: owner (see router). Scoped to
    `audit_log` rows whose entity traces back to THIS owner's brands/
    locations only (see module docstring) — never another owner's rows,
    regardless of the row's own `actor_id`/`actor_role`.
    """
    owner = await get_owner_account_by_sub(db, current_user.cognito_sub)
    if owner is None:
        # No local owner_account row yet (e.g. an owner-group user who has
        # never written anything) -> nothing to show, not an error. Same
        # "empty page, not 403/404" posture as
        # `location_manager_service.list_managed_locations` for a caller
        # with no rows.
        return OwnerActivityListResponse(
            results=[], page=pagination.page, page_size=pagination.page_size, total=0
        )

    brand_ids = select(RestaurantBrand.id).where(RestaurantBrand.owner_id == owner.id)
    location_ids = select(RestaurantLocation.id).where(RestaurantLocation.brand_id.in_(brand_ids))
    manager_ids = select(LocationManager.id).where(LocationManager.location_id.in_(location_ids))

    ownership_filter = or_(
        and_(AuditLog.table_name == "restaurant_brand", AuditLog.record_id.in_(brand_ids)),
        and_(AuditLog.table_name == "restaurant_location", AuditLog.record_id.in_(location_ids)),
        and_(AuditLog.table_name == "location_manager", AuditLog.record_id.in_(manager_ids)),
    )

    total = (
        await db.execute(select(func.count()).select_from(AuditLog).where(ownership_filter))
    ).scalar_one()

    rows = (
        await db.execute(
            select(AuditLog)
            .where(ownership_filter)
            .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
            .offset(pagination.offset)
            .limit(pagination.page_size)
        )
    ).scalars().all()

    actor_cache: dict[str, tuple[str, bool]] = {}
    results: list[OwnerActivityOut] = []
    for row in rows:
        label, resolved = _resolve_actor_label(row.actor_id, row.actor_role, current_user, actor_cache)
        results.append(
            OwnerActivityOut(
                id=row.id,
                table_name=row.table_name,
                action=row.action,
                actor_role=row.actor_role,
                actor_label=label,
                actor_resolved=resolved,
                summary=_summarize(row.table_name, row.action, row.old_val, row.new_val),
                created_at=row.created_at,
            )
        )

    return OwnerActivityListResponse(
        results=results, page=pagination.page, page_size=pagination.page_size, total=total
    )
