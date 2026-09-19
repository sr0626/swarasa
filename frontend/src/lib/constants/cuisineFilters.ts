// Homepage cuisine filter chips.
//
// FLAGGED GAP (see final report): there is no public "list cuisine tags"
// endpoint in docs/API_CONTRACTS.md — `cuisine_tag` rows are admin-managed
// only (docs/TAXONOMY.md "Seed Script Notes"), so this list can't be fetched
// live yet. These are real `cuisine_tag.name` / `display_name` values taken
// directly from docs/TAXONOMY.md (not invented), scoped to the handful most
// useful as homepage quick filters. When a public cuisine-tag list endpoint
// exists, swap this constant for a fetch.
//
// Note: the approved mockup's "Pure Vegetarian" chip is renamed to
// "Vegetarian" here to match the actual `dietary` tag's `display_name` in
// docs/TAXONOMY.md — there is no separate "pure_vegetarian" tag.
import type { CuisineCategory } from "@/types/cuisine";

export interface CuisineFilterChip {
  /** `cuisine_tag.name` — omitted for the synthetic "All Cuisines" chip. */
  name: string | null;
  display_name: string;
  category: CuisineCategory | null;
}

export const CUISINE_FILTER_CHIPS: CuisineFilterChip[] = [
  { name: null, display_name: "All Cuisines", category: null },
  { name: "north_indian", display_name: "North Indian", category: "regional" },
  { name: "south_indian", display_name: "South Indian", category: "regional" },
  { name: "hyderabadi", display_name: "Hyderabadi", category: "regional" },
  { name: "street_food", display_name: "Street Food", category: "regional" },
  { name: "vegetarian", display_name: "Vegetarian", category: "dietary" },
];

// Fallback taxonomy for the search page's fine-grained filter panel, used
// ONLY when `GET /cuisine-tags` fails (frontend/CLAUDE.md "ALWAYS handle API
// errors gracefully"). Real `cuisine_tag.name`/`display_name` values from
// docs/TAXONOMY.md — the panel then still offers the core facets instead
// of disappearing. The live list from the API is the source of truth.
export const FALLBACK_FILTER_TAGS: {
  name: string;
  display_name: string;
  category: CuisineCategory;
}[] = [
  { name: "north_indian", display_name: "North Indian", category: "regional" },
  { name: "south_indian", display_name: "South Indian", category: "regional" },
  { name: "andhra", display_name: "Andhra", category: "regional" },
  { name: "hyderabadi", display_name: "Hyderabadi", category: "regional" },
  { name: "punjabi", display_name: "Punjabi", category: "regional" },
  { name: "indo_chinese", display_name: "Indo-Chinese", category: "regional" },
  { name: "street_food", display_name: "Street Food", category: "regional" },
  { name: "vegetarian", display_name: "Vegetarian", category: "dietary" },
  { name: "vegan", display_name: "Vegan", category: "dietary" },
  { name: "halal", display_name: "Halal", category: "dietary" },
  { name: "gluten_free", display_name: "Gluten Free", category: "dietary" },
  { name: "dine_in", display_name: "Dine-in", category: "type" },
  { name: "takeout", display_name: "Takeout", category: "type" },
  { name: "buffet", display_name: "Buffet", category: "type" },
  { name: "catering", display_name: "Catering", category: "type" },
];
