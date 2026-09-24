// Pure helpers for the fine-grained tag filter (docs/API_CONTRACTS.md
// "GET /search"): URL <-> filter-state parsing/serialising and the
// grouping of `/cuisine-tags` results into filter groups. No React, no
// fetching — shared by the SSR search page, the client filter components
// and the homepage Hero so all three agree on one URL contract:
//
//   /search?cuisine=andhra&cuisine=hyderabadi&dietary=vegetarian&page=2
//
// Backend semantics (backend/app/services/search_service.py): the three
// facets below are ANDed together, values within one facet are ORed. The
// backend matches on `cuisine_tag.name` only (not category), and the API
// contract says `cuisine[]` is "also usable for `signature`/`dining_time`
// slugs" — so those two categories are sent as `cuisine`, no new params.
import type { CuisineCategory, CuisineTag } from "@/types/cuisine";

export type FilterParam = "cuisine" | "dietary" | "type";

export interface SearchFilters {
  cuisine: string[];
  dietary: string[];
  type: string[];
  /**
   * "Deals today" filter (docs/API_CONTRACTS.md "GET /search"
   * `has_deals_today`) — a single boolean toggle, not a multi-select tag
   * facet, so it deliberately lives outside `FILTER_PARAMS`/`FilterParam`
   * (which `TagFilterPanel`/`ActiveFilters` assume are array-valued). See
   * `toggleDealsToday` below for its own toggle helper, parallel to
   * `toggleFilter` for the tag facets.
   */
  dealsToday: boolean;
}

export const FILTER_PARAMS: readonly FilterParam[] = ["cuisine", "dietary", "type"];

/** URL query param for the "Deals today" toggle. */
export const DEALS_TODAY_PARAM = "deals_today";

export const EMPTY_FILTERS: SearchFilters = { cuisine: [], dietary: [], type: [], dealsToday: false };

/** Tag slugs are lower_snake (docs/TAXONOMY.md). URL input is untrusted,
 * so anything else is dropped rather than forwarded to the API. */
const SLUG_PATTERN = /^[a-z0-9_]{1,50}$/;
const MAX_VALUES_PER_FACET = 30;

/** Which `GET /search` param a tag category maps to. */
export function paramForCategory(category: CuisineCategory): FilterParam {
  if (category === "dietary") return "dietary";
  if (category === "type") return "type";
  return "cuisine"; // regional, plus signature/dining_time per the API contract
}

type RawSearchParams = { [key: string]: string | string[] | undefined };

function toList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Repeated params (`?cuisine=a&cuisine=b`) arrive as string[]; a single
 * one as string — both parse to the same shape, so the legacy single
 * `?cuisine=north_indian` link keeps working. */
export function parseFilters(searchParams: RawSearchParams): SearchFilters {
  const parsed: SearchFilters = { cuisine: [], dietary: [], type: [], dealsToday: false };
  for (const param of FILTER_PARAMS) {
    const seen = new Set<string>();
    for (const raw of toList(searchParams[param])) {
      const slug = raw.trim().toLowerCase();
      if (SLUG_PATTERN.test(slug)) seen.add(slug);
      if (seen.size >= MAX_VALUES_PER_FACET) break;
    }
    parsed[param] = Array.from(seen);
  }
  parsed.dealsToday = firstOf(searchParams[DEALS_TODAY_PARAM]) === "true";
  return parsed;
}

function firstOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function countFilters(filters: SearchFilters): number {
  return (
    filters.cuisine.length + filters.dietary.length + filters.type.length + (filters.dealsToday ? 1 : 0)
  );
}

/** True when the search URL carries at least one real search criterion:
 * non-blank location text, non-blank free-text `q`, any tag facet, or the
 * "Deals today" toggle. `page`/`sort` (and any unknown param) are NOT
 * criteria — they only shape how a search is displayed. When this is false
 * the /search page renders its empty "start a search" state and makes no
 * backend call (the homepage already shows "Popular near you"). */
export function hasSearchCriteria({
  location,
  query,
  filters,
}: {
  location?: string;
  query?: string;
  filters: SearchFilters;
}): boolean {
  return Boolean(location?.trim()) || Boolean(query?.trim()) || countFilters(filters) > 0;
}

export function isSelected(filters: SearchFilters, param: FilterParam, name: string): boolean {
  return filters[param].includes(name);
}

export function toggleFilter(
  filters: SearchFilters,
  param: FilterParam,
  name: string
): SearchFilters {
  const next = filters[param].includes(name)
    ? filters[param].filter((n) => n !== name)
    : [...filters[param], name];
  return { ...filters, [param]: next };
}

/** Flips the "Deals today" toggle, parallel to `toggleFilter` for the
 * array-valued tag facets above. */
export function toggleDealsToday(filters: SearchFilters): SearchFilters {
  return { ...filters, dealsToday: !filters.dealsToday };
}

export interface SearchHrefInput {
  location?: string;
  query?: string;
  filters: SearchFilters;
  /** Omitted/1 -> no `page` param (changing any filter resets to page 1). */
  page?: number;
}

export function buildSearchHref({ location, query, filters, page }: SearchHrefInput): string {
  const params = new URLSearchParams();
  if (location?.trim()) params.set("location", location.trim());
  if (query?.trim()) params.set("q", query.trim());
  for (const param of FILTER_PARAMS) {
    for (const name of filters[param]) params.append(param, name);
  }
  if (filters.dealsToday) params.set(DEALS_TODAY_PARAM, "true");
  if (page && page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/search?${qs}` : "/search";
}

// ---- filter groups ---------------------------------------------------

export type FilterTag = Pick<CuisineTag, "name" | "display_name" | "category">;

export interface FilterGroup {
  id: CuisineCategory;
  label: string;
  param: FilterParam;
  tags: { name: string; display_name: string }[];
}

const GROUP_ORDER: { id: CuisineCategory; label: string }[] = [
  { id: "regional", label: "Regional cuisine" },
  { id: "dietary", label: "Dietary" },
  { id: "type", label: "Restaurant type" },
  { id: "signature", label: "Signature dishes" },
  { id: "dining_time", label: "Dining time" },
];

/** Groups tags by category in a fixed display order, dropping empty
 * groups. A name that appears under two categories sharing the same
 * request param (e.g. `breakfast` is both `signature` and `dining_time`,
 * both sent as `cuisine`) is shown once — the backend can't tell them
 * apart, so two chips would just be one filter with two buttons. */
export function buildFilterGroups(tags: FilterTag[]): FilterGroup[] {
  const usedByParam: Record<FilterParam, Set<string>> = {
    cuisine: new Set(),
    dietary: new Set(),
    type: new Set(),
  };
  const groups: FilterGroup[] = [];
  for (const { id, label } of GROUP_ORDER) {
    const param = paramForCategory(id);
    const groupTags: FilterGroup["tags"] = [];
    for (const tag of tags) {
      if (tag.category !== id || usedByParam[param].has(tag.name)) continue;
      usedByParam[param].add(tag.name);
      groupTags.push({ name: tag.name, display_name: tag.display_name });
    }
    if (groupTags.length > 0) groups.push({ id, label, param, tags: groupTags });
  }
  return groups;
}

/** "gluten_free" -> "Gluten Free" — only for slugs with no known label
 * (e.g. a hand-edited URL, or a tag added after the list was fetched). */
export function prettifyTag(name: string): string {
  return name
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function labelFor(groups: FilterGroup[], param: FilterParam, name: string): string {
  for (const group of groups) {
    if (group.param !== param) continue;
    const tag = group.tags.find((t) => t.name === name);
    if (tag) return tag.display_name;
  }
  return prettifyTag(name);
}
