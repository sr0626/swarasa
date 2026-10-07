// Pure URL/query helpers shared by the admin list reports that have a search
// box + sort menu + page links (Registered users, Managers). The Owners
// report predates this and keeps its own `adminOwnersView.ts`. Kept out of
// the pages so they can be unit tested (`npm run test:unit`, node --test;
// relative imports only).
import type { ManagerSort } from "../types/adminManagers.ts";
import type { RegisteredUserSort } from "../types/adminRegisteredUsers.ts";

export const REGISTERED_USER_SORTS: readonly RegisteredUserSort[] = [
  "newest",
  "oldest",
  "email",
  "last_seen",
];

export const REGISTERED_USER_SORT_LABELS: Record<RegisteredUserSort, string> = {
  newest: "Newest signup",
  oldest: "Oldest signup",
  email: "Email A-Z",
  last_seen: "Recently seen",
};

export const MANAGER_SORTS: readonly ManagerSort[] = [
  "newest",
  "oldest",
  "most_locations",
  "email",
  "last_seen",
];

export const MANAGER_SORT_LABELS: Record<ManagerSort, string> = {
  newest: "Newest manager",
  oldest: "Oldest manager",
  most_locations: "Most locations",
  email: "Email A-Z",
  last_seen: "Recently seen",
};

/** An allowed sort value, else `fallback` (the API default). */
export function parseSort<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T
): T {
  return allowed.find((option) => option === value) ?? fallback;
}

/** Trimmed, length-capped (matches the API's max_length=100) search term, or undefined if blank. */
export function parseSearch(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 100) : undefined;
}

export function parsePage(value: string | undefined): number {
  if (!value) return 1;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/** `basePath` + current search/sort/page; default values are omitted for clean URLs. */
export function buildReportHref<T extends string>(
  basePath: string,
  state: { page?: number; q?: string; sort?: T },
  defaultSort: T
): string {
  const search = new URLSearchParams();
  if (state.q) search.set("q", state.q);
  if (state.sort && state.sort !== defaultSort) search.set("sort", state.sort);
  if (state.page && state.page > 1) search.set("page", String(state.page));
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}
