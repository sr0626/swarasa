// Admin listings management — auth-gated (admin only). Backed by the
// dedicated `GET /admin/listings` endpoint (docs/API_CONTRACTS.md "GET
// /admin/listings"), which replaces the old fan-out of the admin-scoped
// `GET /restaurants` plus one public `GET /restaurants/{id}/locations` call
// per brand. That fan-out had two defects this endpoint fixes: the
// per-brand call was UNAUTHENTICATED, so it returned ACTIVE locations
// only — filtering by "Coming soon" matched a brand through a location the
// page could then never show — and it carried no admin-only provenance
// (owner email, who created what). `GET /admin/listings` returns every
// location of a brand, any status, each flagged `matches_filter` against
// the active location-level filter, plus `owner_email` and
// `created_by_*` (audit_log-derived) on both the brand and each location.
//
// Moderation actions (delete a brand, deactivate a location) still run
// through the real Server Actions in `actions.ts` against
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
import { getAdminListings } from "@/lib/api/adminListings";
import AdminListingsPanel, {
  type AdminListingsFilters,
} from "@/components/admin/AdminListingsPanel";
import { parseListingStatusFilter } from "@/lib/adminListings";
import type { AdminListing, AdminListingSort } from "@/types/adminListings";

export const metadata: Metadata = {
  title: "Listings Management",
};

const PAGE_SIZE = 20;

interface AdminListingsPageProps {
  searchParams: {
    page?: string;
    owner_id?: string;
    brand_id?: string;
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

function parseSort(value: string | undefined): AdminListingSort {
  return value === "followers" || value === "oldest" ? value : "newest";
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

export default async function AdminListingsPage({ searchParams }: AdminListingsPageProps) {
  const session = await requireSession(["admin"]);

  const page = parsePositiveInt(searchParams.page) ?? 1;
  const ownerId = parsePositiveInt(searchParams.owner_id);
  const brandId = parsePositiveInt(searchParams.brand_id);
  const filters: AdminListingsFilters = {
    ownerId,
    brandId,
    ownerEmail: trimmedOrUndefined(searchParams.owner_email),
    name: trimmedOrUndefined(searchParams.name),
    status: parseListingStatusFilter(searchParams.status),
    isPaid: parseTriState(searchParams.is_paid),
    city: trimmedOrUndefined(searchParams.city),
    isClaimed: parseTriState(searchParams.is_claimed),
    sort: parseSort(searchParams.sort),
  };

  let brands: AdminListing[] = [];
  let total = 0;
  let loadError: string | null = null;
  try {
    const result = await getAdminListings(
      { page, page_size: PAGE_SIZE, ...filters },
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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section>
      <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
        Listings
      </h1>
      <p className="mt-2 text-sm text-brand-ink-muted">
        Every restaurant on the platform, across all owners. Filter to find one, then delete
        the listing (hides it and deactivates all its locations; restorable via Status: Deleted)
        or deactivate a single location. Filtering by status, tier or city highlights WHICH of a
        restaurant&rsquo;s locations matches.
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
          key={JSON.stringify({ ...filters, page })}
          initialBrands={brands}
          filters={filters}
          total={total}
          page={page}
          totalPages={totalPages}
        />
      )}
    </section>
  );
}
