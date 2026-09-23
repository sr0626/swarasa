// Types for registered-user activity tracking (searches + restaurant-tile
// clicks) — docs/API_CONTRACTS.md "Activity tracking (`/activity`)" and
// "GET /admin/registered-users/{user_sub}/activity". Matches
// backend/app/schemas/activity.py.

/** Which UI surface a restaurant tile was clicked on. */
export type ActivitySource = "search_results" | "homepage" | "favourites";

export type ActivityEventType = "search" | "tile_click";

/** Body of `POST /activity/tile-click`. */
export interface TileClickInput {
  brand_id: number;
  /** null on brand-level tiles with no location (the favourites grid). */
  location_id: number | null;
  source: ActivitySource;
}

/** Stored payload of a `search` event; keys are omitted when empty. */
export interface SearchEventPayload {
  q?: string;
  cuisine?: string[];
  dietary?: string[];
  type?: string[];
  loc?: string;
  has_deals_today?: boolean;
  result_count?: number;
}

interface ActivityEventBase {
  id: number;
  created_at: string;
  /** tile_click only; null when the restaurant/location has since been removed. */
  brand_name: string | null;
  location_label: string | null;
}

export type ActivityEvent =
  | (ActivityEventBase & { event_type: "search"; payload: SearchEventPayload })
  | (ActivityEventBase & { event_type: "tile_click"; payload: TileClickInput });

export interface UserActivityResponse {
  results: ActivityEvent[];
  page: number;
  page_size: number;
  total: number;
  /** Retention window applied to this listing, in days. */
  retention_days: number;
}
