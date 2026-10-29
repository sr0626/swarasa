// Pure state logic for grouped console menus (ConsoleGroupedNav.tsx): which
// groups are open, what the phone's second pill row shows, and how the user's
// manual choices are stored. No React / DOM here so it is unit-testable
// (navGroupState.test.ts). Server render and first client render both use
// `resolveOpenGroups(..., stored = {})`; stored choices are applied in an
// effect after mount, so there is no hydration mismatch.

/** The slice of a nav group this module needs. */
export interface GroupLike {
  id: string;
  defaultOpen?: boolean;
}

/** Map of group id -> open, as the user last set it by hand. */
export type StoredGroupState = Record<string, boolean>;

const KEY_PREFIX = "swarasa.consoleNav.";

/** localStorage key for one menu's manual open/close choices (`menuLabel` is the nav's aria-label). */
export function navGroupStorageKey(menuLabel: string): string {
  return `${KEY_PREFIX}${menuLabel.trim().toLowerCase().replace(/\s+/g, "-")}.groups`;
}

/** Groups open with no stored choice: those flagged `defaultOpen`, plus the one holding the active page. */
export function defaultOpenGroupIds(
  groups: ReadonlyArray<GroupLike>,
  activeGroupId: string | null
): Set<string> {
  const open = new Set<string>();
  for (const g of groups) if (g.defaultOpen || g.id === activeGroupId) open.add(g.id);
  return open;
}

/**
 * Open state per group id. A stored manual choice wins over the group's default,
 * except the group holding the active page, which is always open on arrival.
 */
export function resolveOpenGroups(
  groups: ReadonlyArray<GroupLike>,
  activeGroupId: string | null,
  stored: StoredGroupState = {}
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const g of groups) {
    out[g.id] = g.id === activeGroupId ? true : (stored[g.id] ?? Boolean(g.defaultOpen));
  }
  return out;
}

/** Parse the stored JSON; anything malformed (or an unknown group id) is dropped. */
export function parseStoredGroupState(raw: string | null, groups: ReadonlyArray<GroupLike>): StoredGroupState {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const out: StoredGroupState = {};
  for (const g of groups) {
    const v = (parsed as Record<string, unknown>)[g.id];
    if (typeof v === "boolean") out[g.id] = v;
  }
  return out;
}

/** Group id shown in the phone's second pill row: the user's pick, else the active page's group, else the default-open (or first) group. */
export function resolveSelectedGroupId(
  groups: ReadonlyArray<GroupLike>,
  activeGroupId: string | null,
  picked: string | null
): string | null {
  if (picked !== null && groups.some((g) => g.id === picked)) return picked;
  if (activeGroupId !== null) return activeGroupId;
  return (groups.find((g) => g.defaultOpen) ?? groups[0])?.id ?? null;
}
