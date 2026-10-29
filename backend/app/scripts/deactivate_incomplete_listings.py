"""Hide every LIVE listing that is missing required info (clean-up of data that
went live before the readiness rule applied to imports, e.g. restaurants
imported with no opening hours).

"Required info" is exactly `listing_readiness.missing_for_activation` (name,
full address, valid US phone, all 7 days of hours) -- the same rule that gates
`coming_soon` -> `active` for manual listings. docs/DECISIONS.md "Bulk import
is invisible by default".

DRY RUN BY DEFAULT: with no `apply` flag it only REPORTS (count + a capped list
of what is missing) and changes nothing. With `"apply": true` it sets
`status='coming_soon'` on every currently `active` location whose check fails,
writes one `audit_log` row per changed location (actor
`system:deactivate_incomplete_listings`, old/new status), and commits. It is
idempotent (a hidden location is no longer `active`, so a second run finds
nothing) and never touches a location that is already non-active, complete, or
belongs to a soft-deleted brand. `"only_unclaimed": true` limits it to brands
with `owner_id IS NULL` (e.g. only the imported ones).

Run via the `deactivate_incomplete_listings` management command (the human runs
it -- docs/SCRIPTS.md):
    {"_management_command": "deactivate_incomplete_listings"}                       # dry run
    {"_management_command": "deactivate_incomplete_listings", "apply": true}        # do it
    {"_management_command": "deactivate_incomplete_listings", "apply": true, "only_unclaimed": true}
"""
from __future__ import annotations

import logging
from collections import Counter

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session_factory
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.services import audit_service, hours_service, listing_readiness

logger = logging.getLogger("app.scripts.deactivate_incomplete_listings")

ACTOR_ID = "system:deactivate_incomplete_listings"
LIST_CAP = 100
_HOURS_BATCH = 500


class DeactivateIncompleteError(Exception):
    """Bad input -- returned by the management wrapper as `{"ok": False}`."""


def parse_flag(event: dict, key: str) -> bool:
    """A flag must be absent or a real JSON boolean: a string like "false"
    must never be mistaken for a truthy value on a command that writes."""
    value = event.get(key, False)
    if not isinstance(value, bool):
        raise DeactivateIncompleteError(f"'{key}' must be true or false.")
    return value


async def deactivate_incomplete_listings(
    db: AsyncSession, *, apply: bool = False, only_unclaimed: bool = False
) -> dict:
    """Flushes and commits only when `apply` is true; a dry run writes nothing."""
    query = (
        select(RestaurantLocation, RestaurantBrand.name)
        .join(RestaurantBrand, RestaurantBrand.id == RestaurantLocation.brand_id)
        .where(
            RestaurantLocation.status == RestaurantLocation.STATUS_ACTIVE,
            RestaurantBrand.deleted_at.is_(None),
        )
        .order_by(RestaurantLocation.id)
    )
    if only_unclaimed:
        query = query.where(RestaurantBrand.owner_id.is_(None))
    rows = (await db.execute(query)).all()

    hours_by_location: dict[int, list] = {}
    ids = [location.id for location, _ in rows]
    for start in range(0, len(ids), _HOURS_BATCH):
        hours_by_location.update(
            await hours_service.get_hours_map_for_locations(db, ids[start : start + _HOURS_BATCH])
        )

    incomplete: list[tuple[RestaurantLocation, str, list[str]]] = []
    for location, brand_name in rows:
        missing = listing_readiness.missing_for_activation(
            location, brand_name, hours_by_location.get(location.id, [])
        )
        if missing:
            incomplete.append((location, brand_name, missing))

    changed = 0
    if apply:
        for location, _name, _missing in incomplete:
            location.status = RestaurantLocation.STATUS_COMING_SOON
            await audit_service.log(
                db,
                table_name="restaurant_location",
                record_id=location.id,
                action="update",
                actor_id=ACTOR_ID,
                actor_role="admin",
                old_val={"status": RestaurantLocation.STATUS_ACTIVE},
                new_val={"status": RestaurantLocation.STATUS_COMING_SOON},
            )
            changed += 1
        await db.commit()
        logger.info("deactivated %s incomplete listings (of %s active checked)", changed, len(rows))

    missing_counts = Counter(key for _loc, _name, missing in incomplete for key in missing)
    return {
        "mode": "apply" if apply else "dry_run",
        "only_unclaimed": only_unclaimed,
        "checked_active": len(rows),
        "incomplete": len(incomplete),
        "changed": changed,
        "missing_counts": dict(missing_counts),
        "listings": [
            {
                "location_id": location.id,
                "name": name,
                "city": location.city,
                "missing": missing,
            }
            for location, name, missing in incomplete[:LIST_CAP]
        ],
        "listings_truncated": len(incomplete) > LIST_CAP,
    }


async def run_deactivate_incomplete_listings(*, apply: bool, only_unclaimed: bool) -> dict:
    async with get_session_factory()() as db:
        return await deactivate_incomplete_listings(db, apply=apply, only_unclaimed=only_unclaimed)
