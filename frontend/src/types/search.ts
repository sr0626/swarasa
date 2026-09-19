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

export interface SearchResponse {
  results: SearchResultItem[];
  page: number;
  page_size: number;
  total: number;
}
