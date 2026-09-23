// Types for GET /admin/registered-users, matching docs/API_CONTRACTS.md
// "GET /admin/registered-users" -- the admin "Registered users" report
// (email, Cognito status, signup date, last-visited).

export interface RegisteredUserRow {
  cognito_sub: string;
  email: string | null;
  /** Cognito UserStatus verbatim (CONFIRMED, UNCONFIRMED, ...) -- not remapped. */
  status: string;
  signup_at: string | null;
  /** `null` means never tracked yet -- render as "Never", not a fake date. */
  last_seen_at: string | null;
}

export interface RegisteredUsersResponse {
  results: RegisteredUserRow[];
  page: number;
  page_size: number;
  total: number;
}
