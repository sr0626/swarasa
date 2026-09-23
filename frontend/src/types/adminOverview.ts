// Types for GET /admin/overview, matching docs/API_CONTRACTS.md "GET
// /admin/overview" -- the data behind the admin "Platform Overview" page
// (/admin/overview).
import type { LocationStatus } from "./location";

export type StatusBreakdown = Record<LocationStatus, number>;

export interface TierBreakdown {
  paid: number;
  free: number;
}

/**
 * Brand-grain counts -- `by_status`/`by_tier` use the same "matches a
 * brand if ANY of its locations satisfies this" semantics as
 * `GET /restaurants`' `status`/`is_paid` filters (PR #177), so each
 * number here equals the `total` a click-through to
 * `/admin/listings?status=<x>` / `?is_paid=<x>` shows. NOT mutually
 * exclusive -- these do not have to sum to `total`. See
 * docs/API_CONTRACTS.md "GET /admin/overview" for the full writeup.
 */
export interface RestaurantOverview {
  total: number;
  by_status: StatusBreakdown;
  by_tier: TierBreakdown;
}

/**
 * Location-grain -- a DIFFERENT grain from `RestaurantOverview` above
 * (deliberate, documented judgment call). `by_status` always sums to
 * `restaurant_count` here, unlike `RestaurantOverview.by_status`.
 */
export interface OwnerOverviewItem {
  owner_id: number;
  email: string;
  restaurant_count: number;
  by_status: StatusBreakdown;
}

export interface OwnerOverview {
  total_owners: number;
  results: OwnerOverviewItem[];
  page: number;
  page_size: number;
  total: number;
}

export interface AdminOverview {
  restaurants: RestaurantOverview;
  owners: OwnerOverview;
  /**
   * Always `null` today -- total registered-user count is out of scope
   * for this endpoint (needs Cognito `ListUsers` access, a separate
   * parallel task). Render a "coming soon" placeholder while this is
   * `null`, same posture as `RestaurantBrand.follower_count`'s
   * caller-gated `null`.
   */
  registered_user_count: number | null;
}
