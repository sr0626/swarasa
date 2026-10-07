// Types for GET /admin/registered-users, matching docs/API_CONTRACTS.md
// "GET /admin/registered-users" -- the admin "Registered users" report
// (email, Cognito status, signup date, last-visited).

/** `sort` values: newest/oldest by signup date, email A-Z, last_seen most-recent-first. */
export type RegisteredUserSort = "newest" | "oldest" | "email" | "last_seen";

export interface RegisteredUserRow {
  cognito_sub: string;
  email: string | null;
  /** The display name the diner set (`user_profile.full_name`); null for most. */
  full_name?: string | null;
  /** Cognito UserStatus verbatim (CONFIRMED, UNCONFIRMED, ...) -- not remapped. */
  status: string;
  /** ISO timestamp (UTC). */
  signup_at: string | null;
  /** ISO timestamp (UTC). `null` means never tracked yet -- render as "Never", not a fake date. */
  last_seen_at: string | null;
}

export interface RegisteredUsersResponse {
  results: RegisteredUserRow[];
  page: number;
  page_size: number;
  total: number;
}

export interface RegisteredUsersParams {
  page?: number;
  page_size?: number;
  /** Case-insensitive substring match on email or display name. */
  q?: string;
  sort?: RegisteredUserSort;
}
