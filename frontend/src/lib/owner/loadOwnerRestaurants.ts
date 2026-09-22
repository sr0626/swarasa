// Server-side loader for the owner's restaurants (brands -> locations ->
// managers), used by the single owner business page (app/account/page.tsx,
// owner branch). Moved out of app/portal/dashboard/page.tsx when the separate
// owner dashboard was folded into /account (2026-09-19).
//
// Each location row surfaces tier/billing status, active/inactive state, and
// assigned managers (docs/PROJECT_PLAN.csv "Owner dashboard: richer restaurant
// table"). Tier and active/inactive come from `is_paid`/`paid_until`/
// `is_active` on `LocationSummary` (frontend/src/types/location.ts -- see the
// flagged contract gap there: `paid_until` and `is_active` aren't serialized
// by the backend yet, so those two only render their "unknown"/default state
// today). Managers come from the existing `GET /locations/{id}/managers`.
// Read-only status display only -- no Stripe billing management UI (Phase 2).
import { ApiError } from "@/lib/api/client";
import { getMyRestaurants, getRestaurantLocations } from "@/lib/api/restaurants";
import { getLocationById, getLocationManagers } from "@/lib/api/locations";
import { mapWithConcurrency } from "@/lib/concurrency";
import { describeConsoleTodayStatus, type ConsoleTodayStatus } from "@/lib/consoleLocationStatus";
import type { LocationSummary, LocationWithManagers } from "@/types/location";
import type { RestaurantBrand } from "@/types/restaurant";

/** A brand plus its (already fetched) locations + managers, or why they couldn't load. */
export interface BrandWithLocations {
  brand: RestaurantBrand;
  locations: LocationWithManagers[];
  locationsError: string | null;
}

export interface OwnerRestaurants {
  brands: BrandWithLocations[];
  /** Set when the brand list itself couldn't be loaded. */
  loadError: string | null;
}

// Caps how many brands' locations are fetched in parallel — see
// lib/concurrency.ts's header comment for why (DB connection-pool storm,
// PR #101). 5 keeps a realistic production owner (3-4, up to ~10
// restaurants per direct user confirmation) essentially fully parallel
// while bounding the worst case for an outlier account.
const DASHBOARD_FETCH_CONCURRENCY = 5;

/**
 * Fetches a single location's actively-assigned managers via the existing
 * `GET /locations/{id}/managers` endpoint (already Done — see
 * docs/API_CONTRACTS.md "Location Managers"). Same bounded-per-page N+1
 * pattern as `loadLocationsForBrand` below: one call per location already
 * on this page (page_size 100 max), not a new unbounded fan-out. Failures
 * are scoped to the single location, not the whole brand/page.
 */
async function loadManagersForLocation(
  location: LocationSummary,
  accessToken: string
): Promise<{ managers: LocationWithManagers["managers"]; managersError: string | null }> {
  try {
    const result = await getLocationManagers(location.id, { activeOnly: true }, accessToken);
    return { managers: result.results, managersError: null };
  } catch (error) {
    return {
      managers: [],
      managersError:
        error instanceof ApiError
          ? error.message
          : "Could not load assigned managers for this location.",
    };
  }
}

/**
 * Console-tile "Opens at ..." / "Closed today" status (see
 * `lib/consoleLocationStatus.ts`). `GET /restaurants/{id}/locations` only
 * serializes `is_open_now` — no today's open/close breakdown ("Summary
 * shape only", docs/API_CONTRACTS.md) — so when the location isn't already
 * known to be open right now, this fetches the location's full hours via
 * the existing public `GET /locations/{id}` to tell "hasn't opened yet
 * today" apart from "closed all day." Skipped entirely when `is_open_now`
 * is already `true`, since the answer is `open_now` either way — this
 * keeps the added per-location call to only the locations that actually
 * need it (closed-now locations), not every location on the page.
 *
 * FLAGGED CONTRACT GAP (this fix's report): this is an extra full
 * `LocationDetail` fetch (about/specialties/photos and all) just to read
 * `hours`/`timezone` — there's no lighter "just today's hours" endpoint.
 * The cleaner fix would be Backend adding `is_closed`/`open_time`/
 * `close_time` for today directly to `LocationSummaryOut`, mirroring what
 * `hours_service.today_status_for_location` already computes for
 * `NearestLocationOut` on `/search` — out of scope here (frontend-only
 * task), left for a follow-up.
 */
async function loadTodayStatusForLocation(location: LocationSummary): Promise<ConsoleTodayStatus> {
  if (location.is_open_now === true) return { kind: "open_now" };
  try {
    const detail = await getLocationById(location.id);
    return describeConsoleTodayStatus(location.is_open_now, detail.hours, detail.timezone);
  } catch {
    // Best-effort — the tile still renders correctly via the other bucket
    // (LocationStatusChip renders nothing for "unknown") rather than
    // failing the whole location row over a decorative status label.
    return { kind: "unknown" };
  }
}

async function loadLocationExtras(
  location: LocationSummary,
  accessToken: string
): Promise<LocationWithManagers> {
  const [{ managers, managersError }, todayStatus] = await Promise.all([
    loadManagersForLocation(location, accessToken),
    loadTodayStatusForLocation(location),
  ]);
  return { location, managers, managersError, todayStatus };
}

/**
 * `GET /restaurants` only returns a `location_count` per brand, not the
 * location rows — this fetches each brand's locations via the existing
 * public `GET /restaurants/{id}/locations` so each one can link to its
 * editor. Brands with `location_count === 0` skip the extra call. Each
 * location's managers and console status are then loaded alongside it (see
 * `loadLocationExtras` above) so the card can show tier, active status,
 * assigned managers, and today's hours status together without extra
 * page-level round trips.
 */
async function loadLocationsForBrand(
  brand: RestaurantBrand,
  accessToken: string
): Promise<BrandWithLocations> {
  if (brand.location_count === 0) {
    return { brand, locations: [], locationsError: null };
  }
  try {
    const page = await getRestaurantLocations(brand.id, { page: 1, page_size: 100 });
    const locations = await Promise.all(
      page.results.map((location) => loadLocationExtras(location, accessToken))
    );
    return { brand, locations, locationsError: null };
  } catch (error) {
    return {
      brand,
      locations: [],
      locationsError:
        error instanceof ApiError
          ? error.message
          : "Could not load this brand's locations. Please try again.",
    };
  }
}

/** Loads every brand the owner has, with locations and managers. Never throws. */
export async function loadOwnerRestaurants(accessToken: string): Promise<OwnerRestaurants> {
  let brands: RestaurantBrand[] = [];
  try {
    const page = await getMyRestaurants({ page: 1, page_size: 100 }, accessToken);
    brands = page.results;
  } catch (error) {
    return {
      brands: [],
      loadError:
        error instanceof ApiError
          ? error.message
          : "Something went wrong loading your restaurants. Please try again.",
    };
  }
  const withLocations = await mapWithConcurrency(brands, DASHBOARD_FETCH_CONCURRENCY, (brand) =>
    loadLocationsForBrand(brand, accessToken)
  );
  return { brands: withLocations, loadError: null };
}
