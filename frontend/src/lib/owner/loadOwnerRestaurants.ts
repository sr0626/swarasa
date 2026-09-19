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
import { getLocationManagers } from "@/lib/api/locations";
import { mapWithConcurrency } from "@/lib/concurrency";
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
): Promise<LocationWithManagers> {
  try {
    const result = await getLocationManagers(location.id, { activeOnly: true }, accessToken);
    return { location, managers: result.results, managersError: null };
  } catch (error) {
    return {
      location,
      managers: [],
      managersError:
        error instanceof ApiError
          ? error.message
          : "Could not load assigned managers for this location.",
    };
  }
}

/**
 * `GET /restaurants` only returns a `location_count` per brand, not the
 * location rows — this fetches each brand's locations via the existing
 * public `GET /restaurants/{id}/locations` so each one can link to its
 * editor. Brands with `location_count === 0` skip the extra call. Each
 * location's managers are then loaded alongside it (see
 * `loadManagersForLocation` above) so the card can show tier, active
 * status, and assigned managers together without a second page-level
 * round trip.
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
      page.results.map((location) => loadManagersForLocation(location, accessToken))
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
