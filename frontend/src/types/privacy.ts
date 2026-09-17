// Types for the CCPA data export / deletion flow — docs/API_CONTRACTS.md
// "Privacy (CCPA data export / deletion)". Backend (PR #70) has been Done
// with zero frontend consumer until this page — matches backend/app/
// schemas/privacy.py exactly.

export interface OwnerAccountExport {
  id: number;
  cognito_sub: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  stripe_customer_id: string | null;
  created_at: string;
  personal_data_deleted_at: string | null;
}

export interface LocationManagerExport {
  location_id: number;
  is_active: boolean;
  assigned_at: string;
  revoked_at: string | null;
}

export interface FollowExport {
  brand_id: number;
  followed_at: string;
}

export interface ClaimRequestExport {
  claim_id: number;
  brand_id: number;
  status: string;
  proof_method: string;
  submitted_at: string;
  reviewed_at: string | null;
}

/** Actions the caller themselves performed — retained, never touched by a deletion request. */
export interface AuditLogExport {
  table_name: string;
  record_id: number;
  action: string;
  actor_role: string;
  created_at: string;
}

/** Full response for `GET /auth/me/data-export` — synchronous, JSON. */
export interface DataExport {
  cognito_sub: string;
  role: string;
  email: string | null;
  generated_at: string;
  owner_account: OwnerAccountExport | null;
  location_manager_assignments: LocationManagerExport[];
  follows: FollowExport[];
  claim_requests: ClaimRequestExport[];
  audit_log_entries: AuditLogExport[];
  notice: string;
}

/** Body for `POST /auth/me/data-deletion`. */
export interface CreateDataDeletionInput {
  reason?: string | null;
}

/**
 * `data_scope` on `DataDeletionRequest` is a row-count snapshot object
 * (`{ owner_account: 0, follows: 3, ... }`) — kept loose here (matching the
 * backend's `dict[str, Any] | None`) since it's admin-review context, not
 * something this page renders field-by-field.
 */
export type DataDeletionScope = Record<string, number> | null;

/** One request row, shared by POST /auth/me/data-deletion's response and GET's list. */
export interface DataDeletionRequest {
  request_id: number;
  status: string;
  requester_role: string;
  reason: string | null;
  data_scope: DataDeletionScope;
  submitted_at: string;
  reviewed_at: string | null;
  reviewer_notes: string | null;
  completed_at: string | null;
}
