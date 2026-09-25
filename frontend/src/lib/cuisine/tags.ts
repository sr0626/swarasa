// Pure helpers for cuisine / dietary tags, which are PER LOCATION
// (docs/DECISIONS.md "Cuisine/dietary tags are per location"): grouping for the
// tag picker, the compact "first N + '+N'" summary the owner card shows on each
// location row, and small selection helpers. No React, no alias imports (type
// imports are erased) so it is unit-tested with `node --test`.
import type { CuisineCategory } from "@/types/cuisine";

/** Human label per `cuisine_tag.category`. */
export const CUISINE_CATEGORY_LABEL: Record<CuisineCategory, string> = {
  regional: "Regional cuisine",
  dietary: "Dietary",
  type: "Restaurant type",
  signature: "Signature dishes",
  dining_time: "Dining time",
};

/** Order the picker lists the categories in. */
export const CUISINE_CATEGORY_ORDER: readonly CuisineCategory[] = [
  "regional",
  "type",
  "dietary",
  "signature",
  "dining_time",
];

/** Groups tags by category, keeping the input order inside each group. */
export function groupTagsByCategory<T extends { category: CuisineCategory }>(
  tags: readonly T[]
): Map<CuisineCategory, T[]> {
  const groups = new Map<CuisineCategory, T[]>();
  for (const tag of tags) {
    const list = groups.get(tag.category) ?? [];
    list.push(tag);
    groups.set(tag.category, list);
  }
  return groups;
}

/** The categories that actually have tags, in display order. */
export function orderedCategories<T extends { category: CuisineCategory }>(
  groups: Map<CuisineCategory, T[]>
): CuisineCategory[] {
  return CUISINE_CATEGORY_ORDER.filter((category) => groups.has(category));
}

/**
 * Compact summary for a tight row: the first `max` tags plus how many were left
 * out (rendered as "+N"). `max` is clamped to at least 1.
 */
export function summarizeTags<T>(
  tags: readonly T[],
  max = 4
): { shown: T[]; hiddenCount: number } {
  const limit = Math.max(1, Math.floor(max));
  return { shown: tags.slice(0, limit), hiddenCount: Math.max(0, tags.length - limit) };
}

/** Toggles `id` in a selection, returning a new array (insertion order kept). */
export function toggleTagId(selected: readonly number[], id: number): number[] {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
}

/** True when both selections hold exactly the same ids (order-insensitive). */
export function sameTagIds(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}
