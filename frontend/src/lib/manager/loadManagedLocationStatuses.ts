// Console-tile "Opens at ..." / "Closed today" status for the manager's
// "Locations I manage" panel (components/account/ManagedLocationsPanel.tsx)
// — the manager-console counterpart of
// lib/owner/loadOwnerRestaurants.ts's `loadTodayStatusForLocation`. Kept as
// its own small module rather than inlined in app/account/page.tsx so the
// bounded-concurrency + fallback logic isn't duplicated by hand if a future
// manager-specific page needs the same thing.
//
// `GET /auth/me/managed-locations` (`ManagedLocation`) only serializes
// `is_open_now`, same "Summary shape only" gap as `LocationSummary` (see
// docs/API_CONTRACTS.md) — so this fetches each location's full hours via
// the existing public `GET /locations/{id}` when it isn't already known to
// be open right now. See lib/owner/loadOwnerRestaurants.ts's
// `loadTodayStatusForLocation` for the full rationale/flagged contract gap;
// not repeated here to avoid drift between two copies of the same comment.
import { getLocationById } from "@/lib/api/locations";
import { mapWithConcurrency } from "@/lib/concurrency";
import { describeConsoleTodayStatus, type ConsoleTodayStatus } from "@/lib/consoleLocationStatus";
import type { ManagedLocation } from "@/types/location";

// Same rationale/value as loadOwnerRestaurants.ts's
// DASHBOARD_FETCH_CONCURRENCY — a manager's assigned-location count is the
// same realistic order of magnitude as an owner's, bounded here rather than
// firing every location's detail fetch at once.
const MANAGED_LOCATIONS_FETCH_CONCURRENCY = 5;

async function loadTodayStatusForManagedLocation(
  location: ManagedLocation
): Promise<ConsoleTodayStatus> {
  if (location.is_open_now === true) return { kind: "open_now" };
  try {
    const detail = await getLocationById(location.id);
    return describeConsoleTodayStatus(location.is_open_now, detail.hours, detail.timezone);
  } catch {
    return { kind: "unknown" };
  }
}

export interface ManagedLocationWithStatus {
  location: ManagedLocation;
  todayStatus: ConsoleTodayStatus;
}

/** Never throws — a per-location status fetch failure just falls back to
 * `{ kind: "unknown" }` for that one row (LocationStatusChip renders
 * nothing), same as the owner console's equivalent loader. */
export async function loadManagedLocationStatuses(
  locations: readonly ManagedLocation[]
): Promise<ManagedLocationWithStatus[]> {
  return mapWithConcurrency(locations, MANAGED_LOCATIONS_FETCH_CONCURRENCY, async (location) => ({
    location,
    todayStatus: await loadTodayStatusForManagedLocation(location),
  }));
}
