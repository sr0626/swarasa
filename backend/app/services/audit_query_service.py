"""GET /auth/me/activity — owner- and manager-scoped reads of `audit_log`.

The app already writes an `audit_log` row for every write on
`restaurant_brand`/`restaurant_location`/`location_manager` (root
CLAUDE.md "ALWAYS write an audit_log entry ..."), including manager edits
made on an owner's behalf, but nothing ever let an owner (or, as of
2026-09-22, a manager) see that history. This is that read path.

Scoping: `audit_log` is polymorphic (`table_name` + `record_id`, no real
FK — see `app/models/audit_log.py`'s docstring), so "rows this caller may
see" is computed by tracing each candidate table's own ownership/
assignment chain, NOT by trusting `actor_id` (an owner's manager writes
plenty of audit rows with `actor_id` == the manager's own sub, not the
owner's — those must still show up in the owner's feed) and NOT by
trusting the JWT alone (root CLAUDE.md "NEVER trust JWT claims for
manager location access" — same posture applies to "never trust a claim
about which entities are mine").

**Two roles, two table sets, one query shape** (`_list_activity` below
does the actual count/fetch/serialize; `list_owner_activity` and
`list_manager_activity` each just build the `ownership_filter` for their
role and call it — a role parameter was considered but two small
filter-builders read clearer than one function branching internally on
`current_user.role` for what is, structurally, a different ownership
chain per role):

  - **Owner** (`list_owner_activity`, unchanged from the original
    2026-09-22 version of this endpoint):
      - `restaurant_brand`    -> owned directly (`owner_id == this owner`)
      - `restaurant_location` -> owned via `brand_id` in the owner's brands
      - `location_manager`    -> owned via `location_id` in the owner's
                                  (owned) locations
    i.e. everything the entity-ownership chain reaches, including
    manager-assignment changes (who got assigned/removed on the owner's
    locations) — that visibility is the owner's alone (see "manager"
    below).

  - **Manager** (`list_manager_activity`, new): scoped to the manager's
    own CURRENTLY-active `location_manager` assignments
    (`user_id == this manager`, `is_active == true` — same "trust the
    table, not the JWT" posture, and the same active-only condition
    `location_manager_service.list_managed_locations` already uses for
    "my locations"):
      - `restaurant_location` -> one of the manager's assigned locations
      - `restaurant_brand`    -> the brand of one of those locations
                                 (brand-level content like name/
                                 description/website still shows up on
                                 every location page under it, so it's
                                 the manager's business too)
    Deliberately EXCLUDED, by table, not by field:
      - `location_manager` entirely — a manager has no business seeing
        who else got assigned or removed from a location, or their own
        assignment history; that visibility is owner-only (task brief:
        "no visibility into audit rows about OTHER managers being
        assigned/removed"). Since `restaurant_brand`/`restaurant_location`
        never carry payment/billing fields (`is_paid`/`paid_until` are
        not in `location_service._AUDITED_FIELDS` — see that module; the
        only paths that ever change `is_paid` are the Stripe webhook and
        an admin free-offer grant, NEITHER of which exists yet in Phase 1,
        and NEITHER of which writes `actor_role="owner"`/`"manager"` even
        once built), there is no separate "billing" table filter needed
        to keep payment internals out of a manager's feed — excluding
        `location_manager` and nothing else already achieves it. `deal`
        would belong in both roles' sets once it exists (Phase 2) — left
        out now for the same "table doesn't exist yet" reason as
        `menu_item` below.
      - `owner_account` — never a manager's business, and excluded from
        the owner's own feed for the same reason (see below).

  A manager's set is therefore a strict subset of the owner's:
  `{restaurant_brand, restaurant_location}` vs.
  `{restaurant_brand, restaurant_location, location_manager}`.

**"Internal system" noise — checked, none exists** (task brief: filter it
out if real, don't invent a filter otherwise). Every `audit_service.log()`
call site in `/backend/app/services/*.py` was audited: all of them pass
`actor_role` in `{"owner", "manager", "admin"}` with a real Cognito `sub`
as `actor_id` — including the admin-review paths
(`claim_service.approve_claim`, `location_reopen_service.
approve_reopen_request`, `privacy_service`'s admin deletion-execution
path), which are human admin actions taken through an admin console, not
scheduled/automated jobs. There is no EventBridge cron Lambda, migration
backfill, or other non-human writer of `audit_log` anywhere in the
codebase today (root CLAUDE.md's single EventBridge cron Lambda is for
Phase 2 deal expiry, which doesn't exist yet). So: nothing here is
speculative — every row already in scope for either role is a genuine
human/business-relevant change, and no additional "hide system noise"
filter was added because there is currently nothing for it to hide.

`menu_item`/`deal` are on root CLAUDE.md's audit-required table list too,
but neither table exists yet (Phase 2 — see backend/CLAUDE.md "Phase 1 —
Do NOT Build Yet"); no `audit_log` row can carry those `table_name`
values today, so they're deliberately left out of both filters rather
than referencing models that don't exist. `owner_account` is also on
that list but is NOT included in the owner's own feed on purpose —
that's the owner's own account record, already covered by `GET /auth/me`
and `GET /auth/me/data-export`, not a "thing the owner manages" the way
a brand/location/manager-assignment is (matches the task's own entity
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


async def _list_activity(
    db: AsyncSession,
    current_user,
    pagination: Pagination,
    ownership_filter,
) -> OwnerActivityListResponse:
    """Shared count/fetch/serialize for both roles — `list_owner_activity`
    and `list_manager_activity` differ only in how `ownership_filter` (a
    SQLAlchemy boolean expression over `AuditLog.table_name`/`record_id`)
    is built; everything after that — pagination, ordering, actor-label
    resolution, summarization — is identical.
    """
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


def _empty_page(pagination: Pagination) -> OwnerActivityListResponse:
    return OwnerActivityListResponse(
        results=[], page=pagination.page, page_size=pagination.page_size, total=0
    )


async def list_owner_activity(
    db: AsyncSession, current_user, pagination: Pagination
) -> OwnerActivityListResponse:
    """GET /auth/me/activity — auth: owner (see router). Scoped to
    `audit_log` rows whose entity traces back to THIS owner's brands/
    locations/manager-assignments only (see module docstring's "Owner"
    section) — never another owner's rows, regardless of the row's own
    `actor_id`/`actor_role`.
    """
    owner = await get_owner_account_by_sub(db, current_user.cognito_sub)
    if owner is None:
        # No local owner_account row yet (e.g. an owner-group user who has
        # never written anything) -> nothing to show, not an error. Same
        # "empty page, not 403/404" posture as
        # `location_manager_service.list_managed_locations` for a caller
        # with no rows.
        return _empty_page(pagination)

    brand_ids = select(RestaurantBrand.id).where(RestaurantBrand.owner_id == owner.id)
    location_ids = select(RestaurantLocation.id).where(RestaurantLocation.brand_id.in_(brand_ids))
    manager_ids = select(LocationManager.id).where(LocationManager.location_id.in_(location_ids))

    ownership_filter = or_(
        and_(AuditLog.table_name == "restaurant_brand", AuditLog.record_id.in_(brand_ids)),
        and_(AuditLog.table_name == "restaurant_location", AuditLog.record_id.in_(location_ids)),
        and_(AuditLog.table_name == "location_manager", AuditLog.record_id.in_(manager_ids)),
    )

    return await _list_activity(db, current_user, pagination, ownership_filter)


async def list_manager_activity(
    db: AsyncSession, current_user, pagination: Pagination
) -> OwnerActivityListResponse:
    """GET /auth/me/activity — auth: manager (see router). Scoped to
    customer-facing-relevant `audit_log` rows on THIS manager's currently
    active assigned locations only (see module docstring's "Manager"
    section) — `restaurant_location`/`restaurant_brand` rows for those
    locations/their brands, NEVER `location_manager` rows (no visibility
    into other managers' assignments, or the manager's own), and never
    another manager's locations, regardless of the row's own `actor_id`/
    `actor_role` (an owner's own edit to the manager's assigned location
    shows up here too, same "trace the entity, not the actor" posture as
    the owner's feed).

    `is_active == True` mirrors `location_manager_service.
    list_managed_locations` — a manager who has been unassigned from a
    location stops seeing its activity going forward, same as it drops
    out of "my locations". No local "manager_account" row to look up
    first (unlike `list_owner_activity`'s `owner` lookup) — the
    `location_manager` table IS the manager's own record, so an
    empty-assignment manager naturally gets an empty page via the `IN`
    subqueries below without a separate existence check.
    """
    location_ids = select(LocationManager.location_id).where(
        LocationManager.user_id == current_user.cognito_sub,
        LocationManager.is_active == True,  # noqa: E712
    )
    brand_ids = select(RestaurantLocation.brand_id).where(RestaurantLocation.id.in_(location_ids))

    ownership_filter = or_(
        and_(AuditLog.table_name == "restaurant_location", AuditLog.record_id.in_(location_ids)),
        and_(AuditLog.table_name == "restaurant_brand", AuditLog.record_id.in_(brand_ids)),
    )

    return await _list_activity(db, current_user, pagination, ownership_filter)
