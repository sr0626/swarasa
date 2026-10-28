// Types for GET /cities and GET /cities/{slug}/restaurants
// (docs/API_CONTRACTS.md "Cities").
import type { PaginatedResponse } from "./common";
import type { SearchResultItem } from "./search";

export interface CitySummary {
  slug: string;
  city: string;
  state: string;
  /** Publicly visible (active) locations in the city. */
  location_count: number;
}

export type CityListResponse = PaginatedResponse<CitySummary>;

/** One tile per LOCATION, in the `/search` result shape (the shared tile renders it). */
export interface CityRestaurantsResponse extends PaginatedResponse<SearchResultItem> {
  city: CitySummary;
}
