"""Claim flow (/claim) — see docs/API_CONTRACTS.md "Claim flow (/claim)"."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, model_validator

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
    submitted_at: datetime
    sla_due_at: datetime
    reviewed_at: datetime | None = None
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
    submitted_at: datetime
    sla_due_at: datetime
    reviewed_at: datetime | None = None
    reviewer_notes: str | None = None


class ClaimListResponse(BaseModel):
    results: list[ClaimQueueItem]
    page: int
    page_size: int
    total: int


class ClaimApproveRequest(BaseModel):
    reviewer_notes: str | None = None


class ClaimRejectRequest(BaseModel):
    reviewer_notes: str
