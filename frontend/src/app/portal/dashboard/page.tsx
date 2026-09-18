// Owner + manager portal dashboard — auth-gated per frontend/CLAUDE.md's
// "Auth-gated portal pages" pattern. Lists the signed-in owner's brands and
// locations via the owner-scoped `GET /restaurants` (docs/API_CONTRACTS.md,
// landed 2026-09-13), each location linking into its editor
// (`/portal/locations/{id}`).
//
// Each location row also surfaces tier/billing status, active/inactive
// state, and assigned managers (docs/PROJECT_PLAN.csv "Owner dashboard:
// richer restaurant table" — added 2026-09-17). Tier and active/inactive
// come from `is_paid`/`paid_until`/`is_active` on `LocationSummary`
// (frontend/src/types/location.ts — see the flagged contract gap there:
// `paid_until` and `is_active` aren't serialized by the backend yet, so
// those two only render their "unknown"/default state today). Managers
// come from the existing `GET /locations/{id}/managers`, fetched per
// location alongside its brand's location list. This is read-only status
// display only — no Stripe billing management (upgrade/downgrade) UI,
// which is Phase 2 scope.
//
// FLAGGED CONTRACT GAP (see this PR's description): `GET /restaurants` is
// "Auth: owner or admin" only — there is no manager path at all, and no
// other endpoint lets a manager discover which locations they're assigned
// to (the closest thing, `GET /locations/{id}/managers`, needs a location
// id up front, which is exactly what's missing). So a manager session
// cannot be listed here today; this page shows them a clear explanation
// instead of silently rendering nothing, and they can still reach a
// location editor directly if they have the link (see
// `/portal/locations/[id]/page.tsx`, which enforces access itself). A real
// fix needs a new backend endpoint (e.g. `GET /locations?assigned_to_me=true`
// or a manager-scoped branch of `GET /restaurants`) — flagged for
// Architect/Backend Dev, not built here.
import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guards";
import TopBar from "@/components/home/TopBar";
import { ApiError } from "@/lib/api/client";
import { getMyRestaurants, getRestaurantLocations } from "@/lib/api/restaurants";
import { getLocationManagers } from "@/lib/api/locations";
import BrandCard from "@/components/portal/BrandCard";
import InfoPanel from "@/components/ui/InfoPanel";
import type { LocationSummary, LocationWithManagers } from "@/types/location";
import type { RestaurantBrand } from "@/types/restaurant";

export const metadata: Metadata = {
  title: "Owner Dashboard",
};

interface BrandWithLocations {
  brand: RestaurantBrand;
  locations: LocationWithManagers[];
  locationsError: string | null;
}

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

export default async function DashboardPage() {
  const session = await requireSession(["owner", "manager"]);

  if (session.role === "manager") {
    return (
      <main className="min-h-screen bg-brand-bg">
        <TopBar />
        <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
          <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
            Dashboard
          </h1>
          <p className="mt-2 text-sm text-brand-ink-muted">Signed in as manager.</p>

          <div className="mt-6">
            <InfoPanel
              title="No location list available for managers yet"
              body="There isn't a backend endpoint yet that lists which locations you're assigned to manage. Ask the owner who assigned you for a direct link to the location — you'll be able to open its editor at /portal/locations/{id} once you have the id."
            />
          </div>
        </section>
      </main>
    );
  }

  let brands: RestaurantBrand[] = [];
  let loadError: string | null = null;
  try {
    const page = await getMyRestaurants({ page: 1, page_size: 100 }, session.accessToken);
    brands = page.results;
  } catch (error) {
    loadError =
      error instanceof ApiError
        ? error.message
        : "Something went wrong loading your restaurants. Please try again.";
  }

  const brandsWithLocations = loadError
    ? []
    : await Promise.all(brands.map((brand) => loadLocationsForBrand(brand, session.accessToken)));

  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />
      <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">Dashboard</h1>
        <p className="mt-2 text-sm text-brand-ink-muted">
          Your restaurant brands and locations. Select a location to edit its details, hours,
          photos, and managers.
        </p>

        <div className="mt-6">
          {loadError && <InfoPanel title="Couldn't load your restaurants" body={loadError} />}

          {!loadError && brands.length === 0 && (
            <div className="flex flex-col items-center gap-4">
              <InfoPanel
                title="No restaurants found"
                body="You don't have any restaurant brands yet. Claim an existing unclaimed listing from its public page, or create a new brand, to get started."
              />
              <Link
                href="/portal/brands/new"
                className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover"
              >
                Add your restaurant
              </Link>
            </div>
          )}

          {!loadError && brandsWithLocations.length > 0 && (
            <div className="flex flex-col gap-5">
              {brandsWithLocations.map(({ brand, locations, locationsError }) => (
                <BrandCard
                  key={brand.id}
                  brand={brand}
                  locations={locations}
                  locationsError={locationsError}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
