// Pure helpers for the admin CollapsiblePanel (components/ui/CollapsiblePanel
// .tsx): the localStorage key, parsing a stored open/closed value, deciding
// whether a page's search/filter state is "applied", and the one-line hint
// shown in a collapsed header. Kept free of React / DOM so it can be unit
// tested (`npm run test:unit`, node --test; relative imports only).

/** A parsed page-level filter value. Empty / null / undefined means "not set". */
export type FilterValue = string | number | boolean | null | undefined;

const KEY_PREFIX = "swarasa:panel";

/** Keeps a key segment to a safe, predictable shape (no spaces / separators). */
function segment(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "x"
  );
}

/** localStorage key for one panel on one page, e.g. `swarasa:panel:users:summary`. */
export function panelStorageKey(page: string, panel: string): string {
  return `${KEY_PREFIX}:${segment(page)}:${segment(panel)}`;
}

/** Stored value for an open panel / a closed panel. */
export const STORED_OPEN = "open";
export const STORED_CLOSED = "closed";

/** `true` / `false` for a recognised stored value, `null` for anything else. */
export function parseStoredOpen(raw: string | null | undefined): boolean | null {
  if (raw === STORED_OPEN) return true;
  if (raw === STORED_CLOSED) return false;
  return null;
}

export function storedValueFor(open: boolean): string {
  return open ? STORED_OPEN : STORED_CLOSED;
}

/**
 * How many of the given (already parsed) filter values are currently applied.
 * A value counts when it is non-empty after trimming and differs from that
 * key's default (e.g. `sort: "newest"` is the default, not a filter). `false`
 * and `0` are real values (e.g. "Free" tier) and DO count. Paging params are
 * simply not passed in.
 */
export function countAppliedFilters(
  values: Record<string, FilterValue>,
  defaults: Record<string, string> = {}
): number {
  let count = 0;
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text === "") continue;
    if (defaults[key] !== undefined && text === defaults[key]) continue;
    count += 1;
  }
  return count;
}

const SEARCH_HINT_MAX = 24;

/**
 * Hint for the collapsed "Search & filters" header: null when nothing is
 * applied; the search text itself when it is the only thing applied; else
 * "N applied".
 */
export function filtersHint(applied: number, searchText?: string | null): string | null {
  if (applied <= 0) return null;
  const text = (searchText ?? "").trim();
  if (applied === 1 && text) {
    const shown = text.length > SEARCH_HINT_MAX ? `${text.slice(0, SEARCH_HINT_MAX - 1)}…` : text;
    return `“${shown}”`;
  }
  return `${applied} applied`;
}
