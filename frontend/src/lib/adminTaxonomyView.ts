// Pure helpers for the admin taxonomy page (/admin/taxonomy): validation that
// mirrors the server, grouping/filtering the tag list, and the confirm-dialog
// copy. No React, no alias imports (type imports are erased) so it is unit
// tested with `node --test`.
import type { AdminTag } from "../types/adminTaxonomy.ts";
import type { CuisineCategory } from "../types/cuisine.ts";

export const DISPLAY_NAME_MAX = 120;

/** Human label per `cuisine_tag.category` ("kind" in the UI). */
export const KIND_LABEL: Record<CuisineCategory, string> = {
  regional: "Regional cuisine",
  dietary: "Dietary",
  type: "Restaurant type",
  signature: "Signature dishes",
  dining_time: "Dining time",
};

/** Display order of the kinds on the page and in the "Add tag" menu. */
export const KIND_ORDER: readonly CuisineCategory[] = [
  "regional",
  "type",
  "dietary",
  "signature",
  "dining_time",
];

export type StateFilter = "all" | "active" | "inactive";

/** Collapses whitespace runs and trims, like the server does. */
export function normalizeDisplayName(raw: string): string {
  return raw.split(/\s+/).filter(Boolean).join(" ");
}

/** Error text for a display name, or null when it is acceptable. */
export function validateDisplayName(raw: string): string | null {
  const value = normalizeDisplayName(raw);
  if (!value) return "Enter a name.";
  if (value.length > DISPLAY_NAME_MAX) return `Keep the name under ${DISPLAY_NAME_MAX} characters.`;
  return null;
}

/** Mirrors the server's slug derivation: "Street Food!" -> "street_food". */
export function slugPreview(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64)
    .replace(/_+$/g, "");
}

/** Case-insensitive duplicate check within a kind, optionally ignoring one tag. */
export function isDuplicateName(
  tags: readonly AdminTag[],
  category: CuisineCategory,
  displayName: string,
  ignoreId?: number
): boolean {
  const needle = normalizeDisplayName(displayName).toLowerCase();
  return tags.some(
    (t) =>
      t.category === category &&
      t.id !== ignoreId &&
      normalizeDisplayName(t.display_name).toLowerCase() === needle
  );
}

/** Tags matching the state filter and a free-text query (name or slug). */
export function filterTags(
  tags: readonly AdminTag[],
  state: StateFilter,
  query: string
): AdminTag[] {
  const q = query.trim().toLowerCase();
  return tags.filter((t) => {
    if (state === "active" && !t.is_active) return false;
    if (state === "inactive" && t.is_active) return false;
    if (!q) return true;
    return t.display_name.toLowerCase().includes(q) || t.name.toLowerCase().includes(q);
  });
}

export interface TagGroup {
  category: CuisineCategory;
  label: string;
  tags: AdminTag[];
}

/** Groups by kind in display order, sorted by name inside a group; empty kinds omitted. */
export function groupAdminTags(tags: readonly AdminTag[]): TagGroup[] {
  return KIND_ORDER.flatMap((category) => {
    const inKind = tags
      .filter((t) => t.category === category)
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
    return inKind.length ? [{ category, label: KIND_LABEL[category], tags: inKind }] : [];
  });
}

/** "12 locations" / "1 location" / "Unused". */
export function usageLabel(count: number): string {
  if (count <= 0) return "Unused";
  return count === 1 ? "1 location" : `${count} locations`;
}

export function summarize(tags: readonly AdminTag[]): { total: number; active: number; inactive: number } {
  const active = tags.filter((t) => t.is_active).length;
  return { total: tags.length, active, inactive: tags.length - active };
}

/** Body text for the deactivate confirmation dialog. */
export function deactivateConfirmText(tag: Pick<AdminTag, "display_name" | "usage_count">): string {
  const used =
    tag.usage_count > 0
      ? `${usageLabel(tag.usage_count)} currently use it. They keep it, but it will no longer show to the public or in search filters; only their owners, managers and admins will see it.`
      : "No locations use it yet.";
  return `Deactivate "${tag.display_name}"? It will stop being offered in tag pickers and search filters. ${used} Nothing is deleted, and you can reactivate it any time.`;
}

/** Replaces one tag in a list (by id), or appends when new; returns a new array. */
export function upsertTag(tags: readonly AdminTag[], next: AdminTag): AdminTag[] {
  return tags.some((t) => t.id === next.id)
    ? tags.map((t) => (t.id === next.id ? next : t))
    : [...tags, next];
}
