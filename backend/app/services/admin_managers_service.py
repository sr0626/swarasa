"""`GET /admin/managers` — the admin "Managers" report: one row per person
who holds (or once held) a `location_manager` assignment.

Who is listed (the rule, also in docs/API_CONTRACTS.md): every distinct
`location_manager.user_id` — i.e. anyone with AT LEAST ONE assignment row,
active or revoked. A manager whose assignments were all revoked is still
listed, with `active_location_count = 0`; that is cheap to derive from the
same rows. A Cognito `manager`-group member who was never assigned anywhere
has no local row and is NOT listed (deriving them would need a full Cognito
sweep just to show empty rows).

Data sources, joined in application code (the manager set is small — same
"fetch all, filter/sort/paginate in Python" posture as
`admin_registered_users_service`):
  - `location_manager` ⨝ `restaurant_location` ⨝ `restaurant_brand` — one
    query: assignments, the locations, and each brand's `owner_id`.
  - `owner_account` — one query: the owners they work under.
  - `user_profile` — one query: display name + throttled `last_seen_at`.
  - Cognito — email only (`admin_actor_service.resolve_emails`: at most one
    `ListUsersInGroup` sweep of the `manager` group plus a capped per-sub
    fallback). Best-effort: on failure emails are `null` and the response
    says `email_lookup_degraded`.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.pagination import Pagination
from app.models.location_manager import LocationManager
from app.models.owner_account import OwnerAccount
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.models.user_profile import UserProfile
from app.schemas.admin_managers import (
    AdminManagerOut,
    AdminManagersResponse,
    ManagerLocationOut,
    ManagerOwnerOut,
    ManagerSort,
)
from app.services import admin_actor_service

_CHUNK = 500


def _ts(value: datetime | None) -> float | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.timestamp()


def _sorted_missing_last(items: list[AdminManagerOut], key, *, reverse: bool) -> list[AdminManagerOut]:
    present = [m for m in items if key(m) is not None]
    missing = [m for m in items if key(m) is None]
    present.sort(key=lambda m: (key(m), m.cognito_sub), reverse=reverse)
    missing.sort(key=lambda m: m.cognito_sub)
    return present + missing


def _apply_sort(items: list[AdminManagerOut], sort: ManagerSort) -> list[AdminManagerOut]:
    if sort == "oldest":
        return _sorted_missing_last(items, lambda m: _ts(m.first_assigned_at), reverse=False)
    if sort == "most_locations":
        return sorted(
            items,
            key=lambda m: (-m.active_location_count, -(_ts(m.first_assigned_at) or 0), m.cognito_sub),
        )
    if sort == "email":
        return _sorted_missing_last(
            items, lambda m: m.email.lower() if m.email else None, reverse=False
        )
    if sort == "last_seen":
        return _sorted_missing_last(items, lambda m: _ts(m.last_seen_at), reverse=True)
    return _sorted_missing_last(items, lambda m: _ts(m.first_assigned_at), reverse=True)


def _matches(manager: AdminManagerOut, term: str) -> bool:
    needle = term.lower()
    return needle in (manager.email or "").lower() or needle in (manager.full_name or "").lower()


async def get_admin_managers(
    db: AsyncSession,
    pagination: Pagination,
    search: str | None = None,
    sort: ManagerSort = "newest",
) -> AdminManagersResponse:
    rows = (
        await db.execute(
            select(
                LocationManager.user_id,
                LocationManager.location_id,
                LocationManager.is_active,
                LocationManager.assigned_at,
                RestaurantLocation.brand_id,
                RestaurantLocation.location_name,
                RestaurantLocation.city,
                RestaurantBrand.name,
                RestaurantBrand.owner_id,
                RestaurantBrand.deleted_at,
            )
            .join(RestaurantLocation, RestaurantLocation.id == LocationManager.location_id)
            .join(RestaurantBrand, RestaurantBrand.id == RestaurantLocation.brand_id)
            .order_by(LocationManager.id)
        )
    ).all()
    if not rows:
        return AdminManagersResponse(
            results=[], page=pagination.page, page_size=pagination.page_size, total=0
        )

    subs = sorted({row.user_id for row in rows})
    owner_ids = {
        row.owner_id
        for row in rows
        if row.is_active and row.deleted_at is None and row.owner_id is not None
    }

    owners: dict[int, OwnerAccount] = {}
    if owner_ids:
        owner_rows = (
            (await db.execute(select(OwnerAccount).where(OwnerAccount.id.in_(owner_ids))))
            .scalars()
            .all()
        )
        owners = {o.id: o for o in owner_rows}

    profiles: dict[str, UserProfile] = {}
    for start in range(0, len(subs), _CHUNK):
        chunk = subs[start : start + _CHUNK]
        profile_rows = (
            (await db.execute(select(UserProfile).where(UserProfile.cognito_sub.in_(chunk))))
            .scalars()
            .all()
        )
        profiles.update({p.cognito_sub: p for p in profile_rows})

    resolved, degraded = await admin_actor_service.resolve_emails(
        db, {sub: "manager" for sub in subs}
    )

    by_sub: dict[str, dict] = {
        sub: {"first": None, "locations": [], "owner_ids": []} for sub in subs
    }
    for row in rows:
        entry = by_sub[row.user_id]
        if row.assigned_at is not None and (
            entry["first"] is None or (_ts(row.assigned_at) or 0) < (_ts(entry["first"]) or 0)
        ):
            entry["first"] = row.assigned_at
        if row.is_active and row.deleted_at is None:
            entry["locations"].append(
                ManagerLocationOut(
                    location_id=row.location_id,
                    brand_id=row.brand_id,
                    brand_name=row.name,
                    location_name=row.location_name,
                    city=row.city,
                )
            )
            if row.owner_id is not None and row.owner_id not in entry["owner_ids"]:
                entry["owner_ids"].append(row.owner_id)

    managers: list[AdminManagerOut] = []
    for sub in subs:
        entry = by_sub[sub]
        profile = profiles.get(sub)
        actor = resolved.get(sub)
        entry["locations"].sort(
            key=lambda loc: (loc.brand_name.lower(), loc.city.lower(), loc.location_id)
        )
        manager_owners = []
        for owner_id in entry["owner_ids"]:
            owner = owners.get(owner_id)
            if owner is None:
                continue
            gone = owner.personal_data_deleted_at is not None
            manager_owners.append(
                ManagerOwnerOut(
                    id=owner.id,
                    email=None if gone else owner.email,
                    full_name=None if gone else owner.full_name,
                )
            )
        managers.append(
            AdminManagerOut(
                cognito_sub=sub,
                email=actor.email if actor else None,
                full_name=profile.full_name if profile else None,
                first_assigned_at=entry["first"],
                last_seen_at=profile.last_seen_at if profile else None,
                active_location_count=len(entry["locations"]),
                owners=manager_owners,
                locations=entry["locations"],
            )
        )

    term = (search or "").strip()
    if term:
        managers = [m for m in managers if _matches(m, term)]

    managers = _apply_sort(managers, sort)
    total = len(managers)
    page_slice = managers[pagination.offset : pagination.offset + pagination.page_size]
    return AdminManagersResponse(
        results=page_slice,
        page=pagination.page,
        page_size=pagination.page_size,
        total=total,
        email_lookup_degraded=degraded,
    )
