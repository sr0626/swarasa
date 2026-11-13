// Missing-info chips for a location row on the admin Listings page
// (`/admin/listings`). Pure so it is unit-testable with `node --test`
// (adminListingSetup.test.ts); rendered by components/admin/SetupMissingChips.tsx.
//
// The SERVER computes what is missing (`AdminListingLocation.setup_missing`,
// backend/app/services/listing_readiness.py) and only for a location in a setup
// status (`coming_soon` / `import_review`); this file turns those keys into
// labelled chips, or the "Ready to activate" state when nothing is missing.

/** Statuses whose rows show the chips (hidden listings that still go through the readiness gate). */
const SETUP_STATUSES: readonly string[] = ["coming_soon", "import_review"];

/** Human label per `listing_readiness` key, in checklist order. */
const MISSING_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["name", "Missing name"],
  ["address", "Missing address"],
  ["phone", "Missing phone"],
  ["hours", "Missing hours"],
];

export interface SetupChip {
  key: string;
  label: string;
}

export interface SetupChipsView {
  /** True when nothing is missing (show "Ready to activate", no chips). */
  ready: boolean;
  /** Text shown when `ready`; `null` otherwise. */
  readyLabel: string | null;
  chips: SetupChip[];
}

export const READY_LABEL = "Ready to activate";

/** Whether this status shows missing-info chips at all. */
export function isSetupStatus(status: string): boolean {
  return SETUP_STATUSES.includes(status);
}

/**
 * The chips for one location row, or `null` when the row is not in a setup
 * status (an active / hidden / closed listing never advertises gaps). Known
 * keys come first in checklist order; an unknown key from a newer server still
 * gets a chip ("Missing: some key") so a gap is never silently dropped.
 */
export function setupChipsView(
  status: string,
  setupMissing: readonly string[] | null | undefined
): SetupChipsView | null {
  if (!isSetupStatus(status)) return null;
  const missing = setupMissing ?? [];
  const known = new Set(MISSING_LABELS.map(([key]) => key));
  const chips: SetupChip[] = MISSING_LABELS.filter(([key]) => missing.includes(key)).map(([key, label]) => ({
    key,
    label,
  }));
  for (const key of missing) {
    if (!known.has(key)) chips.push({ key, label: `Missing: ${key.replace(/_/g, " ")}` });
  }
  const ready = chips.length === 0;
  return { ready, readyLabel: ready ? READY_LABEL : null, chips };
}

/** One-line text equivalent ("Missing hours, Missing phone" / "Ready to activate") for screen readers. */
export function setupChipsSummary(view: SetupChipsView): string {
  return view.ready ? READY_LABEL : view.chips.map((chip) => chip.label).join(", ");
}
