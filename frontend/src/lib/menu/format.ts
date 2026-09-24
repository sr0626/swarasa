// Small pure helpers for the menu UI (public display + editor reorder).
// Kept free of `@/` alias imports so `npm run test:unit` (node --test with
// type stripping) can import this file directly.

interface SizeLike {
  label: string;
  price: string;
}

/** "Personal $10 · Double $15 · Family Pack $25" — the one-line form of a
 * sized item's prices (used for aria labels, JSON-LD-free summaries and the
 * editor list). Blank rows are skipped. */
export function formatSizesInline(sizes: SizeLike[] | null | undefined): string {
  return (sizes ?? [])
    .filter((s) => s.label.trim() && s.price.trim())
    .map((s) => `${s.label.trim()} ${s.price.trim()}`)
    .join(" · ");
}

/** The single string a price cell/summary shows for an item: its one price,
 * or the sizes inline. Empty string if (impossible per the API) neither. */
export function formatItemPrice(item: { price: string | null; sizes: SizeLike[] | null }): string {
  if (item.sizes && item.sizes.length > 0) return formatSizesInline(item.sizes);
  return item.price?.trim() ?? "";
}

/** Returns a copy of `ids` with the entry at `index` moved one step up
 * (`-1`) or down (`+1`); unchanged copy when it would fall off either end. */
export function moveId<T>(ids: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  const next = [...ids];
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) return next;
  // Remove the entry, then re-insert it one slot over (no indexed reads, so
  // this stays clean under noUncheckedIndexedAccess).
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, ...(moved === undefined ? [] : [moved]));
  return next;
}

/** Same as `moveId` for a list of rows (sizes editor). */
export function moveRow<T>(rows: readonly T[], index: number, direction: -1 | 1): T[] {
  return moveId(rows, index, direction);
}

/** True when the menu has nothing to show publicly (no groups, no items). */
export function isMenuEmpty(menu: {
  ungrouped_items: readonly unknown[];
  sections: readonly { items: readonly unknown[] }[];
}): boolean {
  return menu.ungrouped_items.length === 0 && menu.sections.every((s) => s.items.length === 0);
}
