// "Setup checklist" rules for a listing that is not live yet — pure so they're
// unit-testable (listingSetup.test.ts).
//
// A manually added listing starts in `coming_soon` (hidden) and only goes
// public once its required info exists and the owner activates it
// (docs/DECISIONS.md "New manual listings start in setup"). The SERVER decides
// what's missing — `LocationDetail.setup_missing` from GET /locations/{id}
// (backend/app/services/listing_readiness.py) — and re-checks it on the
// activation itself (422 `listing_incomplete`); this file only turns those keys
// into the friendly checklist the editor shows.
import type { LocationStatus } from "@/types/location";

export type SetupItemKey = "name" | "address" | "phone" | "hours";

export interface SetupItem {
  key: SetupItemKey;
  /** Checklist row text ("Phone number"). */
  label: string;
  /** Imperative phrase for the "To go live: …" sentence. */
  todo: string;
  /** Editor section id (lib/portal/editorSections.ts) that fixes it. */
  sectionId: "hours" | "info";
}

/** In checklist order (matches the backend's `setup_missing` order). */
export const SETUP_ITEMS: readonly SetupItem[] = [
  { key: "name", label: "Restaurant name", todo: "add the restaurant name", sectionId: "info" },
  { key: "address", label: "Street address", todo: "add the full street address", sectionId: "info" },
  { key: "phone", label: "US phone number", todo: "add a valid US phone number", sectionId: "info" },
  { key: "hours", label: "Opening hours for all 7 days", todo: "add your opening hours", sectionId: "hours" },
];

const KNOWN_KEYS = new Set<string>(SETUP_ITEMS.map((item) => item.key));

/** Only the keys this UI knows, so a newer server can't render a blank row. */
export function knownMissing(setupMissing: readonly string[]): SetupItemKey[] {
  return SETUP_ITEMS.map((item) => item.key).filter((key) => setupMissing.includes(key)) as SetupItemKey[];
}

/** The setup banner/checklist only applies to a listing that is in setup. */
export function isInSetup(status: LocationStatus): boolean {
  return status === "coming_soon";
}

/** Whether the "Activate listing" action should be enabled. */
export function canActivate(status: LocationStatus, setupMissing: readonly string[]): boolean {
  return isInSetup(status) && knownMissing(setupMissing).length === 0 && !hasUnknownMissing(setupMissing);
}

/**
 * Why the "Active" choice can't be picked right now, or `null` when it can (or
 * doesn't apply because the listing isn't in setup). The server refuses the
 * transition too — 422 `listing_incomplete`; this just explains it up front.
 */
export function activationBlockedReason(
  status: LocationStatus,
  setupMissing: readonly string[]
): string | null {
  if (!isInSetup(status) || canActivate(status, setupMissing)) return null;
  return setupSummary(setupMissing) ?? "Finish setting up this listing first.";
}

/** A key we don't know still blocks activation (the server is authoritative). */
function hasUnknownMissing(setupMissing: readonly string[]): boolean {
  return setupMissing.some((key) => !KNOWN_KEYS.has(key));
}

/**
 * "To go live: add your opening hours, add a valid US phone number." — or
 * `null` when nothing is missing.
 */
export function setupSummary(setupMissing: readonly string[]): string | null {
  const todos = SETUP_ITEMS.filter((item) => setupMissing.includes(item.key)).map((item) => item.todo);
  if (todos.length === 0) return null;
  return `To go live: ${todos.join(", ")}.`;
}

/** Same rows as `SETUP_ITEMS`, each flagged done/missing. */
export function setupChecklist(
  setupMissing: readonly string[]
): Array<SetupItem & { done: boolean }> {
  return SETUP_ITEMS.map((item) => ({ ...item, done: !setupMissing.includes(item.key) }));
}
