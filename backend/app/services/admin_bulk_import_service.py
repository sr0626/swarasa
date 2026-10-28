"""Admin bulk listing import (`/admin/import/validate` + `/admin/import/commit`,
docs/API_CONTRACTS.md "Admin bulk listing import").

Stateless two-step design (no import-batch table, no migration):

  1. VALIDATE -- dry run over the WHOLE file (<= 500 rows, one request, three
     read queries). Applies the shared field rules
     (`app.core.bulk_import_rules`, also used by the helper script), matches
     `type` against the live taxonomy, and runs duplicate detection both
     against listings already in the system and against EARLIER rows of the
     same file (`bulk_import_keys.DuplicateIndex`, one rule for both). Nothing
     is written.
  2. COMMIT -- the browser sends the importable rows in small chunks
     (<= 50, sequentially). Every chunk is RE-VALIDATED server-side with the
     very same `evaluate_row` -- the client's verdict is never trusted -- so
     duplicates are re-checked against the database as it stands NOW, which
     already contains the rows created by earlier chunks. That is what makes
     chunking safe: an in-file duplicate whose first occurrence was committed
     in chunk 1 is skipped when it shows up in chunk 2, and re-uploading a
     whole file after a successful import creates nothing.

Written listings follow the data-seeding decision (docs/DECISIONS.md "Data
seeding: admin-curated import ..."): UNCLAIMED (`owner_id` NULL,
`is_claimed=false`), location `status='active'` + `is_verified=true` (the
admin reviewed the validation report before confirming), free tier. Audit rows
for each created brand/location carry actor = the admin and
`provenance: "bulk_import"`.

Geocoding is NOT done here: the Lambda has no route to the internet (no NAT
Gateway). The Next.js server action geocodes before calling commit; rows with
no coordinates are written without a map point and reported as
`needs_geocoding`.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.bulk_import_rules import RuleIssue, RowCheck, check_row_fields
from app.dependencies.auth import CurrentUser
from app.models.cuisine_tag import CuisineTag
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.schemas.admin_import import (
    CommittedRowOut,
    ImportCommitResponse,
    ImportCommitSummary,
    ImportIssueOut,
    ImportRowIn,
    ImportValidateResponse,
    ImportValidateSummary,
    ValidatedRowOut,
)
from app.schemas.restaurant_bulk_import import RestaurantBasicDetailIn
from app.services import bulk_import_keys as keys
from app.services.restaurant_bulk_import_service import (
    BulkImportError,
    _find_or_create_brand,
    _find_or_create_location,
    _link_cuisine_tag,
    load_active_cuisine_tags,
    match_cuisine_tag_text,
)
from app.services.restaurant_service import slugify

logger = logging.getLogger("app.services.admin_bulk_import_service")

PROVENANCE = "bulk_import"
GENERIC_ROW_FAILURE = "This row could not be imported. Try again; if it keeps failing, contact support."


@dataclass
class RowVerdict:
    row_number: int
    name: str
    status: str  # valid | warning | error | duplicate
    issues: list[RuleIssue] = field(default_factory=list)
    values: dict[str, object] = field(default_factory=dict)
    needs_geocoding: bool = False
    matched_tag: CuisineTag | None = None
    dup: keys.DupMatch | None = None
    name_key: str = ""
    addr_key: str = ""
    phone: str | None = None


@dataclass
class ImportContext:
    tags: list[CuisineTag]
    # slug -> (owner_id, deleted?)
    brands: dict[str, tuple[int | None, bool]]
    index: keys.DuplicateIndex


# ---------------------------------------------------------------------------
# Pure verdict logic
# ---------------------------------------------------------------------------


def _echo_name(raw: ImportRowIn) -> str:
    return (raw.name or "").strip()[:255] or "(no name)"


def evaluate_row(raw: ImportRowIn, check: RowCheck, ctx: ImportContext) -> RowVerdict:
    """Judge one row. Order: field errors -> definite duplicate -> brand
    conflicts -> possible duplicate / unknown type (warnings). A definite
    duplicate wins over a brand conflict so a re-upload of an already
    imported (and since claimed) listing reads as 'duplicate', not 'error'."""
    verdict = RowVerdict(
        row_number=raw.row_number,
        name=_echo_name(raw),
        status="valid",
        issues=list(check.issues),
        values=dict(check.values),
    )
    if check.has_errors:
        verdict.status = "error"
        return verdict

    values = check.values
    verdict.needs_geocoding = "latitude" not in values
    if verdict.needs_geocoding:
        verdict.issues.append(
            RuleIssue(
                "latitude",
                "info",
                "needs_geocoding",
                "No coordinates in the file. The listing is created without a map point "
                "and will not appear in distance search until it is geocoded.",
            )
        )

    name = str(values["name"])
    verdict.name_key = keys.name_key(name)
    verdict.addr_key = keys.address_key(str(values["address_line1"]), str(values["postal_code"]))
    verdict.phone = values.get("phone") if isinstance(values.get("phone"), str) else None
    if not verdict.name_key:
        verdict.status = "error"
        verdict.issues.append(
            RuleIssue("name", "error", "bad_name", "The name must contain at least one letter or digit.")
        )
        return verdict

    match = ctx.index.check(verdict.name_key, verdict.addr_key, verdict.phone)
    if match is not None and match.level == keys.DEFINITE:
        verdict.status = "duplicate"
        verdict.dup = match
        verdict.issues.append(
            RuleIssue(None, "error", "duplicate", f"Duplicate of {match.entry.label} ({match.reason}). Skipped.")
        )
        return verdict

    brand = ctx.brands.get(slugify(name))
    if brand is not None:
        owner_id, deleted = brand
        if deleted:
            verdict.status = "error"
            verdict.issues.append(
                RuleIssue(
                    "name",
                    "error",
                    "brand_deleted",
                    "A restaurant with this name was deleted. Restore it from Admin > Listings "
                    "instead of importing it again.",
                )
            )
            return verdict
        if owner_id is not None:
            verdict.status = "error"
            verdict.issues.append(
                RuleIssue(
                    "name",
                    "error",
                    "brand_owned",
                    "A restaurant with this name already has an owner. Add this location from "
                    "the restaurant's own page instead of importing it.",
                )
            )
            return verdict

    if match is not None:  # POSSIBLE
        verdict.dup = match
        verdict.status = "warning"
        verdict.issues.append(
            RuleIssue(
                None,
                "warning",
                "possible_duplicate",
                f"Possible duplicate of {match.entry.label} ({match.reason}). "
                "Imported only if you include warnings.",
            )
        )

    type_text = values.get("type")
    if isinstance(type_text, str):
        tag = match_cuisine_tag_text(ctx.tags, type_text)
        if tag is None:
            verdict.status = "warning"
            verdict.issues.append(
                RuleIssue(
                    "type",
                    "warning",
                    "unknown_type",
                    f"'{type_text}' is not a known cuisine or type tag. The listing would be "
                    "imported without a tag.",
                )
            )
        else:
            verdict.matched_tag = tag
    return verdict


def _register(verdict: RowVerdict, ctx: ImportContext) -> None:
    """Make a row visible to later rows of the same request as 'earlier row N'."""
    ctx.index.add(
        keys.DupEntry(
            name_key=verdict.name_key,
            addr_key=verdict.addr_key,
            phone=verdict.phone,
            label=f"row {verdict.row_number}",
            row_number=verdict.row_number,
        )
    )


# ---------------------------------------------------------------------------
# Context loading (read-only queries)
# ---------------------------------------------------------------------------


async def _load_context(db: AsyncSession, checks: list[RowCheck]) -> ImportContext:
    zips: set[str] = set()
    phones: set[str] = set()
    slugs: set[str] = set()
    for check in checks:
        if check.has_errors:
            continue
        zip_code = keys.zip5(str(check.values.get("postal_code", "")))
        if zip_code:
            zips.add(zip_code)
        phone = check.values.get("phone")
        if isinstance(phone, str):
            phones.add(phone)
        if check.values.get("name"):
            slugs.add(slugify(str(check.values["name"])))

    index = keys.DuplicateIndex()
    # Existing listings of EVERY status (active, hidden, coming_soon, closed)
    # and of soft-deleted brands -- a re-import must never copy a hidden or
    # deleted listing. Pre-filtered by ZIP5 / exact phone; keys compared in
    # Python so the normalization lives in one place.
    conditions = []
    if zips:
        conditions.append(func.substr(RestaurantLocation.postal_code, 1, 5).in_(zips))
    if phones:
        conditions.append(RestaurantLocation.phone.in_(phones))
    if conditions:
        rows = await db.execute(
            select(
                RestaurantLocation.id,
                RestaurantLocation.status,
                RestaurantLocation.address_line1,
                RestaurantLocation.postal_code,
                RestaurantLocation.phone,
                RestaurantBrand.name,
                RestaurantBrand.deleted_at,
            )
            .join(RestaurantBrand, RestaurantBrand.id == RestaurantLocation.brand_id)
            .where(or_(*conditions))
            .order_by(RestaurantLocation.id)
        )
        for loc_id, status, street, postal, phone, brand_name, deleted_at in rows.all():
            note = ""
            if deleted_at is not None:
                note = ", deleted"
            elif status != RestaurantLocation.STATUS_ACTIVE:
                note = f", {status.replace('_', ' ')}"
            index.add(
                keys.DupEntry(
                    name_key=keys.name_key(brand_name),
                    addr_key=keys.address_key(street, postal),
                    phone=phone,
                    label=f'existing listing "{brand_name}" (ID {loc_id}{note})',
                    listing_id=loc_id,
                )
            )

    brands: dict[str, tuple[int | None, bool]] = {}
    if slugs:
        brand_rows = await db.execute(
            select(RestaurantBrand.slug, RestaurantBrand.owner_id, RestaurantBrand.deleted_at).where(
                RestaurantBrand.slug.in_(slugs)
            )
        )
        brands = {slug: (owner_id, deleted_at is not None) for slug, owner_id, deleted_at in brand_rows.all()}

    return ImportContext(tags=await load_active_cuisine_tags(db), brands=brands, index=index)


def _to_issue_out(issue: RuleIssue) -> ImportIssueOut:
    return ImportIssueOut(field=issue.field, severity=issue.severity, code=issue.code, message=issue.message)


# ---------------------------------------------------------------------------
# Step 1: validate (no writes)
# ---------------------------------------------------------------------------


async def validate_rows(db: AsyncSession, rows: list[ImportRowIn]) -> ImportValidateResponse:
    checks = [check_row_fields(r.model_dump()) for r in rows]
    ctx = await _load_context(db, checks)

    out: list[ValidatedRowOut] = []
    for raw, check in zip(rows, checks):
        verdict = evaluate_row(raw, check, ctx)
        if verdict.status in ("valid", "warning"):
            # Candidate for import: later identical rows are duplicates of it.
            _register(verdict, ctx)
        out.append(
            ValidatedRowOut(
                row_number=verdict.row_number,
                name=verdict.name,
                status=verdict.status,  # type: ignore[arg-type]
                issues=[_to_issue_out(i) for i in verdict.issues],
                needs_geocoding=verdict.needs_geocoding,
                matched_tag=verdict.matched_tag.name if verdict.matched_tag else None,
                duplicate_of_row=verdict.dup.entry.row_number if verdict.dup else None,
                duplicate_of_listing_id=verdict.dup.entry.listing_id if verdict.dup else None,
            )
        )

    def count(status: str) -> int:
        return sum(1 for r in out if r.status == status)

    return ImportValidateResponse(
        rows=out,
        summary=ImportValidateSummary(
            total=len(out),
            valid=count("valid"),
            warning=count("warning"),
            error=count("error"),
            duplicate=count("duplicate"),
            needs_geocoding=sum(1 for r in out if r.needs_geocoding and r.status != "error"),
        ),
    )


# ---------------------------------------------------------------------------
# Step 2: commit one chunk
# ---------------------------------------------------------------------------


def _first_message(verdict: RowVerdict, severity: str) -> str:
    for issue in verdict.issues:
        if issue.severity == severity:
            return issue.message
    return GENERIC_ROW_FAILURE


async def commit_rows(
    db: AsyncSession,
    rows: list[ImportRowIn],
    *,
    include_warnings: bool,
    current_user: CurrentUser,
) -> ImportCommitResponse:
    checks = [check_row_fields(r.model_dump()) for r in rows]
    ctx = await _load_context(db, checks)

    out: list[CommittedRowOut] = []
    for raw, check in zip(rows, checks):
        verdict = evaluate_row(raw, check, ctx)

        def result(kind: str, reason: str | None = None, **extra: object) -> None:
            out.append(
                CommittedRowOut(
                    row_number=verdict.row_number,
                    name=verdict.name,
                    result=kind,  # type: ignore[arg-type]
                    reason=reason,
                    needs_geocoding=verdict.needs_geocoding and kind == "created",
                    **extra,  # type: ignore[arg-type]
                )
            )

        if verdict.status == "error":
            result("failed", _first_message(verdict, "error"))
            continue
        if verdict.status == "duplicate":
            result("skipped_duplicate", _first_message(verdict, "error"))
            continue
        if verdict.status == "warning" and not include_warnings:
            result("skipped_warning", _first_message(verdict, "warning"))
            continue

        try:
            brand_id, location_id, created = await _create_listing(db, verdict, current_user)
        except BulkImportError as exc:
            result("failed", str(exc))
            continue
        except Exception as exc:  # noqa: BLE001 - one bad row must not abort the chunk
            logger.warning("admin import: row %s failed: %s", verdict.row_number, type(exc).__name__)
            result("failed", GENERIC_ROW_FAILURE)
            continue

        if not created:
            result("skipped_duplicate", "This restaurant and street address already exist. Skipped.")
            continue
        _register(verdict, ctx)
        result("created", brand_id=brand_id, location_id=location_id)

    await db.commit()
    return ImportCommitResponse(
        rows=out,
        summary=ImportCommitSummary(
            created=sum(1 for r in out if r.result == "created"),
            skipped_duplicate=sum(1 for r in out if r.result == "skipped_duplicate"),
            skipped_warning=sum(1 for r in out if r.result == "skipped_warning"),
            failed=sum(1 for r in out if r.result == "failed"),
            needs_geocoding=sum(1 for r in out if r.needs_geocoding),
        ),
    )


async def _create_listing(
    db: AsyncSession, verdict: RowVerdict, current_user: CurrentUser
) -> tuple[int, int, bool]:
    """One row in its own SAVEPOINT (a failure rolls back only that row).
    Returns (brand_id, location_id, created)."""
    v = verdict.values
    detail = RestaurantBasicDetailIn(
        name=str(v["name"]),
        description=v.get("description"),  # type: ignore[arg-type]
        website=v.get("website"),  # type: ignore[arg-type]
        address_line1=str(v["address_line1"]),
        address_line2=v.get("address_line2"),  # type: ignore[arg-type]
        city=str(v["city"]),
        state=str(v["state"]),
        postal_code=str(v["postal_code"]),
        country="US",
        phone=v.get("phone"),  # type: ignore[arg-type]
        latitude=v.get("latitude"),  # type: ignore[arg-type]
        longitude=v.get("longitude"),  # type: ignore[arg-type]
        is_verified=True,
    )
    async with db.begin_nested():
        brand, brand_created = await _find_or_create_brand(
            db,
            owner_id=None,  # unclaimed, admin-curated
            name=detail.name,
            description=detail.description,
            website=detail.website,
            actor_id=current_user.cognito_sub,
            actor_role="admin",
            provenance=PROVENANCE,
        )
        location, location_created = await _find_or_create_location(
            db,
            brand_id=brand.id,
            row=detail,
            actor_id=current_user.cognito_sub,
            actor_role="admin",
            provenance=PROVENANCE,
        )
        if location_created and verdict.matched_tag is not None:
            await _link_cuisine_tag(db, location_id=location.id, cuisine_tag_id=verdict.matched_tag.id)
    return brand.id, location.id, location_created
