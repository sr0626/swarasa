"""location_reopen_request — see app/models/location_reopen_request.py and
docs/API_CONTRACTS.md "Location reopen requests
(`/locations/{id}/reopen-requests`, `/location-reopen-requests`)".

Shape deliberately mirrors app/schemas/claim.py (ClaimCreate/ClaimOut/
ClaimQueueItem/ClaimApproveRequest/ClaimRejectRequest) — same admin-review
pattern, same field names where the concept is the same (`reviewer_notes`,
`status`, `submitted_at`, `reviewed_at`).
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

NOTES_MAX_LENGTH = 2000

ReopenRequestStatus = Literal["pending_review", "approved", "rejected"]


class ReopenRequestCreate(BaseModel):
    """Body for `POST /locations/{id}/reopen-requests` — `location_id`
    comes from the path (same pattern as `POST /locations/{id}/managers`'s
    `AssignManagerRequest`), so only the owner's optional notes are here."""

    notes: str | None = Field(default=None, max_length=NOTES_MAX_LENGTH)


class ReopenRequestOut(BaseModel):
    """Response for `POST /locations/{id}/reopen-requests` and
    `GET /location-reopen-requests/{id}`."""

    request_id: int
    location_id: int
    status: ReopenRequestStatus
    notes: str | None = None
    submitted_at: datetime
    reviewed_at: datetime | None = None
    reviewer_notes: str | None = None


class ReopenRequestQueueItem(BaseModel):
    """Admin-facing row (`GET /location-reopen-requests`) — same shape
    family as `ClaimQueueItem`, with the brand/location context a bare
    `location_id` wouldn't give the admin reviewer."""

    request_id: int
    location_id: int
    brand_id: int
    brand_name: str
    brand_slug: str
    location_address: str
    requested_by_user_id: str
    # None when no owner_account row matches the requester — same
    # nullability reasoning as ClaimQueueItem.claimant_email.
    requester_email: str | None = None
    notes: str | None = None
    status: ReopenRequestStatus
    submitted_at: datetime
    reviewed_by: str | None = None
    reviewed_at: datetime | None = None
    reviewer_notes: str | None = None


class ReopenRequestListResponse(BaseModel):
    results: list[ReopenRequestQueueItem]
    page: int
    page_size: int
    total: int


class ReopenRequestApproveRequest(BaseModel):
    reviewer_notes: str | None = Field(default=None, max_length=NOTES_MAX_LENGTH)


class ReopenRequestRejectRequest(BaseModel):
    reviewer_notes: str = Field(min_length=1, max_length=NOTES_MAX_LENGTH)
