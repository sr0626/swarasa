// Types for `location_reopen_request` — the only path that moves a
// `closed_pending_reopen` location back to `active`. Matches
// backend/app/schemas/location_reopen.py, deliberately shaped like
// @/types/claim.ts's ClaimResponse/ClaimQueueItem/Approve/Reject — same
// admin-review pattern, same field names where the concept is the same.

export type ReopenRequestStatus = "pending_review" | "approved" | "rejected";

/** Body for POST /locations/{id}/reopen-requests. */
export interface CreateReopenRequestInput {
  notes?: string | null;
}

/** Response for POST /locations/{id}/reopen-requests and GET /location-reopen-requests/{id}. */
export interface ReopenRequestResponse {
  request_id: number;
  location_id: number;
  status: ReopenRequestStatus;
  notes: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  reviewer_notes: string | null;
}

/** Row of GET /location-reopen-requests (admin queue). */
export interface ReopenRequestQueueItem {
  request_id: number;
  location_id: number;
  brand_id: number;
  brand_name: string;
  brand_slug: string;
  location_address: string;
  requested_by_user_id: string;
  /** null when no owner_account row matches the requester. */
  requester_email: string | null;
  notes: string | null;
  status: ReopenRequestStatus;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_notes: string | null;
}

/** Body for POST /location-reopen-requests/{id}/approve. */
export interface ApproveReopenRequestInput {
  reviewer_notes?: string;
}

/** Body for POST /location-reopen-requests/{id}/reject. reviewer_notes is required. */
export interface RejectReopenRequestInput {
  reviewer_notes: string;
}
