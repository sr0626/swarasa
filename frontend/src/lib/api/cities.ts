// Typed client for GET /cities and GET /cities/{slug}/restaurants —
// docs/API_CONTRACTS.md "Cities". Public, anonymous (never sends a token, so
// the response is identical for everyone and safe to cache), used by the SSR
// city landing pages and app/sitemap.ts.
import { apiFetch, toQueryString } from "./client";
import type { PaginationParams } from "@/types/common";
import type { CityListResponse, CityRestaurantsResponse, CitySummary } from "@/types/city";

/** Data-cache window; matches the backend's 5-minute Cache-Control window
 * closely enough that a new restaurant shows up on its city page within ~10 min. */
const CITY_REVALIDATE_SECONDS = 300;

/** Hard stop for the "fetch every city" loop (100 cities/page). */
const MAX_CITY_PAGES = 20;

export async function getCities(params: PaginationParams = {}): Promise<CityListResponse> {
  const query = toQueryString({ page: params.page, page_size: params.page_size });
  return apiFetch<CityListResponse>(
    `/cities${query}`,
    { method: "GET" },
    { revalidateSeconds: CITY_REVALIDATE_SECONDS }
  );
}

/** Every city, walking the pages. */
export async function getAllCities(): Promise<CitySummary[]> {
  const all: CitySummary[] = [];
  for (let page = 1; page <= MAX_CITY_PAGES; page += 1) {
    const result = await getCities({ page, page_size: 100 });
    all.push(...result.results);
    if (result.results.length < 100 || all.length >= result.total) break;
  }
  return all;
}

/** Throws `ApiError` with status 404 for an unknown city slug. */
export async function getCityRestaurants(
  citySlug: string,
  params: PaginationParams = {}
): Promise<CityRestaurantsResponse> {
  const query = toQueryString({ page: params.page, page_size: params.page_size });
  return apiFetch<CityRestaurantsResponse>(
    `/cities/${encodeURIComponent(citySlug)}/restaurants${query}`,
    { method: "GET" },
    { revalidateSeconds: CITY_REVALIDATE_SECONDS }
  );
}
