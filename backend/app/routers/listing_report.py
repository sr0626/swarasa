"""Listing report endpoints. See docs/API_CONTRACTS.md "Listing reports
(/reports)"."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.auth import CurrentUser, get_current_user_optional, require_admin
from app.dependencies.db import get_db
from app.dependencies.pagination import Pagination, pagination_params
from app.schemas.listing_report import (
    ReportCreate,
    ReportListResponse,
    ReportOut,
    ReportReceiptOut,
    ReportStatus,
    ReportUpdate,
)
from app.services import listing_report_service

router = APIRouter(prefix="/reports", tags=["reports"])


@router.post("", response_model=ReportReceiptOut, status_code=status.HTTP_201_CREATED)
async def submit_report(
    body: ReportCreate,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser | None = Depends(get_current_user_optional),
) -> ReportReceiptOut:
    """Auth: PUBLIC — no token required. A valid token, if sent, only
    attributes the report to that Cognito `sub` (a present-but-invalid
    token still 401s, same as every other optional-auth route).
    """
    await listing_report_service.create_report(db, current_user, body)
    # Same receipt whether the report was stored or a honeypot hit was
    # silently discarded.
    return ReportReceiptOut()


@router.get("", response_model=ReportListResponse)
async def list_reports(
    status_filter: ReportStatus | None = Query(default=None, alias="status"),
    pagination: Pagination = Depends(pagination_params),
    db: AsyncSession = Depends(get_db),
    _admin: CurrentUser = Depends(require_admin),
) -> ReportListResponse:
    """Auth: admin only. Optional `status` query filter (new | resolved | dismissed)."""
    return await listing_report_service.list_reports(db, pagination, status_filter)


@router.patch("/{report_id}", response_model=ReportOut)
async def update_report(
    report_id: int,
    body: ReportUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_admin),
) -> ReportOut:
    report = await listing_report_service.update_report(
        db, report_id, current_user.cognito_sub, body
    )
    return listing_report_service.to_report_out(report)
