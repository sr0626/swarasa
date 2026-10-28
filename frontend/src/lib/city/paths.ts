// URL helpers for the SEO city landing pages. Pure, no alias imports:
// unit-tested with `node --test`.
//
//   /indian-restaurants               city index (every city + count)
//   /indian-restaurants/{city-slug}   one city's listing, page 1
//   /indian-restaurants/{city-slug}?page=N   later pages — real, crawlable links
//
// The city slug is DERIVED BY THE BACKEND (backend/app/services/city_service.py
// `slugify_city`, with a `-{state}` suffix only for cross-state collisions);
// the frontend only ever uses the slug the API returns, never re-derives it.

/** Cities shown per page on a city landing page (3-column grid friendly). */
export const CITY_PAGE_SIZE = 24;

export const CITY_INDEX_PATH = "/indian-restaurants";

/** `/indian-restaurants/{citySlug}` */
export function cityPath(citySlug: string): string {
  return `${CITY_INDEX_PATH}/${citySlug}`;
}

/** Path of one page of a city listing. Page 1 (and anything invalid) is the
 * bare city path, so there is exactly one URL for the first page. */
export function cityPagePath(citySlug: string, page: number): string {
  return page > 1 ? `${cityPath(citySlug)}?page=${page}` : cityPath(citySlug);
}

/** Parses a `?page=` value. Returns `null` when it is present but not a
 * positive integer, so the caller can 404 junk instead of silently serving
 * page 1 under a second URL. Absent -> 1. */
export function parsePageParam(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === "") return 1;
  if (!/^[1-9][0-9]{0,5}$/.test(value)) return null;
  return Number(value);
}
