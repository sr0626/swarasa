// Admin listings management — auth-gated (admin only). Replaces the prior
// "Under construction" placeholder with a real page against real,
// already-documented endpoints: the admin-scoped `GET /restaurants`
// (docs/API_CONTRACTS.md "GET /restaurants" — admin caller sees every
// brand, with an optional `owner_id` filter) and the public
// `GET /restaurants/{id}/locations` for each brand's locations, loaded
// server-side the same way `portal/dashboard/page.tsx` loads an owner's
// own brands' locations. Moderation actions (delete a brand, deactivate a
// location) run through real Server Actions in `actions.ts` against
// `DELETE /restaurants/{id}` and `DELETE /locations/{id}` — no fabricated
// data, no invented backend endpoint.
import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guards";
import TopBar from "@/components/home/TopBar";
import { ApiError } from "@/lib/api/client";
import { mapWithConcurrency } from "@/lib/concurrency";
import { getMyRestaurants, getRestaurantLocations } from "@/lib/api/restaurants";
import AdminListingsPanel, {
  type BrandWithLocations,
} from "@/components/admin/AdminListingsPanel";
import type { RestaurantBrand } from "@/types/restaurant";

export const metadata: Metadata = {
  title: "Listings Management",
};

const PAGE_SIZE = 20;

// See portal/dashboard/page.tsx's DASHBOARD_FETCH_CONCURRENCY — same DB
// connection-pool storm fix (PR #101), same reasoning.
const LISTINGS_FETCH_CONCURRENCY = 5;

interface AdminListingsPageProps {
  searchParams: { page?: string; owner_id?: string };
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
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

  let brands: RestaurantBrand[] = [];
  let total = 0;
  let loadError: string | null = null;
  try {
    const result = await getMyRestaurants(
      { page, page_size: PAGE_SIZE, ownerId },
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
    <main className="min-h-screen bg-brand-bg">
      <TopBar />
      <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
          Listings
        </h1>
        <p className="mt-2 text-sm text-brand-ink-muted">
          Every restaurant on the platform, across all owners. Delete a listing entirely
          or deactivate one of its locations.
        </p>

        <form
          method="get"
          className="mt-6 flex flex-wrap items-end gap-2 rounded-brand-card border border-brand-border bg-white p-4"
        >
          <div>
            <label htmlFor="owner_id" className="text-sm font-semibold text-brand-ink">
              Filter by owner ID
            </label>
            <input
              id="owner_id"
              name="owner_id"
              type="number"
              min={1}
              defaultValue={searchParams.owner_id ?? ""}
              placeholder="e.g. 55"
              className="mt-2 w-40 rounded-brand-control border border-brand-border bg-white px-3 py-2 text-sm text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="flex min-h-[40px] items-center justify-center rounded-brand-control bg-brand-ink px-4 text-sm font-semibold text-brand-bg transition hover:bg-brand-ink/90"
          >
            Apply
          </button>
          {ownerId && (
            <Link
              href="/admin/listings"
              className="flex min-h-[40px] items-center justify-center rounded-brand-control border border-brand-border px-4 text-sm font-semibold text-brand-ink-muted transition hover:bg-brand-chip"
            >
              Clear
            </Link>
          )}
        </form>

        <div className="mt-6">
          {loadError ? (
            <p className="rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
              {loadError}
            </p>
          ) : (
            <AdminListingsPanel initialBrands={brandsWithLocations} />
          )}
        </div>

        {!loadError && totalPages > 1 && (
          <nav
            aria-label="Listings pages"
            className="mt-8 flex items-center justify-center gap-3 text-sm"
          >
            <PageLink page={page - 1} ownerId={ownerId} disabled={page <= 1}>
              &larr; Previous
            </PageLink>
            <span className="text-brand-ink-subtle">
              Page {page} of {totalPages}
            </span>
            <PageLink page={page + 1} ownerId={ownerId} disabled={page >= totalPages}>
              Next &rarr;
            </PageLink>
          </nav>
        )}
      </section>
    </main>
  );
}

function PageLink({
  page,
  ownerId,
  disabled,
  children,
}: {
  page: number;
  ownerId: number | undefined;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  if (ownerId) params.set("owner_id", String(ownerId));
  const qs = params.toString();
  const href = qs ? `/admin/listings?${qs}` : "/admin/listings";

  if (disabled) {
    return (
      <span className="rounded-brand-control border border-brand-border px-3 py-2 text-brand-ink-subtle/40">
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="rounded-brand-control border border-brand-border px-3 py-2 text-brand-ink-muted transition hover:bg-brand-chip"
    >
      {children}
    </Link>
  );
}
