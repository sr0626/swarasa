// Admin listings management — auth-gated (admin only). Replaces the prior
// "Under construction" placeholder with a real page against real,
// already-documented endpoints: the admin-scoped `GET /restaurants`
// (docs/API_CONTRACTS.md "GET /restaurants" — admin caller sees every
// brand, with owner/name/status/tier/city/claimed filters) and the public
// `GET /restaurants/{id}/locations` for each brand's locations, loaded
// server-side the same way `portal/dashboard/page.tsx` loads an owner's
// own brands' locations. Moderation actions (delete a brand, deactivate a
// location) run through real Server Actions in `actions.ts` against
// `DELETE /restaurants/{id}` and `DELETE /locations/{id}` — no fabricated
// data, no invented backend endpoint.
//
// Filtering is server-driven, same pattern as `/search`: every filter
// lives in the URL query string, this page reads it with `searchParams`
// and re-queries the backend — never a client-side filter of an
// already-fetched page of rows. The filter bar, active-filter chips, and
// pagination controls themselves live in `AdminListingsPanel.tsx` (this
// page stays a thin data-fetching shell); see that file for the actual
// `<form method="get">` / query-string-building code.
import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/guards";
import { ApiError } from "@/lib/api/client";
import { mapWithConcurrency } from "@/lib/concurrency";
import { getMyRestaurants, getRestaurantLocations } from "@/lib/api/restaurants";
import AdminListingsPanel, {
  type AdminListingsFilters,
  type BrandWithLocations,
} from "@/components/admin/AdminListingsPanel";
import type { LocationStatus } from "@/types/location";
import type { RestaurantBrand } from "@/types/restaurant";

export const metadata: Metadata = {
  title: "Listings Management",
};

const PAGE_SIZE = 20;

// See portal/dashboard/page.tsx's DASHBOARD_FETCH_CONCURRENCY — same DB
// connection-pool storm fix (PR #101), same reasoning.
const LISTINGS_FETCH_CONCURRENCY = 5;

const LOCATION_STATUSES: readonly LocationStatus[] = [
  "active",
  "owner_deactivated",
  "coming_soon",
  "closed_pending_reopen",
];

interface AdminListingsPageProps {
  searchParams: {
    page?: string;
    owner_id?: string;
    owner_email?: string;
    name?: string;
    status?: string;
    is_paid?: string;
    city?: string;
    is_claimed?: string;
    sort?: string;
  };
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseStatus(value: string | undefined): LocationStatus | undefined {
  return LOCATION_STATUSES.find((s) => s === value);
}

function parseSort(value: string | undefined): "followers" | undefined {
  return value === "followers" ? "followers" : undefined;
}

/** "true"/"false" only — anything else (missing, malformed) is "no filter",
 * same permissive-omission handling as the other optional filters here. */
function parseTriState(value: string | undefined): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function trimmedOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Same N+1-but-bounded-by-page-size pattern as
 * `portal/dashboard/page.tsx`'s `loadLocationsForBrand` — `GET
 * /restaurants` only returns a `location_count` per brand, not the rows,
 * so each brand's locations come from the public
 * `GET /restaurants/{id}/locations` call. Brands with no locations skip
 * the extra request. */
async function loadLocationsForBrand(brand: RestaurantBrand): Promise<BrandWithLocations> {
  if (brand.location_count === 0) {
    return { brand, locations: [], locationsError: null };
  }
  try {
    const page = await getRestaurantLocations(brand.id, { page: 1, page_size: 100 });
    return { brand, locations: page.results, locationsError: null };
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

export default async function AdminListingsPage({ searchParams }: AdminListingsPageProps) {
  const session = await requireSession(["admin"]);

  const page = parsePositiveInt(searchParams.page) ?? 1;
  const ownerId = parsePositiveInt(searchParams.owner_id);
  const filters: AdminListingsFilters = {
    ownerEmail: trimmedOrUndefined(searchParams.owner_email),
    name: trimmedOrUndefined(searchParams.name),
    status: parseStatus(searchParams.status),
    isPaid: parseTriState(searchParams.is_paid),
    city: trimmedOrUndefined(searchParams.city),
    isClaimed: parseTriState(searchParams.is_claimed),
    sort: parseSort(searchParams.sort),
  };

  let brands: RestaurantBrand[] = [];
  let total = 0;
  let loadError: string | null = null;
  try {
    const result = await getMyRestaurants(
      { page, page_size: PAGE_SIZE, ownerId, ...filters },
      session.accessToken
    );
    brands = result.results;
    total = result.total;
  } catch (error) {
    loadError =
      error instanceof ApiError
        ? error.message
        : "Something went wrong loading restaurants. Please try again.";
  }

  const brandsWithLocations: BrandWithLocations[] = loadError
    ? []
    : await mapWithConcurrency(brands, LISTINGS_FETCH_CONCURRENCY, loadLocationsForBrand);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section>
      <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
        Listings
      </h1>
      <p className="mt-2 text-sm text-brand-ink-muted">
        Every restaurant on the platform, across all owners. Filter to find one, then delete a
        listing entirely or deactivate one of its locations.
      </p>

      {loadError ? (
        <p className="mt-6 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
          {loadError}
        </p>
      ) : (
        // Keyed on every filter + page so a filter/page change remounts
        // with fresh data rather than reusing the previous view's local
        // `useState(initialBrands)` — same pattern as
        // admin/claims/page.tsx's `ClaimReviewPanel key={`${tab}-${page}`}`.
        <AdminListingsPanel
          key={JSON.stringify({ ...filters, ownerId, page })}
          initialBrands={brandsWithLocations}
          filters={filters}
          total={total}
          page={page}
          totalPages={totalPages}
        />
      )}
    </section>
  );
}
