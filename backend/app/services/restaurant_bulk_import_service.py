"""Bulk-import service for restaurant basic details.

Reusable capability requested separately from any specific data set: an
admin (via HTTP, `POST /admin/restaurants/bulk-import`) or a one-off
Lambda management command (`app/scripts/management.py`'s
`bulk_import_restaurants`) can hand this a list of restaurant "basic
detail" rows plus a single `owner_id`, and it creates one `restaurant_brand`
+ one `restaurant_location` per row, all owned by that one owner.

Idempotency (same natural-key pattern `app/scripts/seed_dev_data.py`
already uses, see that module's "Idempotency" docstring section):
  - `restaurant_brand`: natural key is a deterministic slug derived from
    `restaurant_service.slugify(name)` -- NOT the random-suffix-on-collision
    behavior `restaurant_service._unique_slug` uses for user-submitted
    `POST /restaurants` (that would make two runs of the same input produce
    two different slugs, defeating idempotency here). Re-running this
    service with the same `name` always recomputes the same slug, finds
    the existing row, and skips creating a duplicate.
  - `restaurant_location`: natural key is `(brand_id, address_line1)`,
    identical to `seed_dev_data.ensure_location`.

Partial failure: this is used both from an HTTP request (one admin click)
and a script (one Lambda invoke) importing many rows at once -- one bad
row must not abort the whole batch. Each row runs inside its own SAVEPOINT
(`AsyncSession.begin_nested`) so a failure on row N rolls back only that
row's writes and the loop continues; the caller still gets a clean,
per-row created/skipped/error account instead of an all-or-nothing
exception.

audit_log: written for every created `restaurant_brand` and
`restaurant_location` row (root CLAUDE.md "ALWAYS write an audit_log entry
for every write on: restaurant_brand, restaurant_location, ..."), same
shape as `seed_dev_data.py`'s and `restaurant_service.py`'s own writes.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from enum import Enum

from geoalchemy2.functions import ST_MakePoint, ST_SetSRID
from pydantic import ValidationError
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.schemas.restaurant_bulk_import import RestaurantBasicDetailIn
from app.services import audit_service
from app.services.restaurant_service import slugify

_MAX_ROWS_PER_BATCH = 500  # sanity cap -- generous for a manual admin batch


class RowStatus(str, Enum):
    CREATED = "created"
    SKIPPED = "skipped"
    ERROR = "error"


@dataclass
class RowResult:
    index: int
    name: str
    status: RowStatus
    brand_id: int | None = None
    location_id: int | None = None
    detail: str | None = None


@dataclass
class BulkImportResult:
    created: int = 0
    skipped: int = 0
    errors: int = 0
    rows: list[RowResult] = field(default_factory=list)

    def add(self, result: RowResult) -> None:
        self.rows.append(result)
        if result.status is RowStatus.CREATED:
            self.created += 1
        elif result.status is RowStatus.SKIPPED:
            self.skipped += 1
        else:
            self.errors += 1


class BulkImportError(Exception):
    """Raised for a batch-level problem (bad owner_id, empty/oversized
    batch) -- distinct from a per-row error, which is captured in
    `RowResult` instead of raising.
    """


def _to_decimal(value: float | None) -> Decimal | None:
    # Same conversion app/services/location_service.py's `_to_decimal` and
    # app/scripts/seed_dev_data.py's `_to_decimal` use before assigning
    # into the Numeric(9,6) lat/lng columns -- go through `str()` first to
    # avoid binary-float rounding surprises. Duplicated locally rather than
    # imported (both of those are module-private helpers; seed_dev_data.py
    # itself sets the precedent of duplicating this 2-line helper instead
    # of exporting it just for a script/service to share).
    return Decimal(str(value)) if value is not None else None


async def _sync_geom(db: AsyncSession, location_id: int, lat: float, lng: float) -> None:
    await db.execute(
        update(RestaurantLocation)
        .where(RestaurantLocation.id == location_id)
        .values(geom=ST_SetSRID(ST_MakePoint(lng, lat), 4326))
    )


async def _find_or_create_brand(
    db: AsyncSession,
    *,
    owner_id: int,
    name: str,
    description: str | None,
    actor_id: str,
    actor_role: str,
) -> tuple[RestaurantBrand, bool]:
    slug = slugify(name)
    result = await db.execute(select(RestaurantBrand).where(RestaurantBrand.slug == slug))
    existing = result.scalar_one_or_none()
    if existing is not None:
        if existing.owner_id != owner_id:
            raise BulkImportError(
                f"A restaurant with slug {slug!r} already exists under a "
                f"different owner_id ({existing.owner_id}, not {owner_id}) "
                f"-- refusing to reassign it silently."
            )
        return existing, False

    brand = RestaurantBrand(
        owner_id=owner_id,
        name=name,
        slug=slug,
        description=description,
        is_claimed=True,
        claimed_at=datetime.now(timezone.utc),
    )
    db.add(brand)
    await db.flush()

    await audit_service.log(
        db,
        table_name="restaurant_brand",
        record_id=brand.id,
        action="create",
        actor_id=actor_id,
        actor_role=actor_role,
        old_val=None,
        new_val={"name": brand.name, "slug": brand.slug, "owner_id": brand.owner_id},
    )
    return brand, True


async def _find_or_create_location(
    db: AsyncSession,
    *,
    brand_id: int,
    row: RestaurantBasicDetailIn,
    actor_id: str,
    actor_role: str,
) -> tuple[RestaurantLocation, bool]:
    result = await db.execute(
        select(RestaurantLocation).where(
            RestaurantLocation.brand_id == brand_id,
            RestaurantLocation.address_line1 == row.address_line1,
        )
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        return existing, False

    location = RestaurantLocation(
        brand_id=brand_id,
        address_line1=row.address_line1,
        address_line2=row.address_line2,
        city=row.city,
        state=row.state,
        postal_code=row.postal_code,
        country=row.country,
        phone=row.phone,
        timezone=row.timezone,
        latitude=_to_decimal(row.latitude),
        longitude=_to_decimal(row.longitude),
        is_paid=False,
        paid_until=None,
        is_verified=row.is_verified,
        is_active=True,
    )
    db.add(location)
    await db.flush()

    if row.latitude is not None and row.longitude is not None:
        await _sync_geom(db, location.id, row.latitude, row.longitude)

    await audit_service.log(
        db,
        table_name="restaurant_location",
        record_id=location.id,
        action="create",
        actor_id=actor_id,
        actor_role=actor_role,
        old_val=None,
        new_val={
            "brand_id": brand_id,
            "address_line1": location.address_line1,
            "city": location.city,
        },
    )
    return location, True


async def _import_one_row(
    db: AsyncSession,
    *,
    index: int,
    row: RestaurantBasicDetailIn,
    owner_id: int,
    actor_id: str,
    actor_role: str,
) -> RowResult:
    async with db.begin_nested():
        brand, brand_created = await _find_or_create_brand(
            db,
            owner_id=owner_id,
            name=row.name,
            description=row.description,
            actor_id=actor_id,
            actor_role=actor_role,
        )
        location, location_created = await _find_or_create_location(
            db,
            brand_id=brand.id,
            row=row,
            actor_id=actor_id,
            actor_role=actor_role,
        )

    if brand_created or location_created:
        return RowResult(
            index=index,
            name=row.name,
            status=RowStatus.CREATED,
            brand_id=brand.id,
            location_id=location.id,
        )
    return RowResult(
        index=index,
        name=row.name,
        status=RowStatus.SKIPPED,
        brand_id=brand.id,
        location_id=location.id,
        detail="brand + location already existed",
    )


async def bulk_import_restaurants(
    db: AsyncSession,
    rows: list[RestaurantBasicDetailIn | dict],
    *,
    owner_id: int,
    actor_id: str,
    actor_role: str,
) -> BulkImportResult:
    """Create one `restaurant_brand` + one `restaurant_location` per row,
    all owned by `owner_id`. `rows` may be already-validated
    `RestaurantBasicDetailIn` instances (the HTTP path, where FastAPI/
    Pydantic validated the request body) or plain dicts (the management-
    command path, reading a raw JSON payload from a Lambda invoke event) --
    a dict that fails Pydantic validation becomes a per-row error, not a
    raised exception, so one malformed row never aborts the batch.

    Caller commits (or lets the caller's transaction management commit)
    after this returns -- this function itself commits once at the end on
    success, matching `seed_dev_data.run_seed`'s per-phase commit pattern,
    but scoped to a single commit per batch here since every row's writes
    are already individually isolated via SAVEPOINT.
    """
    if not rows:
        raise BulkImportError("No restaurant rows provided.")
    if len(rows) > _MAX_ROWS_PER_BATCH:
        raise BulkImportError(
            f"Batch of {len(rows)} rows exceeds the {_MAX_ROWS_PER_BATCH}-row cap per call."
        )

    result = BulkImportResult()

    for index, raw_row in enumerate(rows):
        if isinstance(raw_row, RestaurantBasicDetailIn):
            row = raw_row
        else:
            try:
                row = RestaurantBasicDetailIn.model_validate(raw_row)
            except ValidationError as exc:
                name = str(raw_row.get("name", "<unknown>")) if isinstance(raw_row, dict) else "<unknown>"
                result.add(
                    RowResult(index=index, name=name, status=RowStatus.ERROR, detail=str(exc))
                )
                continue

        try:
            row_result = await _import_one_row(
                db,
                index=index,
                row=row,
                owner_id=owner_id,
                actor_id=actor_id,
                actor_role=actor_role,
            )
        except (BulkImportError, IntegrityError) as exc:
            result.add(
                RowResult(index=index, name=row.name, status=RowStatus.ERROR, detail=str(exc))
            )
            continue
        except Exception as exc:  # noqa: BLE001 - one bad row must not abort the batch
            result.add(
                RowResult(index=index, name=row.name, status=RowStatus.ERROR, detail=str(exc))
            )
            continue

        result.add(row_result)

    await db.commit()
    return result
