// Types for `user_follow` — docs/API_CONTRACTS.md "Follows (`user_follow`)".

import type { RestaurantCardItem } from "./search";

/**
 * One row of `GET /auth/me/follows`. Search-result-shaped on purpose
 * (`RestaurantCardItem`) so the favourites grid renders the very same tile
 * as `/search` (components/listing/RestaurantCard.tsx).
 *
 * `nearest_location` is the ONE location the tile represents: the first
 * active location with a deal today, else the first active location (the one
 * the restaurant page shows first); `distance_mi` is always null (no viewer
 * position); null when the brand has no active location.
 * `location_count_nearby` is the brand's total number of active locations.
 */
export interface FollowedBrand extends RestaurantCardItem {
  followed_at: string;
  /** True when any of the brand's active locations has a deal today. */
  has_deal_today: boolean;
  /** Up to 2 of today's deal titles (registered-user-only endpoint). The
   * tile shows only the badge, so nothing renders these today. */
  deal_titles_today: string[];
}

/** Response for `POST /restaurants/{id}/follow`. */
export interface FollowOut {
  brand_id: number;
  followed_at: string;
}
