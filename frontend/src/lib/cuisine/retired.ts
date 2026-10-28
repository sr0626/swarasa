// Owner-editor handling of DEACTIVATED taxonomy tags. An admin can deactivate
// a tag; locations that already carry it keep the link, and the location's
// own editors still receive it in the location payload — but it is no longer in
// the active taxonomy (GET /cuisine-tags), so the picker would not render it
// and the owner could not remove it. These helpers surface such tags as
// removable "retired" chips. No React, relative type imports only (node --test).
import type { CuisineTag } from "../../types/cuisine.ts";

export const RETIRED_SUFFIX = " (retired)";

/** Current tags that are absent from the active taxonomy (i.e. deactivated). */
export function retiredTags(
  activeTaxonomy: readonly CuisineTag[],
  current: readonly CuisineTag[]
): CuisineTag[] {
  const activeIds = new Set(activeTaxonomy.map((t) => t.id));
  return current.filter((t) => !activeIds.has(t.id));
}

/** Picker options: the active taxonomy plus the retired chips (labelled). */
export function withRetiredOptions(
  activeTaxonomy: readonly CuisineTag[],
  retired: readonly CuisineTag[]
): CuisineTag[] {
  return [
    ...activeTaxonomy,
    ...retired.map((t) => ({ ...t, display_name: `${t.display_name}${RETIRED_SUFFIX}` })),
  ];
}
