// Turns `GET /auth/me/activity` events into the flat rows of the owner/manager
// activity TABLE (cards on a phone): one row per changed field, so every
// column (When / Restaurant & location / What changed / Previous / New /
// Updated by) stays a plain cell. An event with no field changes (a create,
// a delete, an unchanged save) becomes ONE row whose "What changed" is the
// server's `summary` ("Location added") with dashes for previous/new.
// Pure — unit tests in ownerFeedRows.test.ts.
//
// The date formatter is injected (callers pass `formatZonedDateTime` from
// lib/format/zonedDateTime.ts) so this module has no runtime alias imports and
// stays runnable under Node's test runner.
import type { OwnerActivity } from "@/types/activity";

export type FormatWhen = (iso: string, timeZone: string | null | undefined) => string;

export const EMPTY_CELL = "—";

export interface ActivityTableRow {
  /** Stable React key: `${event id}-${index within the event}`. */
  key: string;
  /** "Sep 24, 2026, 10:45 PM CDT" — in the location's timezone. */
  when: string;
  /** Brand name (or a dash when the entity no longer exists). */
  restaurant: string;
  /** Location label, `null` for a brand-level event. */
  location: string | null;
  what: string;
  previous: string;
  next: string;
  /** "You", an email, or a fallback like "a manager". */
  updatedBy: string;
  /** "Owner" | "Manager" | "Platform admin" (empty when the API omits it). */
  updatedByRole: string;
  /** Raw audit action ("create" | "update" | "delete") — drives the badge. */
  action: string;
}

/** "You" is shown with the role ("You · Owner"); an email/fallback keeps its role separate. */
export function describeActor(event: OwnerActivity): { name: string; role: string } {
  const role = event.actor_role_label ?? "";
  return { name: event.actor_label, role };
}

export function toActivityRows(
  events: readonly OwnerActivity[],
  formatWhen: FormatWhen
): ActivityTableRow[] {
  const rows: ActivityTableRow[] = [];
  for (const event of events) {
    const { name, role } = describeActor(event);
    const shared = {
      when: formatWhen(event.created_at, event.timezone),
      restaurant: event.restaurant_name?.trim() || EMPTY_CELL,
      location: event.location_name?.trim() || null,
      updatedBy: name,
      updatedByRole: role,
      action: event.action,
    };
    const changes = event.changes ?? [];
    if (changes.length === 0) {
      rows.push({
        key: `${event.id}-0`,
        ...shared,
        what: event.summary,
        previous: EMPTY_CELL,
        next: EMPTY_CELL,
      });
      continue;
    }
    changes.forEach((change, index) => {
      rows.push({
        key: `${event.id}-${index}`,
        ...shared,
        what: change.label,
        previous: change.old ?? EMPTY_CELL,
        next: change.new ?? EMPTY_CELL,
      });
    });
  }
  return rows;
}
