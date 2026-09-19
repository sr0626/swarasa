"""Admin notifications bell — one read-only aggregate over three queues.

Computed on demand (no push, no cache): each section is one COUNT + one small
LIMITed SELECT, served by existing indexes
(`ix_claim_request_status_submitted`, `ix_listing_report_status_submitted`;
`owner_account` is a small table). Reads `claim_request` directly rather than
going through `claim_service`, so the bell never couples to the claims-queue
endpoint's shape.

"Needs attention" definitions:
- claims: `claim_request.status = 'pending_review'`, oldest first (SLA
  order — the same order the claims queue works in).
- reports: `listing_report.status = 'new'`, oldest first (same as the
  `GET /reports?status=new` triage queue).
- new_users: `owner_account` rows created in the last 7 days, newest first.

KNOWN LIMITATION (new_users): the local database has NO table of all
signed-up users. Identity lives in Cognito; the only local per-user row is
`owner_account`, created lazily on an owner's first `GET /auth/me` or claim
submission. So `new_users` covers owner-role accounts that have hit the API
at least once — NOT diner (`registered_user`) sign-ups, NOT managers/admins,
and a brand-new owner who confirmed their email but hasn't loaded the app yet
is not counted. Closing the gap needs either an Infra grant
(`cognito-idp:ListUsers` on the pool) or a post-confirmation hook that writes
a local row — deliberately not done here (no new IAM in this change).
Rows redacted for CCPA (`personal_data_deleted_at` set) are excluded.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.claim_request import ClaimRequest
from app.models.listing_report import ListingReport
from app.models.owner_account import OwnerAccount
from app.models.restaurant_brand import RestaurantBrand
from app.schemas.admin_notifications import (
    AdminNotificationsResponse,
    ClaimNotificationItem,
    ClaimNotifications,
    NewUserNotificationItem,
    NewUserNotifications,
    ReportNotificationItem,
    ReportNotifications,
)

ITEMS_PER_TYPE = 5
NEW_USERS_WINDOW_DAYS = 7


async def _claims(db: AsyncSession) -> ClaimNotifications:
    pending = ClaimRequest.status == "pending_review"
    count = (
        await db.execute(select(func.count()).select_from(ClaimRequest).where(pending))
    ).scalar_one()
    rows = (
        await db.execute(
            select(
                ClaimRequest.id,
                ClaimRequest.brand_id,
                RestaurantBrand.name,
                ClaimRequest.submitted_at,
            )
            .join(RestaurantBrand, RestaurantBrand.id == ClaimRequest.brand_id)
            .where(pending)
            .order_by(ClaimRequest.submitted_at.asc(), ClaimRequest.id.asc())
            .limit(ITEMS_PER_TYPE)
        )
    ).all()
    return ClaimNotifications(
        count=count,
        items=[
            ClaimNotificationItem(
                claim_id=r.id,
                brand_id=r.brand_id,
                brand_name=r.name,
                submitted_at=r.submitted_at,
            )
            for r in rows
        ],
    )


async def _reports(db: AsyncSession) -> ReportNotifications:
    new = ListingReport.status == "new"
    count = (
        await db.execute(select(func.count()).select_from(ListingReport).where(new))
    ).scalar_one()
    rows = (
        await db.execute(
            select(
                ListingReport.id,
                ListingReport.brand_id,
                RestaurantBrand.name,
                ListingReport.category,
                ListingReport.submitted_at,
            )
            .join(RestaurantBrand, RestaurantBrand.id == ListingReport.brand_id)
            .where(new)
            .order_by(ListingReport.submitted_at.asc(), ListingReport.id.asc())
            .limit(ITEMS_PER_TYPE)
        )
    ).all()
    return ReportNotifications(
        count=count,
        items=[
            ReportNotificationItem(
                report_id=r.id,
                brand_id=r.brand_id,
                brand_name=r.name,
                category=r.category,
                submitted_at=r.submitted_at,
            )
            for r in rows
        ],
    )


async def _new_users(db: AsyncSession) -> NewUserNotifications:
    since = datetime.now(timezone.utc) - timedelta(days=NEW_USERS_WINDOW_DAYS)
    recent = (OwnerAccount.created_at >= since) & OwnerAccount.personal_data_deleted_at.is_(
        None
    )
    count = (
        await db.execute(select(func.count()).select_from(OwnerAccount).where(recent))
    ).scalar_one()
    rows = (
        (
            await db.execute(
                select(OwnerAccount)
                .where(recent)
                .order_by(OwnerAccount.created_at.desc(), OwnerAccount.id.desc())
                .limit(ITEMS_PER_TYPE)
            )
        )
        .scalars()
        .all()
    )
    return NewUserNotifications(
        count=count,
        items=[
            NewUserNotificationItem(
                owner_id=o.id,
                display=o.full_name or o.email,
                email=o.email,
                role="owner",
                created_at=o.created_at,
            )
            for o in rows
        ],
    )


async def get_admin_notifications(db: AsyncSession) -> AdminNotificationsResponse:
    claims = await _claims(db)
    reports = await _reports(db)
    new_users = await _new_users(db)
    return AdminNotificationsResponse(
        claims=claims,
        reports=reports,
        new_users=new_users,
        # Badge total: actionable queues only. New sign-ups are informational
        # and never "cleared", so including them would keep the badge lit for
        # a week regardless of what the admin does.
        total=claims.count + reports.count,
        new_users_window_days=NEW_USERS_WINDOW_DAYS,
    )
