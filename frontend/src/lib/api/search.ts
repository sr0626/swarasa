// Typed client for GET /search — docs/API_CONTRACTS.md "GET /search".
// Public endpoint, safe to call from an SSR page (frontend/CLAUDE.md
// "ALWAYS SSR restaurant listing pages and search pages").
import { apiFetch, toQueryString } from "./client";
import type { SearchParams, SearchResponse } from "@/types/search";

/** Default Next.js data-cache revalidation window for search results. */
const SEARCH_REVALIDATE_SECONDS = 60;

/**
 * `accessToken`: pass the viewer's token ONLY when they are a signed-in
 * registered_user — the backend then records the search in their activity
 * history (docs/API_CONTRACTS.md "Activity tracking"). Passing a token makes
 * `apiFetch` bypass Next's data cache (per-request, per-user), which is
 * exactly what recording needs; anonymous/homepage calls omit it and keep the
 * shared 60s cache. Results are identical either way.
 */
export async function searchRestaurants(
  params: SearchParams = {},
  accessToken?: string | null
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
    loc: params.loc,
    page: params.page,
    page_size: params.page_size,
  });

  return apiFetch<SearchResponse>(
    `/search${query}`,
    { method: "GET" },
    { revalidateSeconds: SEARCH_REVALIDATE_SECONDS, accessToken }
  );
}
