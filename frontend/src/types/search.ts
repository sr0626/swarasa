// Types for GET /search, matching docs/API_CONTRACTS.md.
import type { CuisineTag } from "./cuisine";

export interface SearchParams {
  lat?: number;
  lng?: number;
  /** Miles. Defaults to 15 server-side if omitted. */
  radius?: number;
  /** cuisine_tag.name values, category=regional (also signature/dining_time). */
  cuisine?: string[];
  /** cuisine_tag.name values, category=dietary. */
  dietary?: string[];
  /** cuisine_tag.name values, category=type. */
  type?: string[];
  /** Free-text: restaurant name or cuisine tag (backend `q`). */
  q?: string;
  /** Matches a brand if ANY of its locations has an active deal today —
   * docs/API_CONTRACTS.md "GET /search" `has_deals_today`. Omitted (not
   * `false`) means no filtering by deals at all; every result still
   * carries its own `nearest_location.has_deal_today` badge signal
   * regardless of whether this filter was used. */
  has_deals_today?: boolean;
  /**
   * The location text the visitor typed (city/ZIP) — sent ONLY on a signed-in
   * registered_user's search, purely so their search history can show it
   * (never affects results; docs/API_CONTRACTS.md "GET /search" `loc`).
   */
  loc?: string;
  page?: number;
  page_size?: number;
}

export interface SearchNearestLocation {
  location_id: number;
  /** null only for a text-search hit whose location has no coordinates. */
  distance_mi: number | null;
  // Added for a clickable full-address / Google Maps link on the search
  // result card (backend/app/schemas/search.py NearestLocationOut).
  address_line1: string;
  city: string;
  state: string;
  postal_code: string;
  /** Nullable: restaurant_location.phone itself is nullable. */
  phone: string | null;
  is_verified: boolean;
  is_paid: boolean;
  is_open_now: boolean | null;
  // Today's hours in the location's timezone (NearestLocationOut). All
  // null/absent = unknown -> the card shows no hours label. Optional so an
  // older deployed API without these fields degrades to no label.
  open_time?: string | null;
  close_time?: string | null;
  is_closed?: boolean | null;
  /**
   * Public "does THIS nearest location have an active deal today" badge
   * signal — content-free by design (docs/DECISIONS.md "Deals: public
   * boolean signal, gated content"; backend/app/schemas/search.py
   * `NearestLocationOut.has_deal_today`). Every caller sees this, including
   * anonymous. There is no matching deal-content field on a search result
   * (only `GET /locations/{id}` carries content, content-gated) — see
   * `@/components/ui/DealBadge.tsx`.
   */
  has_deal_today: boolean;
}

/** One brand-level card in the search results (docs/DECISIONS.md "Brand-level search results"). */
export interface SearchResultItem {
  brand_id: number;
  name: string;
  slug: string;
  is_claimed: boolean;
  cuisine_tags: CuisineTag[];
  nearest_location: SearchNearestLocation;
  /** How many of the brand's locations fall within the search radius. */
  location_count_nearby: number;
  /** Cover photo of the nearest_location specifically — not a brand-wide concept. */
  cover_photo_url: string | null;
  /** Smaller variant of cover_photo_url, sized for card-style listings
   * like this one (backend/app/schemas/search.py SearchResultOut) — was
   * already serialized by the backend but never consumed here. */
  cover_photo_thumbnail_url: string | null;
}

/**
 * What the shared restaurant tile (components/listing/RestaurantCard.tsx)
 * renders. A `SearchResultItem` satisfies it as-is; the only difference is
 * that `nearest_location` may be null — a followed brand whose locations are
 * all inactive (`GET /auth/me/follows`) has no address/hours/deal to show,
 * and the tile then simply omits those rows.
 */
export type RestaurantCardItem = Omit<SearchResultItem, "nearest_location"> & {
  nearest_location: SearchNearestLocation | null;
};

export interface SearchResponse {
  results: SearchResultItem[];
  page: number;
  page_size: number;
  total: number;
}
