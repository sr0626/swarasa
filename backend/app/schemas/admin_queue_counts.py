"""Response shape for `GET /admin/queue-counts` -- see docs/API_CONTRACTS.md
"Admin queue counts". Drives the action-item badges on the admin console's
"Work queue" menu group."""
from __future__ import annotations

from pydantic import BaseModel


class ClaimsQueueCounts(BaseModel):
    # `claim_request.status = 'pending_review'`.
    pending: int
    # Subset of `pending` past its `sla_due_at` (submitted_at + 2 business days).
    overdue: int


class MessagesQueueCounts(BaseModel):
    # `admin_message.status = 'open'`.
    open: int


class ReportsQueueCounts(BaseModel):
    # `listing_report.status = 'new'` (untriaged).
    new: int


class ReopenQueueCounts(BaseModel):
    # `location_reopen_request.status = 'pending_review'`.
    pending: int


class AdminQueueCountsResponse(BaseModel):
    claims: ClaimsQueueCounts
    messages: MessagesQueueCounts
    reports: ReportsQueueCounts
    reopen_requests: ReopenQueueCounts
    # Items needing an admin decision: claims.pending + messages.open +
    # reports.new + reopen_requests.pending. `overdue` is a subset of
    # `claims.pending` and is NOT added again.
    total: int
