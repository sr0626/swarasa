"""CCPA data export / deletion — see docs/API_CONTRACTS.md "Privacy (CCPA
data export / deletion)"."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class OwnerAccountExportOut(BaseModel):
    id: int
    cognito_sub: str
    email: str
    full_name: str | None
    phone: str | None
    stripe_customer_id: str | None
    created_at: datetime
    personal_data_deleted_at: datetime | None


class LocationManagerExportOut(BaseModel):
    location_id: int
    is_active: bool
    assigned_at: datetime
    revoked_at: datetime | None


class FollowExportOut(BaseModel):
    brand_id: int
    followed_at: datetime


class ClaimRequestExportOut(BaseModel):
    claim_id: int
    brand_id: int
    status: str
    proof_method: str
    submitted_at: datetime
    reviewed_at: datetime | None


class ListingReportExportOut(BaseModel):
    """A "report a problem" submission attributed to the caller — matched
    by `listing_report.reporter_user_id` (their Cognito `sub`), NOT by
    `reporter_email`: that field is free text any submitter (including an
    anonymous one) can type, so it is not a reliable identity match — see
    `app/services/privacy_service.py` module docstring.
    """

    report_id: int
    brand_id: int
    location_id: int | None
    category: str
    details: str
    reporter_email: str | None
    status: str
    submitted_at: datetime
    reviewed_at: datetime | None


class AuditLogExportOut(BaseModel):
    """Actions the caller themselves performed, per DECISIONS.md "CCPA
    data export/deletion" — included for transparency, but retained (not
    deleted/anonymized) by a data-deletion request; see `notice` on
    `DataExportOut`.
    """

    table_name: str
    record_id: int
    action: str
    actor_role: str
    created_at: datetime


class DataExportOut(BaseModel):
    cognito_sub: str
    role: str
    email: str | None
    generated_at: datetime
    owner_account: OwnerAccountExportOut | None
    location_manager_assignments: list[LocationManagerExportOut]
    follows: list[FollowExportOut]
    claim_requests: list[ClaimRequestExportOut]
    listing_reports: list[ListingReportExportOut]
    audit_log_entries: list[AuditLogExportOut]
    notice: str


class DataDeletionRequestCreate(BaseModel):
    reason: str | None = None


class DataDeletionRequestOut(BaseModel):
    request_id: int
    status: str
    requester_role: str
    reason: str | None
    data_scope: dict[str, Any] | None
    submitted_at: datetime
    reviewed_at: datetime | None
    reviewer_notes: str | None
    completed_at: datetime | None


class DataDeletionListResponse(BaseModel):
    results: list[DataDeletionRequestOut]
    page: int
    page_size: int
    total: int


class DataDeletionApproveRequest(BaseModel):
    reviewer_notes: str | None = None


class DataDeletionRejectRequest(BaseModel):
    reviewer_notes: str
