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
`location_cuisine` (the cuisine-tag link the CSV path below can also
write, per LOCATION -- tags are per location, docs/DECISIONS.md
"Cuisine/dietary tags are per location") is NOT in that required list --
the row's `restaurant_location` create audit already covers the location, and
this stays consistent with the existing pattern rather than inventing one.

-------------------------------------------------------------------------
CSV import path (`parse_csv_rows` + `bulk_import_restaurants_csv`)
-------------------------------------------------------------------------
Added for the CSV bulk-import feature (docs/PROJECT_PLAN.csv "CSV bulk
restaurant import", docs/DECISIONS.md same title) -- extends this same
service rather than forking a second one, since brand/location
create-or-skip logic (`_find_or_create_brand`/`_find_or_create_location`)
is identical; only three things differ from the JSON path above:

  1. Owner is resolved PER ROW by `owner_email`, not once for the whole
     batch -- an unresolvable email is a per-row error, never a reason to
     create an owner_account (same "no typo'd email" policy the JSON
     path's management-command caller already documents in
     `app/scripts/management.py`).
  2. Cuisine is free text (`type` column, e.g. "south indian"), matched
     case-insensitively against `cuisine_tag.name`/`display_name`. No
     match is a per-row *report*, not a per-row error -- the row still
     imports, just without a cuisine tag, and the caller sees which rows
     need a manual follow-up.
  3. No geocoding happens here. The CSV columns this parser reads already
     include `latitude`/`longitude` when known -- populated upstream by
     `scripts/bulk_import_restaurants_csv.py` calling Nominatim BEFORE
     this Lambda is ever invoked. This is a deliberate deviation from
     "geocode inside the Lambda": `infra/modules/networking/main.tf`
     puts this Lambda in private subnets with **no NAT Gateway**
     (root CLAUDE.md "NEVER create a NAT Gateway"), so it has no route to
     the public internet at all and could not reach
     nominatim.openstreetmap.org even if this function tried -- confirmed
     against that module's own comment ("Private subnets -- Lambda +
     Aurora live here; no NAT Gateway"), not assumed. The one thing this
     Lambda CAN reach is Aurora, over its in-VPC route -- exactly why the
     Irving, TX seed data (`app/scripts/irving_restaurants_seed.json`)
     was geocoded before being committed, not at Lambda runtime, per that
     file's own `_comment` field. This CSV path follows the same real
     precedent, not the runtime-geocoding shape a task description might
     otherwise suggest. See `scripts/bulk_import_restaurants_csv.py` for
     where the actual Nominatim call happens (human's machine, real
     internet access, 1 req/sec + descriptive User-Agent).
"""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from enum import Enum

from geoalchemy2.functions import ST_MakePoint, ST_SetSRID
from pydantic import ValidationError
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.phone import US_PHONE_ERROR, normalize_us_phone
from app.models.cuisine_tag import CuisineTag
from app.models.owner_account import OwnerAccount
from app.models.restaurant_brand import RestaurantBrand
from app.models.location_cuisine import LocationCuisine
from app.models.restaurant_location import RestaurantLocation
from app.schemas.restaurant_bulk_import import RestaurantBasicDetailIn, RestaurantCsvRowIn
from app.services import audit_service, location_slug
from app.services.restaurant_service import slugify

_MAX_ROWS_PER_BATCH = 500  # sanity cap -- generous for a manual admin batch

# Required CSV column headers -- see scripts/bulk_import_restaurants_csv.py
# and docs/API_CONTRACTS.md "CSV bulk restaurant import" for the full,
# human-facing column list (this is the subset with no default that a
# missing header makes unusable for every row, so it's checked once,
# batch-level, rather than surfacing as N identical per-row errors).
_REQUIRED_CSV_COLUMNS = {"name", "address_line1", "city", "state", "postal_code", "owner_email"}


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
    # CSV path only (`bulk_import_restaurants_csv`) -- left None on every
    # JSON-path row. `cuisine_type_input` is the raw free-text `type`
    # column value (None if the row didn't supply one at all -- distinct
    # from "supplied but unmatched", which is `cuisine_type_input` set and
    # `cuisine_match` None).
    cuisine_type_input: str | None = None
    cuisine_match: str | None = None  # matched cuisine_tag.name, or None


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
    website: str | None = None,
) -> tuple[RestaurantBrand, bool]:
    slug = slugify(name)
    result = await db.execute(select(RestaurantBrand).where(RestaurantBrand.slug == slug))
    existing = result.scalar_one_or_none()
    if existing is not None:
        if existing.deleted_at is not None:
            # Soft-deleted listing keeps its slug reserved — never silently
            # attach new locations to (or resurrect) a deleted brand.
            raise BulkImportError(
                f"A restaurant with slug {slug!r} was deleted by an admin -- "
                f"restore it (POST /restaurants/{{id}}/restore) or import "
                f"under a different name."
            )
        if existing.owner_id != owner_id:
            raise BulkImportError(
                f"A restaurant with slug {slug!r} already exists under a "
                f"different owner_id ({existing.owner_id}, not {owner_id}) "
                f"-- refusing to reassign it silently."
            )
        # Skip means untouched, same as every other field here -- a
        # re-run with a since-added website doesn't retroactively patch
        # an existing brand (consistent with `description` never being
        # patched on skip either). Use PATCH /restaurants/{id} to edit.
        return existing, False

    brand = RestaurantBrand(
        owner_id=owner_id,
        name=name,
        slug=slug,
        description=description,
        website=website,
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
        new_val={
            "name": brand.name,
            "slug": brand.slug,
            "owner_id": brand.owner_id,
            "website": brand.website,
        },
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
        slug=await location_slug.assign_location_slug(
            db, brand_id, row.city, row.address_line1
        ),
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
            website=row.website,
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


def _apply_us_phone_rule(row):
    """Shared US phone rule (app/core/phone.py) for one import row. Returns
    `(row, None)` with `phone` normalised to `+1XXXXXXXXXX` (or left `None`
    when the row has no phone -- phone stays optional for imports), or
    `(row, error_detail)` for a number that isn't a valid 10-digit US phone;
    the caller reports that per-row instead of raising, so one bad number
    never aborts the batch."""
    if row.phone is None or not row.phone.strip():
        return row.model_copy(update={"phone": None}), None
    normalized = normalize_us_phone(row.phone)
    if normalized is None:
        return row, f"Invalid phone {row.phone!r}: {US_PHONE_ERROR}."
    return row.model_copy(update={"phone": normalized}), None


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

        row, phone_error = _apply_us_phone_rule(row)
        if phone_error:
            result.add(
                RowResult(index=index, name=row.name, status=RowStatus.ERROR, detail=phone_error)
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


# ---------------------------------------------------------------------------
# CSV import path -- see this module's docstring "CSV import path" section
# for why this differs from the JSON path above (per-row owner, free-text
# cuisine matching, no in-Lambda geocoding).
# ---------------------------------------------------------------------------


def parse_csv_rows(csv_content: str) -> list[dict]:
    """Parse raw CSV text (stdlib `csv` module only) into a list of plain
    dicts, one per data row, ready for `RestaurantCsvRowIn.model_validate`.
    Header row is required; column order doesn't matter (`csv.DictReader`
    matches by name). Column names are matched exactly as
    `scripts/bulk_import_restaurants_csv.py` writes them -- see
    docs/API_CONTRACTS.md "CSV bulk restaurant import" for the full header
    list.

    Deliberately permissive about a blank/whitespace-only cell: normalized
    to `None` here so an empty `address_line2`/`phone`/`website`/`type`
    cell validates as "not provided" rather than an empty string, and so
    `latitude`/`longitude` cells left blank (not yet geocoded, or
    geocoding failed for that row) come through as `None` -- same as the
    JSON path's `latitude`/`longitude` being omitted entirely.

    The CSV's `type` column (human-facing name, see
    scripts/bulk_import_restaurants_csv.py and docs/API_CONTRACTS.md) is
    renamed to `cuisine_type` here -- `RestaurantCsvRowIn` has no `type`
    field, only `cuisine_type`, and pydantic v2 silently drops unknown
    extra keys on `model_validate` rather than erroring, so without this
    rename every CSV-imported row's cuisine was silently discarded (no
    exception, no warning -- see the regression test in
    tests/unit/test_bulk_import_csv_parsing.py for the exact failure
    this closes). Keep the CSV header itself as `type` -- that's the
    documented, human-facing column name; `cuisine_type` is only the
    internal Pydantic field name this function normalizes into.

    Raises `BulkImportError` for a batch-level structural problem (no
    header row, entirely missing required columns, or zero data rows) --
    NOT for a single bad row's values, which `RestaurantCsvRowIn`
    validation catches per-row instead, same as the JSON path.
    """
    reader = csv.DictReader(io.StringIO(csv_content))
    if reader.fieldnames is None:
        raise BulkImportError("CSV content has no header row.")

    headers = {h.strip() for h in reader.fieldnames if h}
    missing = _REQUIRED_CSV_COLUMNS - headers
    if missing:
        raise BulkImportError(
            f"CSV is missing required column(s): {', '.join(sorted(missing))}. "
            f"See docs/API_CONTRACTS.md 'CSV bulk restaurant import' for the "
            f"full column list."
        )

    rows: list[dict] = []
    for raw in reader:
        cleaned: dict = {}
        had_any_value = False
        for key, value in raw.items():
            if key is None:
                continue  # extra unnamed column(s) -- ignored, not an error
            key = key.strip()
            value = value.strip() if isinstance(value, str) else value
            if not value:
                # Omit the key entirely rather than setting it to `None`.
                # `RestaurantCsvRowIn.country` (and any other field with a
                # non-`None` default, e.g. `timezone`) is typed plain
                # `str`, not `str | None` -- pydantic v2 applies a field's
                # default only when the key is ABSENT, and rejects an
                # explicit `None` against a non-Optional type. Found via
                # manual round-trip testing of this exact function's
                # output through `RestaurantCsvRowIn.model_validate`
                # before this fix (a blank `country` cell crashed the
                # row with "Input should be a valid string", not the
                # expected "US" default).
                continue
            had_any_value = True
            if key == "type":
                # CSV-facing column name is `type`; the schema field is
                # `cuisine_type` -- see this function's docstring.
                key = "cuisine_type"
            cleaned[key] = value

        if "latitude" in cleaned:
            cleaned["latitude"] = float(cleaned["latitude"])
        if "longitude" in cleaned:
            cleaned["longitude"] = float(cleaned["longitude"])

        # A fully blank line (csv.DictReader still yields one row of all
        # blanks for it) isn't a real data row -- skip rather than
        # reporting it as an error with name "<unknown>".
        if had_any_value:
            rows.append(cleaned)

    if not rows:
        raise BulkImportError("CSV has a header row but no data rows.")
    return rows


async def _resolve_owner_by_email(db: AsyncSession, email: str) -> OwnerAccount | None:
    result = await db.execute(select(OwnerAccount).where(OwnerAccount.email == email))
    return result.scalar_one_or_none()


async def _match_cuisine_tag(db: AsyncSession, type_text: str) -> CuisineTag | None:
    """Case-insensitive match of free-text `type_text` (e.g. "south
    indian") against `cuisine_tag.name` (a slug, e.g. "south_indian" --
    spaces/hyphens normalized to underscores before comparing) OR
    `cuisine_tag.display_name` (e.g. "South Indian", compared as-is,
    case-insensitively). Only `is_active` tags match, same scope
    `cuisine_service.list_active_cuisine_tags` uses. Returns `None` (not
    an error) when nothing matches -- caller reports this per-row, per
    the task's explicit "don't fail the row" requirement.
    """
    normalized = type_text.strip().lower()
    if not normalized:
        return None
    slug_form = normalized.replace(" ", "_").replace("-", "_")

    result = await db.execute(
        select(CuisineTag).where(
            CuisineTag.is_active == True,  # noqa: E712
            (func.lower(CuisineTag.name) == slug_form)
            | (func.lower(CuisineTag.display_name) == normalized),
        )
    )
    return result.scalars().first()


async def _link_cuisine_tag(db: AsyncSession, *, location_id: int, cuisine_tag_id: int) -> None:
    """Idempotent insert into `location_cuisine` -- mirrors the composite
    primary key on (`location_id`, `cuisine_tag_id`) with a check-before-insert
    rather than relying on catching an `IntegrityError`, consistent with
    every other natural-key check in this module. The tag applies to the
    row's LOCATION only, never to the brand's other locations.
    """
    existing = await db.execute(
        select(LocationCuisine.location_id).where(
            LocationCuisine.location_id == location_id,
            LocationCuisine.cuisine_tag_id == cuisine_tag_id,
        )
    )
    if existing.scalar_one_or_none() is not None:
        return
    db.add(LocationCuisine(location_id=location_id, cuisine_tag_id=cuisine_tag_id))
    await db.flush()


async def _import_one_csv_row(
    db: AsyncSession,
    *,
    index: int,
    row: RestaurantCsvRowIn,
    actor_id: str,
    actor_role: str,
) -> RowResult:
    owner = await _resolve_owner_by_email(db, row.owner_email)
    if owner is None:
        return RowResult(
            index=index,
            name=row.name,
            status=RowStatus.ERROR,
            detail=(
                f"No existing owner_account for owner_email {row.owner_email!r} -- "
                f"this command resolves an existing owner, it does not create one "
                f"(same policy as the JSON bulk-import path)."
            ),
            cuisine_type_input=row.cuisine_type,
        )

    cuisine_match: str | None = None
    async with db.begin_nested():
        brand, brand_created = await _find_or_create_brand(
            db,
            owner_id=owner.id,
            name=row.name,
            description=row.description,
            website=row.website,
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

        if row.cuisine_type:
            tag = await _match_cuisine_tag(db, row.cuisine_type)
            if tag is not None:
                cuisine_match = tag.name
                await _link_cuisine_tag(db, location_id=location.id, cuisine_tag_id=tag.id)

    if brand_created or location_created:
        return RowResult(
            index=index,
            name=row.name,
            status=RowStatus.CREATED,
            brand_id=brand.id,
            location_id=location.id,
            cuisine_type_input=row.cuisine_type,
            cuisine_match=cuisine_match,
        )
    return RowResult(
        index=index,
        name=row.name,
        status=RowStatus.SKIPPED,
        brand_id=brand.id,
        location_id=location.id,
        detail="brand + location already existed",
        cuisine_type_input=row.cuisine_type,
        cuisine_match=cuisine_match,
    )


async def bulk_import_restaurants_csv(
    db: AsyncSession,
    rows: list[RestaurantCsvRowIn | dict],
    *,
    actor_id: str,
    actor_role: str,
) -> BulkImportResult:
    """CSV counterpart to `bulk_import_restaurants` above -- same
    per-row-SAVEPOINT partial-failure behavior and single end-of-batch
    commit, but resolves `owner_id` per row (from `owner_email`) instead
    of taking one for the whole batch, and additionally matches/links a
    free-text cuisine `type` per row. See this module's docstring "CSV
    import path" section for the full rationale.
    """
    if not rows:
        raise BulkImportError("No CSV data rows provided.")
    if len(rows) > _MAX_ROWS_PER_BATCH:
        raise BulkImportError(
            f"Batch of {len(rows)} rows exceeds the {_MAX_ROWS_PER_BATCH}-row cap per call."
        )

    result = BulkImportResult()

    for index, raw_row in enumerate(rows):
        if isinstance(raw_row, RestaurantCsvRowIn):
            row = raw_row
        else:
            try:
                row = RestaurantCsvRowIn.model_validate(raw_row)
            except ValidationError as exc:
                name = str(raw_row.get("name", "<unknown>")) if isinstance(raw_row, dict) else "<unknown>"
                result.add(
                    RowResult(index=index, name=name, status=RowStatus.ERROR, detail=str(exc))
                )
                continue

        row, phone_error = _apply_us_phone_rule(row)
        if phone_error:
            result.add(
                RowResult(
                    index=index,
                    name=row.name,
                    status=RowStatus.ERROR,
                    detail=phone_error,
                    cuisine_type_input=row.cuisine_type,
                )
            )
            continue

        try:
            row_result = await _import_one_csv_row(
                db, index=index, row=row, actor_id=actor_id, actor_role=actor_role
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
