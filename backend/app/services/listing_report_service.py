"""Listing report business logic — see docs/API_CONTRACTS.md "Listing
reports (`/reports`)".

Anti-abuse posture (the endpoint is public + anonymous by design):
- a honeypot field (`website`) — a non-empty value returns the normal
  success receipt but stores nothing (`create_report` returns `None`);
- strict length limits at the schema layer (details <= 2000 chars, email
  <= 254);
- a report can only reference a real brand (and a location of that brand).

NOT built here (flagged for the human in the PR): per-IP rate limiting and
CAPTCHA. Today the only throttle is API Gateway's account/stage-level
throttling. Reports never change listing data (an admin acts on them
separately), so the blast radius of spam is admin-queue noise, not
corrupted listings.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import AppError
from app.dependencies.pagination import Pagination
from app.models.listing_report import ListingReport
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.schemas.listing_report import (
    ReportCreate,
    ReportListResponse,
    ReportOut,
    ReportUpdate,
)

_LOAD_OPTIONS = (
    selectinload(ListingReport.brand),
    selectinload(ListingReport.location),
)


def to_report_out(report: ListingReport) -> ReportOut:
    location = report.location
    return ReportOut(
        report_id=report.id,
        brand_id=report.brand_id,
        brand_name=report.brand.name,
        brand_slug=report.brand.slug,
        location_id=report.location_id,
        location_slug=location.slug if location is not None else None,
        location_address=(
            f"{location.address_line1}, {location.city}, {location.state} {location.postal_code}"
            if location is not None
            else None
        ),
        category=report.category,
        details=report.details,
        reporter_email=report.reporter_email,
        reporter_user_id=report.reporter_user_id,
        status=report.status,
        submitted_at=report.submitted_at,
        reviewed_by=report.reviewed_by,
        reviewed_at=report.reviewed_at,
        reviewer_notes=report.reviewer_notes,
    )


async def create_report(
    db: AsyncSession, current_user, body: ReportCreate
) -> ListingReport | None:
    """Store a public report. `current_user` is `None` for an anonymous
    caller. Returns `None` (nothing stored) when the honeypot tripped —
    the router still answers 201 so a bot can't tell it was discarded.
    """
    if body.website:
        return None

    brand = await db.get(RestaurantBrand, body.brand_id)
    if brand is None or brand.deleted_at is not None:
        raise AppError(404, "Restaurant not found", "not_found")

    if body.location_id is not None:
        location = await db.get(RestaurantLocation, body.location_id)
        if location is None or location.brand_id != brand.id:
            raise AppError(
                400, "location_id does not belong to this restaurant", "invalid_location"
            )

    # Signed-in caller: the email comes from the verified token claims,
    # never from the request body (a client could otherwise attribute a
    # report to someone else's address). A token without an email claim
    # yields None rather than falling back to the client-supplied value.
    # Anonymous caller: the optional client-supplied email, as before.
    if current_user is not None:
        reporter_email = current_user.email or None
    else:
        reporter_email = body.reporter_email

    report = ListingReport(
        brand_id=brand.id,
        location_id=body.location_id,
        category=body.category,
        details=body.details,
        reporter_email=reporter_email,
        reporter_user_id=current_user.cognito_sub if current_user is not None else None,
        status="new",
    )
    db.add(report)
    await db.commit()
    return report


async def list_reports(
    db: AsyncSession, pagination: Pagination, status: str | None
) -> ReportListResponse:
    base = select(ListingReport)
    count_stmt = select(func.count()).select_from(ListingReport)
    if status is not None:
        base = base.where(ListingReport.status == status)
        count_stmt = count_stmt.where(ListingReport.status == status)

    # Triage queue reads oldest-first; every other view (resolved,
    # dismissed, or "all") reads newest-first.
    if status == "new":
        order = (ListingReport.submitted_at.asc(), ListingReport.id.asc())
    else:
        order = (ListingReport.submitted_at.desc(), ListingReport.id.desc())

    total = (await db.execute(count_stmt)).scalar_one()
    rows = (
        (
            await db.execute(
                base.options(*_LOAD_OPTIONS)
                .order_by(*order)
                .offset(pagination.offset)
                .limit(pagination.page_size)
            )
        )
        .scalars()
        .all()
    )
    return ReportListResponse(
        results=[to_report_out(r) for r in rows],
        page=pagination.page,
        page_size=pagination.page_size,
        total=total,
    )


async def update_report(
    db: AsyncSession, report_id: int, admin_sub: str, body: ReportUpdate
) -> ListingReport:
    report = (
        await db.execute(
            select(ListingReport)
            .options(*_LOAD_OPTIONS)
            .where(ListingReport.id == report_id)
        )
    ).scalar_one_or_none()
    if report is None:
        raise AppError(404, "Report not found", "not_found")

    report.status = body.status
    if "reviewer_notes" in body.model_fields_set:
        report.reviewer_notes = body.reviewer_notes
    if body.status == "new":
        # Re-opened: clear the "who/when resolved it" stamp.
        report.reviewed_by = None
        report.reviewed_at = None
    else:
        report.reviewed_by = admin_sub
        report.reviewed_at = datetime.now(timezone.utc)

    await db.commit()
    return report
