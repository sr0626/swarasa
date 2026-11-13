"""Flag existing bulk-IMPORTED hidden listings as `import_review` ("Import issues").

Bulk imports now create locations as `import_review` (docs/DECISIONS.md "Bulk
import creates `import_review`"); listings imported BEFORE that change are
`coming_soon`. This one-off command moves exactly those into `import_review`
so the admin Listings page can find them with `?status=import_review`.

A location is changed ONLY when ALL of these hold:
  - its status is currently `coming_soon`;
  - its brand is live (not soft-deleted) and UNCLAIMED (`owner_id IS NULL`) --
    a claimed brand's owner is already handling the listing;
  - its `audit_log` 'create' row for the location has
    `new_val.provenance == 'bulk_import'` (written by the admin /admin/import
    flow) -- so a manually added `coming_soon` listing is never touched.

DRY RUN BY DEFAULT: without `"apply": true` it only REPORTS what would change.
With `"apply": true` it sets `status='import_review'`, writes one `audit_log`
row per changed location (actor `system:mark_imported_for_review`, old/new
status) and commits. Idempotent (a second run finds no `coming_soon` candidate
left). `"location_ids": [67, 68]` limits it to exactly those locations (still
subject to every rule above, so naming a manual listing is a harmless no-op).

The provenance check is done in Python over the candidates' audit rows (not a
JSONB operator in SQL) so it behaves identically on PostgreSQL and the SQLite
test database; the candidate set (hidden + unclaimed + coming soon) is small.

Run via the `mark_imported_for_review` management command (the human runs it --
docs/SCRIPTS.md):
    {"_management_command": "mark_imported_for_review"}                          # dry run
    {"_management_command": "mark_imported_for_review", "apply": true}           # do it
    {"_management_command": "mark_imported_for_review", "apply": true, "location_ids": [67, 68, 69, 70, 71]}
"""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session_factory
from app.models.audit_log import AuditLog
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.scripts.deactivate_incomplete_listings import (
    DeactivateIncompleteError,
    parse_flag,
    parse_location_ids,
)
from app.services import audit_service

logger = logging.getLogger("app.scripts.mark_imported_for_review")

ACTOR_ID = "system:mark_imported_for_review"
PROVENANCE = "bulk_import"
LIST_CAP = 100
_ID_BATCH = 500

# The flag/ids parsers are shared with `deactivate_incomplete_listings`; its
# error type is re-exported so the management wrapper can catch one name.
MarkImportedError = DeactivateIncompleteError
__all__ = [
    "MarkImportedError",
    "mark_imported_for_review",
    "parse_flag",
    "parse_location_ids",
    "run_mark_imported_for_review",
]


async def _bulk_imported_ids(db: AsyncSession, location_ids: list[int]) -> set[int]:
    """Subset of `location_ids` whose audit 'create' row carries
    `new_val.provenance == 'bulk_import'`."""
    found: set[int] = set()
    for start in range(0, len(location_ids), _ID_BATCH):
        batch = location_ids[start : start + _ID_BATCH]
        rows = (
            await db.execute(
                select(AuditLog.record_id, AuditLog.new_val).where(
                    AuditLog.table_name == "restaurant_location",
                    AuditLog.action == "create",
                    AuditLog.record_id.in_(batch),
                )
            )
        ).all()
        for record_id, new_val in rows:
            if isinstance(new_val, dict) and new_val.get("provenance") == PROVENANCE:
                found.add(record_id)
    return found


async def mark_imported_for_review(
    db: AsyncSession,
    *,
    apply: bool = False,
    location_ids: list[int] | None = None,
) -> dict:
    """Flushes and commits only when `apply` is true; a dry run writes nothing."""
    query = (
        select(RestaurantLocation, RestaurantBrand.name)
        .join(RestaurantBrand, RestaurantBrand.id == RestaurantLocation.brand_id)
        .where(
            RestaurantLocation.status == RestaurantLocation.STATUS_COMING_SOON,
            RestaurantBrand.owner_id.is_(None),
            RestaurantBrand.deleted_at.is_(None),
        )
        .order_by(RestaurantLocation.id)
    )
    if location_ids is not None:
        query = query.where(RestaurantLocation.id.in_(location_ids))
    candidates = (await db.execute(query)).all()

    imported_ids = await _bulk_imported_ids(db, [loc.id for loc, _ in candidates])
    matched = [(loc, name) for loc, name in candidates if loc.id in imported_ids]

    changed = 0
    if apply:
        for location, _name in matched:
            location.status = RestaurantLocation.STATUS_IMPORT_REVIEW
            await audit_service.log(
                db,
                table_name="restaurant_location",
                record_id=location.id,
                action="update",
                actor_id=ACTOR_ID,
                actor_role="admin",
                old_val={"status": RestaurantLocation.STATUS_COMING_SOON},
                new_val={"status": RestaurantLocation.STATUS_IMPORT_REVIEW},
            )
            changed += 1
        await db.commit()
        logger.info(
            "marked %s imported listings for review (of %s candidates)", changed, len(candidates)
        )

    return {
        "mode": "apply" if apply else "dry_run",
        "location_ids": location_ids,
        "checked_coming_soon_unclaimed": len(candidates),
        "matched": len(matched),
        "changed": changed,
        "listings": [
            {"location_id": loc.id, "name": name, "city": loc.city}
            for loc, name in matched[:LIST_CAP]
        ],
        "listings_truncated": len(matched) > LIST_CAP,
    }


async def run_mark_imported_for_review(
    *, apply: bool, location_ids: list[int] | None = None
) -> dict:
    async with get_session_factory()() as db:
        return await mark_imported_for_review(db, apply=apply, location_ids=location_ids)
