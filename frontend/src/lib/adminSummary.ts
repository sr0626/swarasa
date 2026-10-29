// Pure label/formatting logic for the admin SUMMARY strip shown above the
// Users / Owners / Managers / Registered users / Listings tables. Kept out of
// the React component so it can be unit tested (`npm run test:unit`, node
// --test; relative imports only). The counts always cover the whole dataset,
// not the current search/filter/page -- see docs/API_CONTRACTS.md
// "Admin list summaries".
import type {
  AdminListingsSummary,
  AdminManagersSummary,
  AdminOwnersSummary,
  AdminRegisteredUsersSummary,
  AdminUsersSummary,
} from "../types/adminSummary.ts";

/** neutral = plain figure; inactive = muted "inactive"; warning = needs a look. */
export type SummaryTone = "neutral" | "inactive" | "warning";

export interface SummaryChip {
  label: string;
  /** Pre-formatted text shown as the figure (e.g. "1,204" or "1,204+"). */
  value: string;
  tone: SummaryTone;
}

/** Mirror of the backend per-group Cognito cap (cognito_service.MAX_USERS_PER_GROUP). */
export const COGNITO_GROUP_CAP = 3000;

/** Thousands separators, fixed locale so server and client render identically. */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Math.max(0, Math.trunc(value)).toLocaleString("en-US");
}

function chip(label: string, value: number, tone: SummaryTone = "neutral"): SummaryChip {
  return { label, value: formatCount(value), tone };
}

/** Zero warning counts stay neutral so only real work items draw the eye. */
function warnIfAny(label: string, value: number): SummaryChip {
  return chip(label, value, value > 0 ? "warning" : "neutral");
}

function totalChip(total: number, truncated: boolean): SummaryChip {
  const c = chip("Total", total);
  if (truncated) c.value = `${c.value}+`;
  return c;
}

export function usersSummaryChips(summary: AdminUsersSummary): SummaryChip[] {
  const { by_role: roles } = summary;
  return [
    totalChip(summary.total, summary.truncated),
    chip("Active", summary.active),
    chip("Inactive (disabled)", summary.inactive, "inactive"),
    warnIfAny("Unconfirmed", summary.unconfirmed),
    chip("Seen in last 30 days", summary.seen_last_30_days),
    chip("Admins", roles.admin),
    chip("Owners", roles.owner),
    chip("Managers", roles.manager),
    chip("Diners", roles.registered_user),
  ];
}

export function registeredUsersSummaryChips(summary: AdminRegisteredUsersSummary): SummaryChip[] {
  return [
    totalChip(summary.total, summary.truncated),
    chip("Active", summary.active),
    chip("Inactive (disabled)", summary.inactive, "inactive"),
    warnIfAny("Unconfirmed", summary.unconfirmed),
    chip("Seen in last 30 days", summary.seen_last_30_days),
  ];
}

export function ownersSummaryChips(summary: AdminOwnersSummary): SummaryChip[] {
  return [
    chip("Total", summary.total),
    chip("Active", summary.active),
    chip("Inactive", summary.inactive, "inactive"),
    chip("No restaurants yet", summary.without_locations, "inactive"),
  ];
}

export function managersSummaryChips(summary: AdminManagersSummary): SummaryChip[] {
  return [
    chip("Total", summary.total),
    chip("Active", summary.active),
    chip("Inactive (all revoked)", summary.inactive, "inactive"),
    chip("Seen in last 30 days", summary.seen_last_30_days),
  ];
}

export function listingsSummaryChips(summary: AdminListingsSummary): SummaryChip[] {
  return [
    chip("Restaurants", summary.brands),
    warnIfAny("Unclaimed", summary.unclaimed_brands),
    chip("Locations", summary.locations),
    chip("Active", summary.active),
    chip("Coming soon", summary.coming_soon),
    chip("Hidden", summary.owner_deactivated, "inactive"),
    chip("Closed, pending reopen", summary.closed_pending_reopen, "inactive"),
  ];
}

/** "Inactive (disabled)" -> "inactive": drop the parenthetical, lowercase. */
function hintLabel(label: string): string {
  return label
    .replace(/\s*\([^)]*\)/g, "")
    .trim()
    .toLowerCase();
}

const HINT_LEADING_CHIPS = 3;
const HINT_MAX_CHIPS = 4;

/**
 * One-line headline for the collapsed Summary header, built from the same
 * chips as the full strip: the first few figures (total / active / inactive,
 * or restaurants / unclaimed / locations), plus a warning figure that is
 * non-zero (e.g. "5 unconfirmed") so collapsing never hides a work item.
 * Returns "" for an empty chip list.
 */
export function summaryHint(chips: SummaryChip[]): string {
  const picked = chips.slice(0, HINT_LEADING_CHIPS);
  for (const extra of chips.slice(HINT_LEADING_CHIPS)) {
    if (picked.length >= HINT_MAX_CHIPS) break;
    if (extra.tone === "warning") picked.push(extra);
  }
  return picked.map((c) => `${c.value} ${hintLabel(c.label)}`).join(" · ");
}

/** Note shown under the strip when a Cognito group hit the cap, else null. */
export function truncatedNote(truncated: boolean): string | null {
  return truncated
    ? `${formatCount(COGNITO_GROUP_CAP)}+ (capped): at least one role group is larger than the directory limit, so these counts are a lower bound.`
    : null;
}
