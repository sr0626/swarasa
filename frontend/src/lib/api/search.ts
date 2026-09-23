// Typed client for GET /search — docs/API_CONTRACTS.md "GET /search".
// Public endpoint, safe to call from an SSR page (frontend/CLAUDE.md
// "ALWAYS SSR restaurant listing pages and search pages").
import { apiFetch, toQueryString } from "./client";
import type { SearchParams, SearchResponse } from "@/types/search";

/** Default Next.js data-cache revalidation window for search results. */
const SEARCH_REVALIDATE_SECONDS = 60;

export async function searchRestaurants(
  params: SearchParams = {}
): Promise<SearchResponse> {
  const query = toQueryString({
    lat: params.lat,
    lng: params.lng,
    radius: params.radius,
    "cuisine[]": params.cuisine,
    "dietary[]": params.dietary,
    "type[]": params.type,
    q: params.q,
    has_deals_today: params.has_deals_today,
    page: params.page,
    page_size: params.page_size,
  });

  return apiFetch<SearchResponse>(
    `/search${query}`,
    { method: "GET" },
    { revalidateSeconds: SEARCH_REVALIDATE_SECONDS }
  );
}
