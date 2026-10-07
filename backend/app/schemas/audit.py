"""Response shapes for `GET /auth/me/activity` — see docs/API_CONTRACTS.md
"GET /auth/me/activity". Kept as its own module (not folded into
`schemas/auth.py`) since it's a distinct sub-resource with its own list
envelope, same reasoning `schemas/location_manager.py`'s docstring gives
for `ManagedLocationOut` living apart from `schemas/location.py`.

Names kept as `OwnerActivity*` even though the endpoint was broadened to
also serve `manager` callers (2026-09-22, see `app/routers/auth.py` and
`app/services/audit_query_service.py`) — the response shape is identical
for both roles (same envelope, same per-row fields; only which rows are
included differs), and renaming would touch every consumer (backend
router/service, frontend types/API client/components) for no behavior
change. Treat `OwnerActivityOut`/`OwnerActivityListResponse` as "one
activity-feed row / page", not "owner-only" despite the name.
"""
from __future__ import annotations

from pydantic import BaseModel

from app.schemas.utc import UtcDatetime


class ActivityChangeOut(BaseModel):
    """One reader-facing change inside an activity event (one table row):
    friendly `label` ("Status", "Address", "Hours (Monday)"), and the old/new
    values already mapped to friendly text ("Live" / "Hidden", "(972)
    555-0142"). `None` = no value (the UI shows a dash). `field` is the stable
    raw key for tests/analytics, never shown."""

    field: str
    label: str
    old: str | None = None
    new: str | None = None


class OwnerActivityOut(BaseModel):
    id: int
    table_name: str
    action: str

    # Who made the change. `actor_role` is the raw audit_log value
    # ("owner" | "manager" | "admin") for badge/filter use; `actor_label`
    # is the human-readable form the UI actually shows ("You", a resolved
    # email, or a role + truncated-id fallback — see
    # `audit_query_service._resolve_actor_label`). `actor_resolved`
    # distinguishes a real resolved identity from the fallback so the
    # frontend can render the gap honestly instead of implying a name was
    # found when it wasn't.
    actor_role: str
    actor_label: str
    actor_resolved: bool

    # Short human-readable summary derived from table_name/action/
    # old_val/new_val (e.g. "Location hours updated") — never the raw
    # JSON diff (task brief: "keep it simple ... not a full JSON diff
    # dump").
    summary: str

    created_at: UtcDatetime

    # --- Added 2026-09-24 (additive; every field above is unchanged) -------
    # Where: the brand ("Restaurant") and, for a location-level event (or a
    # manager-assignment on a location), the location's own name/label.
    # `None` when the row is gone (a permanently deleted location) and no
    # snapshot survives in the audit row.
    brand_id: int | None = None
    restaurant_name: str | None = None
    location_id: int | None = None
    location_name: str | None = None
    # IANA timezone the UI formats `created_at` in (the location's own; brand-
    # level events use the platform default), so server- and client-rendered
    # times agree and carry a timezone label ("CDT").
    timezone: str = "America/Chicago"

    # Who: `actor_email` is the resolved email (also for "You"), `None` when
    # unresolvable; `actor_role_label` is "Owner" | "Manager" | "Platform
    # admin". `actor_label` keeps its meaning: "You", the email, or an honest
    # "a manager"-style fallback (`actor_resolved` false).
    actor_email: str | None = None
    actor_role_label: str = ""

    # What changed: one entry per changed field (see `services/audit_diff.py`
    # for the grouping rules). Empty for a create/delete (or an unchanged
    # save) — the UI then shows `summary` alone.
    changes: list[ActivityChangeOut] = []


class OwnerActivityListResponse(BaseModel):
    results: list[OwnerActivityOut]
    page: int
    page_size: int
    total: int
