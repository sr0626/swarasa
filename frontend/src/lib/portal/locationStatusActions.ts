// Which status actions the location-status chip menu offers, given the
// location's current status and the caller's role. Pure so the rules the old
// "Listing status" panel encoded inline are unit-testable.
//
// Rules carried over unchanged from the old panel
// (the removed components/portal/LocationStatusControl.tsx, docs/PROJECT_PLAN.csv
// "Location status lifecycle"):
//   - only owner/admin can change status at all (a manager gets a plain label);
//   - active / owner_deactivated / coming_soon are freely switchable while the
//     location is not closed_pending_reopen;
//   - "Mark permanently closed" is a one-way, confirmed trip into
//     closed_pending_reopen; from there no self-service change is possible;
//   - reopen requests are owner-only (the server action rejects anyone else,
//     so the menu no longer offers it to an admin, who would only get an error);
//   - permanent removal is offered for any non-active location, owner or admin
//     (backend guardrails 409 with the precise blocker if it isn't allowed).
import type { LocationStatus } from "@/types/location";

export const SELF_SERVICE_STATUSES: ReadonlyArray<{
  value: Exclude<LocationStatus, "closed_pending_reopen">;
  label: string;
}> = [
  { value: "active", label: "Active — visible to the public" },
  { value: "owner_deactivated", label: "Hidden — temporarily hide this listing" },
  { value: "coming_soon", label: "Coming soon — not open yet" },
];

export interface StatusMenuActions {
  /** Can the caller open a menu at all? False -> render a plain label. */
  interactive: boolean;
  /** The three freely reversible targets (current one is marked in the UI). */
  setStatus: boolean;
  markClosed: boolean;
  requestReopen: boolean;
  remove: boolean;
}

export function statusMenuActions(status: LocationStatus, role: string): StatusMenuActions {
  const canChange = role === "owner" || role === "admin";
  if (!canChange) {
    return { interactive: false, setStatus: false, markClosed: false, requestReopen: false, remove: false };
  }
  const closed = status === "closed_pending_reopen";
  return {
    interactive: true,
    setStatus: !closed,
    markClosed: !closed,
    requestReopen: closed && role === "owner",
    remove: status !== "active",
  };
}
