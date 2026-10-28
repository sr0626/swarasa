// Types for GET /admin/users and POST /admin/users/{username}/<action>,
// matching docs/API_CONTRACTS.md "GET /admin/users".

export type AdminUserRole = "admin" | "owner" | "manager" | "registered_user";
export type AdminUserStatusFilter = "enabled" | "disabled" | "unconfirmed";
export type AdminUserSort = "newest" | "oldest" | "email" | "last_seen";
export type AdminUserAction = "disable" | "enable" | "confirm" | "reset-password";

export interface AdminUserRow {
  /** Cognito's identifier -- what the action endpoints take. */
  username: string;
  cognito_sub: string;
  email: string | null;
  full_name: string | null;
  /** Highest-privilege group; `roles` lists every group. */
  role: AdminUserRole;
  roles: AdminUserRole[];
  /** Cognito UserStatus verbatim (CONFIRMED, UNCONFIRMED, RESET_REQUIRED...). */
  status: string;
  confirmed: boolean;
  enabled: boolean;
  /** ISO timestamp (UTC). */
  created_at: string | null;
  /** ISO timestamp (UTC); null = never tracked. */
  last_seen_at: string | null;
  /** True for the calling admin's own row. */
  is_self: boolean;
}

export interface AdminUsersResponse {
  results: AdminUserRow[];
  page: number;
  page_size: number;
  total: number;
  /** True when a group exceeded the per-group cap, so the list is incomplete. */
  truncated: boolean;
}

export interface AdminUsersParams {
  page?: number;
  page_size?: number;
  q?: string;
  role?: AdminUserRole;
  status?: AdminUserStatusFilter;
  sort?: AdminUserSort;
}

export interface AdminUserActionResult {
  username: string;
  action: AdminUserAction;
  enabled: boolean | null;
  status: string | null;
}
