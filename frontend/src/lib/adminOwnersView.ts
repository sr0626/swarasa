// Pure URL/query helpers for the admin Owners report page
// (app/admin/owners/page.tsx) -- kept out of the page so they can be unit
// tested (`npm run test:unit`, node --test; relative imports only).
import type { OwnerSort } from "../types/adminOwners.ts";

export const OWNER_SORTS: readonly OwnerSort[] = ["newest", "oldest", "most_locations", "email"];

export const OWNER_SORT_LABELS: Record<OwnerSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  most_locations: "Most locations",
  email: "Email A-Z",
};

export function parseOwnerSort(value: string | undefined): OwnerSort {
  return OWNER_SORTS.find((sort) => sort === value) ?? "newest";
}

/** Trimmed, length-capped (matches the API's max_length=100) search term, or undefined if blank. */
export function parseOwnerSearch(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 100) : undefined;
}

export function parsePage(value: string | undefined): number {
  if (!value) return 1;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/** Page href preserving the current search/sort; default values are omitted for clean URLs. */
export function buildOwnersHref(state: { page?: number; q?: string; sort?: OwnerSort }): string {
  const search = new URLSearchParams();
  if (state.q) search.set("q", state.q);
  if (state.sort && state.sort !== "newest") search.set("sort", state.sort);
  if (state.page && state.page > 1) search.set("page", String(state.page));
  const query = search.toString();
  return query ? `/admin/owners?${query}` : "/admin/owners";
}
