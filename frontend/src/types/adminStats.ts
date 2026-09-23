// Types for GET /admin/registered-user-count, matching
// docs/API_CONTRACTS.md "GET /admin/registered-user-count" -- a live
// Cognito-backed count, separate from GET /admin/overview (which stays a
// local-DB aggregate; see that section's own "registered_user_count is
// always null on THIS endpoint" note for why the two are split).

export interface RegisteredUserCount {
  count: number;
  /** Always "registered_user" today -- see the backend schema's own comment. */
  group: string;
}
