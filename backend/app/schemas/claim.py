"""Claim flow (/claim) — see docs/API_CONTRACTS.md "Claim flow (/claim)"."""
from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, StringConstraints, model_validator

from app.schemas.utc import UtcDatetime

# Reviewer/verification notes: trimmed, capped at 2000 chars (a longer value
# is a generic 422 "Invalid request parameters" -- see app/core/errors.py).
REVIEWER_NOTES_MAX_LENGTH = 2000
ReviewerNotes = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=REVIEWER_NOTES_MAX_LENGTH)
]
RequiredReviewerNotes = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=1, max_length=REVIEWER_NOTES_MAX_LENGTH
    ),
]

ProofMethod = Literal["google_business_profile", "phone_verification", "document_upload"]


class ClaimCreate(BaseModel):
    brand_id: int
    location_id: int | None = None
    proof_method: ProofMethod
    google_business_profile_url: str | None = None
    supporting_document_url: str | None = None

    @model_validator(mode="after")
    def _validate_proof(self) -> "ClaimCreate":
        if self.proof_method == "google_business_profile" and not self.google_business_profile_url:
            raise ValueError("google_business_profile_url is required for this proof method")
        if self.proof_method == "document_upload" and not self.supporting_document_url:
            raise ValueError("supporting_document_url is required for this proof method")
        return self


class ClaimOut(BaseModel):
    claim_id: int
    brand_id: int
    status: str
    proof_method: str
    submitted_at: UtcDatetime
    sla_due_at: UtcDatetime
    reviewed_at: UtcDatetime | None = None
    reviewer_notes: str | None = None
    # Only ever set on the `POST /claim/{id}/approve` response: True = claimant
    # added to the Cognito `owner` group, False = attempted and failed
    # (approval itself still committed), None = not applicable/not attempted.
    owner_group_granted: bool | None = None


ClaimStatus = Literal["pending_review", "approved", "rejected"]


class ClaimQueueItem(BaseModel):
    """Admin-facing claim row (`GET /claim`). `supporting_document_url` is
    the stored S3 key (no presigned read URL is minted here)."""

    claim_id: int
    brand_id: int
    brand_name: str
    brand_slug: str
    location_id: int | None = None
    location_address: str | None = None
    claimant_user_id: str
    claimant_email: str | None = None
    proof_method: str
    google_business_profile_url: str | None = None
    supporting_document_url: str | None = None
    status: str
    submitted_at: UtcDatetime
    sla_due_at: UtcDatetime
    reviewed_at: UtcDatetime | None = None
    reviewer_notes: str | None = None
    # Admin Cognito sub who approved/rejected the claim, and its email
    # (best-effort, batched per page; `None` when the lookup fails or finds
    # nothing -- the UI then shows a short form of `reviewed_by`).
    reviewed_by: str | None = None
    reviewed_by_email: str | None = None
    # Latest edit of `reviewer_notes` AFTER the review (from audit_log);
    # all `None` when the note was never edited after the review.
    notes_edited_at: UtcDatetime | None = None
    notes_edited_by: str | None = None
    notes_edited_by_email: str | None = None


class ClaimListResponse(BaseModel):
    results: list[ClaimQueueItem]
    page: int
    page_size: int
    total: int


class ClaimApproveRequest(BaseModel):
    reviewer_notes: ReviewerNotes | None = None


class ClaimRejectRequest(BaseModel):
    reviewer_notes: RequiredReviewerNotes


class ClaimNotesUpdateRequest(BaseModel):
    """`PATCH /claim/{id}/notes`. Blank clears the note on an approved claim;
    a rejected claim must keep a non-empty note (checked in the service)."""

    reviewer_notes: ReviewerNotes
