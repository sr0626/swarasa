// Types for GET /admin/owners, matching docs/API_CONTRACTS.md
// "GET /admin/owners" -- the admin "Owners" report. No billing fields by
// design (payments are deferred).
import type { PaginatedResponse } from "@/types/common";

export type OwnerSort = "newest" | "oldest" | "most_locations" | "email";

export interface OwnerStatusBreakdown {
  active: number;
  owner_deactivated: number;
  coming_soon: number;
  closed_pending_reopen: number;
}

export interface AdminOwnerRow {
  id: number;
  /** `null` when `personal_data_deleted` (CCPA deletion executed). */
  email: string | null;
  full_name: string | null;
  phone: string | null;
  /** ISO timestamp -- `owner_account.created_at`. */
  joined_at: string;
  personal_data_deleted: boolean;
  brand_count: number;
  /** Location-grain; `by_status` values sum to this. */
  location_count: number;
  by_status: OwnerStatusBreakdown;
  verified_location_count: number;
  /** Total follows across all of this owner's brands. */
  follower_count: number;
  pending_claim_count: number;
  pending_reopen_request_count: number;
}

export type AdminOwnersResponse = PaginatedResponse<AdminOwnerRow>;

export interface AdminOwnersParams {
  page?: number;
  page_size?: number;
  /** Case-insensitive substring match on email or full name. */
  q?: string;
  sort?: OwnerSort;
}
