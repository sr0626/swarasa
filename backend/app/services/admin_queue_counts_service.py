"""`GET /admin/queue-counts` -- one cheap aggregate over the four admin work
queues (claims, messages, problem reports, reopen requests), so the admin
menu can show an "N need action" badge without opening each page.

Runs on every admin page render, so it is deliberately light:
- ONE statement: four `COUNT(*)` scalar subqueries plus a fifth for the
  definitely-overdue claims. Each filters on `status`, served by the existing
  `(status, <time>)` indexes (`ix_claim_request_status_submitted`,
  `ix_admin_message_status_created`, `ix_listing_report_status_submitted`,
  `ix_location_reopen_request_status_submitted`).
- "Needs action" = waiting on an admin decision: claims `pending_review`,
  messages `open`, reports `new`, reopen requests `pending_review`. Resolved,
  approved, rejected and triaged rows never count.

Overdue claims: `sla_due_at` is not a column; it is `submitted_at` + 2
BUSINESS days (`claim_service._add_business_days`), so it can't be a plain SQL
comparison. Two business days span at most 4 calendar days and at least 2, so:
pending claims submitted more than 4 days ago are overdue for certain (counted
in SQL), those under 2 days old are not, and only the thin band in between
(a handful of rows at most -- the queue is worked within the SLA) is read and
checked in Python against the same `_add_business_days` the claims queue uses,
so this number always agrees with the `sla_due_at` the claims page shows.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.admin_message import AdminMessage
from app.models.claim_request import ClaimRequest
from app.models.listing_report import ListingReport
from app.models.location_reopen_request import LocationReopenRequest
from app.schemas.admin_queue_counts import (
    AdminQueueCountsResponse,
    ClaimsQueueCounts,
    MessagesQueueCounts,
    ReopenQueueCounts,
    ReportsQueueCounts,
)
from app.services.claim_service import _SLA_BUSINESS_DAYS, _add_business_days

# 2 business days are at least 2 and at most 4 calendar days (Thu/Fri start).
_SLA_MIN_DAYS = _SLA_BUSINESS_DAYS
_SLA_MAX_DAYS = _SLA_BUSINESS_DAYS + 2


async def get_admin_queue_counts(
    db: AsyncSession, now: datetime | None = None
) -> AdminQueueCountsResponse:
    now = now or datetime.now(timezone.utc)
    certainly_overdue_before = now - timedelta(days=_SLA_MAX_DAYS)
    maybe_overdue_before = now - timedelta(days=_SLA_MIN_DAYS)

    pending_claims = (
        select(func.count())
        .select_from(ClaimRequest)
        .where(ClaimRequest.status == "pending_review")
        .scalar_subquery()
    )
    definitely_overdue = (
        select(func.count())
        .select_from(ClaimRequest)
        .where(
            ClaimRequest.status == "pending_review",
            ClaimRequest.submitted_at < certainly_overdue_before,
        )
        .scalar_subquery()
    )
    open_messages = (
        select(func.count())
        .select_from(AdminMessage)
        .where(AdminMessage.status == "open")
        .scalar_subquery()
    )
    new_reports = (
        select(func.count())
        .select_from(ListingReport)
        .where(ListingReport.status == "new")
        .scalar_subquery()
    )
    pending_reopen = (
        select(func.count())
        .select_from(LocationReopenRequest)
        .where(LocationReopenRequest.status == "pending_review")
        .scalar_subquery()
    )

    row = (
        await db.execute(
            select(pending_claims, definitely_overdue, open_messages, new_reports, pending_reopen)
        )
    ).one()
    claims_pending, overdue, messages_open, reports_new, reopen_pending = (int(v) for v in row)

    # The thin band where the business-day SLA decides (see module docstring).
    band = (
        await db.execute(
            select(ClaimRequest.submitted_at).where(
                ClaimRequest.status == "pending_review",
                ClaimRequest.submitted_at >= certainly_overdue_before,
                ClaimRequest.submitted_at < maybe_overdue_before,
            )
        )
    ).scalars()
    for submitted_at in band:
        if submitted_at.tzinfo is None:  # SQLite hands back naive UTC
            submitted_at = submitted_at.replace(tzinfo=timezone.utc)
        if _add_business_days(submitted_at, _SLA_BUSINESS_DAYS) < now:
            overdue += 1

    return AdminQueueCountsResponse(
        claims=ClaimsQueueCounts(pending=claims_pending, overdue=overdue),
        messages=MessagesQueueCounts(open=messages_open),
        reports=ReportsQueueCounts(new=reports_new),
        reopen_requests=ReopenQueueCounts(pending=reopen_pending),
        total=claims_pending + messages_open + reports_new + reopen_pending,
    )
