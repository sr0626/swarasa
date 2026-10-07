// Types for GET /admin/managers, matching docs/API_CONTRACTS.md
// "GET /admin/managers" -- the admin "Managers" report.

export type ManagerSort = "newest" | "oldest" | "most_locations" | "email" | "last_seen";

/** One ACTIVE assignment -- `brand_id`/`location_id` link to the admin listing. */
export interface AdminManagerLocation {
  location_id: number;
  brand_id: number;
  brand_name: string;
  location_name: string | null;
  city: string;
}

export interface AdminManagerOwner {
  id: number;
  /** null for a CCPA-deleted owner. */
  email: string | null;
  full_name: string | null;
}

export interface AdminManagerRow {
  cognito_sub: string;
  /** Cognito email, best-effort; null when the lookup failed. */
  email: string | null;
  full_name: string | null;
  /** ISO timestamp (UTC): the earliest assignment ("manager since"). */
  first_assigned_at: string | null;
  /** ISO timestamp (UTC); null = never tracked yet. */
  last_seen_at: string | null;
  active_location_count: number;
  owners: AdminManagerOwner[];
  locations: AdminManagerLocation[];
}

export interface AdminManagersResponse {
  results: AdminManagerRow[];
  page: number;
  page_size: number;
  total: number;
  /** True when the Cognito email lookup failed (emails are null; search matches names only). */
  email_lookup_degraded: boolean;
}

export interface AdminManagersParams {
  page?: number;
  page_size?: number;
  q?: string;
  sort?: ManagerSort;
}
