// `summary` objects on the admin list responses, matching docs/API_CONTRACTS.md
// "Admin list summaries". Whole-dataset counts: independent of the page's
// search text, filters and page number.

export interface AdminUsersSummary {
  total: number;
  /** Cognito Enabled. */
  active: number;
  /** Cognito disabled. */
  inactive: number;
  /** status == UNCONFIRMED (overlaps active/inactive). */
  unconfirmed: number;
  seen_last_30_days: number;
  /** Bucketed by highest-privilege role; sums to `total`. */
  by_role: {
    admin: number;
    owner: number;
    manager: number;
    registered_user: number;
  };
  /** A role group hit the Cognito cap: counts are a lower bound. */
  truncated: boolean;
}

export interface AdminOwnersSummary {
  total: number;
  /** >= 1 active location. */
  active: number;
  inactive: number;
  /** Subset of inactive: no live location at all. */
  without_locations: number;
}

export interface AdminManagersSummary {
  total: number;
  /** >= 1 active assignment. */
  active: number;
  /** All assignments revoked. */
  inactive: number;
  seen_last_30_days: number;
}

export interface AdminRegisteredUsersSummary {
  total: number;
  active: number;
  inactive: number;
  unconfirmed: number;
  seen_last_30_days: number;
  truncated: boolean;
}

export interface AdminListingsSummary {
  brands: number;
  unclaimed_brands: number;
  locations: number;
  active: number;
  coming_soon: number;
  owner_deactivated: number;
  closed_pending_reopen: number;
}
