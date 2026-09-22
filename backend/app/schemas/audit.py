"""Response shapes for `GET /auth/me/activity` — see docs/API_CONTRACTS.md
"GET /auth/me/activity". Kept as its own module (not folded into
`schemas/auth.py`) since it's a distinct sub-resource with its own list
envelope, same reasoning `schemas/location_manager.py`'s docstring gives
for `ManagedLocationOut` living apart from `schemas/location.py`.
"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


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

    created_at: datetime


class OwnerActivityListResponse(BaseModel):
    results: list[OwnerActivityOut]
    page: int
    page_size: int
    total: int
