"use client";

// Admin listings management UI. Owns the whole "find + moderate a
// listing" experience: the filter bar (GET form, URL-driven — see
// docs/API_CONTRACTS.md "GET /restaurants" filters), the active-filter
// chip row, the brand list (+ already SSR-loaded locations), pagination,
// and the real moderation actions (`deleteRestaurantAction`,
// `restoreRestaurantAction`, `deactivateLocationAction` in `actions.ts`)
// against `DELETE /restaurants/{id}` (a SOFT delete that also deactivates
// every location — guarded by an explicit warning confirmation below),
// `POST /restaurants/{id}/restore` and `DELETE /locations/{id}`.
//
// Filtering/pagination is server-driven, same pattern as `/search`: the
// filter form is a plain `<form method="get">` and pagination/active-filter
// links are plain hrefs — no client-side re-filtering of `initialBrands`,
// every filter change is a real navigation that re-runs
// `admin/listings/page.tsx`'s SSR fetch against the new query string.
//
// Locations are not lazily fetched here — the page Server Component
// already loaded each brand's locations (same N+1-but-bounded-by-page-size
// pattern as `portal/dashboard/page.tsx`), so expand/collapse below is
// pure client-side UI state, no extra network round trip.
import Link from "next/link";
import { useState } from "react";
import {
  deactivateLocationAction,
  deleteRestaurantAction,
  restoreRestaurantAction,
} from "@/app/admin/listings/actions";
import { deleteListingWarning, type ListingStatusFilter } from "@/lib/adminListings";
import OpenStatusBadge from "@/components/ui/OpenStatusBadge";
import { PencilIcon, PlusIcon, TrashIcon } from "@/components/ui/icons";
import type { LocationSummary } from "@/types/location";
import type { RestaurantBrand } from "@/types/restaurant";
import { ownerBrandPageLink, ownerLocationPageLink } from "@/lib/restaurant/urls";

export interface BrandWithLocations {
  brand: RestaurantBrand;
  locations: LocationSummary[];
  locationsError: string | null;
}

/** Parsed, URL-derived filter state — see `admin/listings/page.tsx`'s
 * `searchParams` parsing. `undefined` means "no filter" for every field
 * (never an empty string), so `Object.entries` + `!== undefined` is a
 * reliable "is this filter active" check throughout this file. */
export interface AdminListingsFilters {
  ownerEmail?: string;
  name?: string;
  status?: ListingStatusFilter;
  isPaid?: boolean;
  city?: string;
  isClaimed?: boolean;
  /** `GET /restaurants`'s `sort` param (docs/API_CONTRACTS.md "GET
   * /restaurants") -- not a filter (doesn't narrow the result set), but
   * lives alongside the filters here since it's driven by the same URL
   * query string / `<form method="get">`. Omitted keeps the default
   * (newest/id) order. Deliberately excluded from `activeFilterChips`
   * below -- it's a sort choice, not a "narrowed by" chip. */
  sort?: "followers";
}

const STATUS_OPTIONS: ReadonlyArray<{ value: ListingStatusFilter; label: string }> = [
  { value: "active", label: "Active" },
  { value: "owner_deactivated", label: "Hidden — owner deactivated" },
  { value: "coming_soon", label: "Coming soon" },
  { value: "closed_pending_reopen", label: "Closed — pending reopen" },
  { value: "deleted", label: "Deleted listings" },
];

const STATUS_LABELS: Record<ListingStatusFilter, string> = {
  active: "Active",
  owner_deactivated: "Hidden — owner deactivated",
  coming_soon: "Coming soon",
  closed_pending_reopen: "Closed — pending reopen",
  deleted: "Deleted listings",
};

/** Builds `/admin/listings?...` for the given filters + page, omitting
 * every unset filter and `page` when it's the default (1) — same
 * "no query string for the default state" convention as the old
 * `owner_id`-only `PageLink` this replaces. */
function buildListingsHref(filters: AdminListingsFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.ownerEmail) params.set("owner_email", filters.ownerEmail);
  if (filters.name) params.set("name", filters.name);
  if (filters.status) params.set("status", filters.status);
  if (filters.isPaid !== undefined) params.set("is_paid", String(filters.isPaid));
  if (filters.city) params.set("city", filters.city);
  if (filters.isClaimed !== undefined) params.set("is_claimed", String(filters.isClaimed));
  if (filters.sort) params.set("sort", filters.sort);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/admin/listings?${qs}` : "/admin/listings";
}

interface ActiveFilterChip {
  key: keyof AdminListingsFilters;
  label: string;
}

function activeFilterChips(filters: AdminListingsFilters): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];
  if (filters.ownerEmail) chips.push({ key: "ownerEmail", label: `Owner: ${filters.ownerEmail}` });
  if (filters.name) chips.push({ key: "name", label: `Name: ${filters.name}` });
  if (filters.status) chips.push({ key: "status", label: `Status: ${STATUS_LABELS[filters.status]}` });
  if (filters.isPaid !== undefined) {
    chips.push({ key: "isPaid", label: filters.isPaid ? "Paid" : "Free" });
  }
  if (filters.city) chips.push({ key: "city", label: `City: ${filters.city}` });
  if (filters.isClaimed !== undefined) {
    chips.push({ key: "isClaimed", label: filters.isClaimed ? "Claimed" : "Unclaimed" });
  }
  return chips;
}

export default function AdminListingsPanel({
  initialBrands,
  filters,
  total,
  page,
  totalPages,
}: {
  initialBrands: BrandWithLocations[];
  filters: AdminListingsFilters;
  total: number;
  page: number;
  totalPages: number;
}) {
  const [brands, setBrands] = useState<BrandWithLocations[]>(initialBrands);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const chips = activeFilterChips(filters);

  function toggleExpanded(brandId: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(brandId)) {
        next.delete(brandId);
      } else {
        next.add(brandId);
      }
      return next;
    });
  }

  function removeBrand(brandId: number) {
    setBrands((prev) => prev.filter((b) => b.brand.id !== brandId));
  }

  function removeLocation(brandId: number, locationId: number) {
    setBrands((prev) =>
      prev.map((entry) =>
        entry.brand.id === brandId
          ? {
              ...entry,
              locations: entry.locations.filter((loc) => loc.id !== locationId),
              brand: { ...entry.brand, location_count: Math.max(0, entry.brand.location_count - 1) },
            }
          : entry
      )
    );
  }

  return (
    <div>
      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-brand-card border border-brand-border bg-white p-4"
      >
        <div>
          <label htmlFor="owner_email" className="text-sm font-semibold text-brand-ink">
            Owner email
          </label>
          <input
            id="owner_email"
            name="owner_email"
            type="text"
            defaultValue={filters.ownerEmail ?? ""}
            placeholder="owner@example.com"
            className="mt-2 w-48 rounded-brand-control border border-brand-border bg-white px-3 py-2 text-sm text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="name" className="text-sm font-semibold text-brand-ink">
            Restaurant name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            defaultValue={filters.name ?? ""}
            placeholder="e.g. Spice Route"
            className="mt-2 w-48 rounded-brand-control border border-brand-border bg-white px-3 py-2 text-sm text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="city" className="text-sm font-semibold text-brand-ink">
            City
          </label>
          <input
            id="city"
            name="city"
            type="text"
            defaultValue={filters.city ?? ""}
            placeholder="e.g. Plano"
            className="mt-2 w-36 rounded-brand-control border border-brand-border bg-white px-3 py-2 text-sm text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="status" className="text-sm font-semibold text-brand-ink">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={filters.status ?? ""}
            className="mt-2 min-h-[40px] rounded-brand-control border border-brand-border bg-white px-3 text-sm text-brand-ink focus:border-brand-accent focus:outline-none"
          >
            <option value="">Any</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="is_paid" className="text-sm font-semibold text-brand-ink">
            Tier
          </label>
          <select
            id="is_paid"
            name="is_paid"
            defaultValue={filters.isPaid === undefined ? "" : String(filters.isPaid)}
            className="mt-2 min-h-[40px] rounded-brand-control border border-brand-border bg-white px-3 text-sm text-brand-ink focus:border-brand-accent focus:outline-none"
          >
            <option value="">Any</option>
            <option value="true">Paid</option>
            <option value="false">Free</option>
          </select>
        </div>
        <div>
          <label htmlFor="is_claimed" className="text-sm font-semibold text-brand-ink">
            Claimed
          </label>
          <select
            id="is_claimed"
            name="is_claimed"
            defaultValue={filters.isClaimed === undefined ? "" : String(filters.isClaimed)}
            className="mt-2 min-h-[40px] rounded-brand-control border border-brand-border bg-white px-3 text-sm text-brand-ink focus:border-brand-accent focus:outline-none"
          >
            <option value="">Any</option>
            <option value="true">Claimed</option>
            <option value="false">Unclaimed</option>
          </select>
        </div>
        <div>
          <label htmlFor="sort" className="text-sm font-semibold text-brand-ink">
            Sort
          </label>
          <select
            id="sort"
            name="sort"
            defaultValue={filters.sort ?? ""}
            className="mt-2 min-h-[40px] rounded-brand-control border border-brand-border bg-white px-3 text-sm text-brand-ink focus:border-brand-accent focus:outline-none"
          >
            <option value="">Newest</option>
            <option value="followers">Most followed</option>
          </select>
        </div>
        <button
          type="submit"
          className="flex min-h-[40px] items-center justify-center rounded-brand-control bg-brand-ink px-4 text-sm font-semibold text-brand-bg transition hover:bg-brand-ink/90"
        >
          Apply
        </button>
        {chips.length > 0 && (
          <Link
            href="/admin/listings"
            className="flex min-h-[40px] items-center justify-center rounded-brand-control border border-brand-border px-4 text-sm font-semibold text-brand-ink-muted transition hover:bg-brand-chip"
          >
            Clear all
          </Link>
        )}
      </form>

      {chips.length > 0 && (
        <div
          className="mt-3 flex flex-wrap items-center gap-1.5"
          aria-label="Active filters"
          role="group"
        >
          {chips.map((chip) => (
            <Link
              key={chip.key}
              href={buildListingsHref({ ...filters, [chip.key]: undefined }, 1)}
              aria-label={`Remove filter ${chip.label}`}
              className="flex min-h-[36px] items-center gap-1.5 rounded-brand-pill border border-brand-border bg-white px-3 text-xs font-medium text-brand-ink transition hover:bg-brand-chip"
            >
              {chip.label}
              <span aria-hidden="true" className="text-base leading-none text-brand-ink-subtle">
                &times;
              </span>
            </Link>
          ))}
        </div>
      )}

      <p className="mt-4 text-sm text-brand-ink-subtle">
        {total} restaurant{total === 1 ? "" : "s"} match{total === 1 ? "es" : ""} these filters.
      </p>

      <div className="mt-3">
        {brands.length === 0 ? (
          <p className="rounded-brand-card border border-dashed border-brand-border bg-white p-5 text-sm text-brand-ink-muted">
            No restaurants match these filters.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {brands.map((entry) => (
              <li key={entry.brand.id}>
                <BrandRow
                  entry={entry}
                  expanded={expanded.has(entry.brand.id)}
                  onToggleExpanded={() => toggleExpanded(entry.brand.id)}
                  onDeleted={() => removeBrand(entry.brand.id)}
                  onRestored={() => removeBrand(entry.brand.id)}
                  onLocationDeactivated={(locationId) => removeLocation(entry.brand.id, locationId)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {totalPages > 1 && (
        <nav
          aria-label="Listings pages"
          className="mt-8 flex items-center justify-center gap-3 text-sm"
        >
          <PageLink filters={filters} page={page - 1} disabled={page <= 1}>
            &larr; Previous
          </PageLink>
          <span className="text-brand-ink-subtle">
            Page {page} of {totalPages}
          </span>
          <PageLink filters={filters} page={page + 1} disabled={page >= totalPages}>
            Next &rarr;
          </PageLink>
        </nav>
      )}
    </div>
  );
}

function PageLink({
  filters,
  page,
  disabled,
  children,
}: {
  filters: AdminListingsFilters;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className="rounded-brand-control border border-brand-border px-3 py-2 text-brand-ink-subtle/40">
        {children}
      </span>
    );
  }
  return (
    <Link
      href={buildListingsHref(filters, page)}
      className="rounded-brand-control border border-brand-border px-3 py-2 text-brand-ink-muted transition hover:bg-brand-chip"
    >
      {children}
    </Link>
  );
}

function BrandRow({
  entry,
  expanded,
  onToggleExpanded,
  onDeleted,
  onRestored,
  onLocationDeactivated,
}: {
  entry: BrandWithLocations;
  expanded: boolean;
  onToggleExpanded: () => void;
  onDeleted: () => void;
  onRestored: () => void;
  onLocationDeactivated: (locationId: number) => void;
}) {
  const { brand, locations, locationsError } = entry;
  const isDeleted = Boolean(brand.deleted_at);
  // `brand.location_count` is the ACTIVE location count.
  const brandLink = ownerBrandPageLink(brand.slug, brand.location_count);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRestore() {
    setRestoring(true);
    setError(null);
    const result = await restoreRestaurantAction(brand.id);
    setRestoring(false);
    if (result.ok) {
      onRestored();
    } else {
      setError(result.error);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    const result = await deleteRestaurantAction(brand.id);
    setDeleting(false);
    if (result.ok) {
      onDeleted();
    } else {
      setError(result.error);
      setConfirming(false);
    }
  }

  return (
    <div className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-lg font-bold text-brand-ink">{brand.name}</h2>
            {isDeleted && (
              <span className="inline-flex items-center rounded-brand-pill bg-brand-closed-bg px-2.5 py-1 text-xs font-semibold text-brand-closed">
                Deleted
              </span>
            )}
            {brand.is_claimed ? (
              <span className="inline-flex items-center rounded-brand-pill bg-brand-success-bg px-2.5 py-1 text-xs font-semibold text-brand-success">
                Claimed
              </span>
            ) : (
              <span className="inline-flex items-center rounded-brand-pill bg-brand-chip px-2.5 py-1 text-xs font-semibold text-brand-chip-ink">
                Unclaimed
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-brand-ink-subtle">
            /{brand.slug} &middot; owner {brand.owner_id ?? "none"} &middot; {brand.location_count}{" "}
            location{brand.location_count === 1 ? "" : "s"}
            {/* Admin-only field (see restaurant_service._caller_may_view_follower_count,
                PR #174) — null only if the backend response somehow predates that PR.
                Now doubles as the visible number behind the sort=followers "Most
                followed" control below. */}
            {brand.follower_count !== null && brand.follower_count !== undefined && (
              <>
                {" "}
                &middot; {brand.follower_count} follower{brand.follower_count === 1 ? "" : "s"}
              </>
            )}
          </p>
          {brand.cuisine_tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {brand.cuisine_tags.map((tag) => (
                <span
                  key={tag.name}
                  className="inline-flex items-center rounded-brand-pill bg-brand-bg px-2 py-0.5 text-xs font-medium text-brand-ink-muted"
                >
                  {tag.display_name}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isDeleted ? (
            <button
              type="button"
              onClick={handleRestore}
              disabled={restoring}
              className="flex min-h-[40px] items-center justify-center rounded-brand-control bg-brand-ink px-3 text-xs font-semibold text-brand-bg transition hover:bg-brand-ink/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {restoring ? "Restoring..." : "Restore listing"}
            </button>
          ) : (
            <>
              <Link
                href={`/portal/locations/new?brand=${brand.id}`}
                aria-label={`Add a location to ${brand.name}`}
                className="flex min-h-[40px] items-center gap-1.5 rounded-brand-control border border-brand-border px-3 text-xs font-semibold text-brand-ink-muted transition hover:bg-brand-chip"
              >
                <PlusIcon className="h-3.5 w-3.5" />
                Add location
              </Link>
              {/* Only for 2+ active locations (the brand URL is then a landing
                  page); a single location has its own per-row link below. */}
              {brandLink && (
                <a
                  href={brandLink.href}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-[40px] items-center justify-center rounded-brand-control border border-brand-border px-3 text-xs font-semibold text-brand-ink-muted transition hover:bg-brand-chip"
                >
                  {brandLink.label}
                </a>
              )}
              {!confirming && (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="flex min-h-[40px] items-center gap-1.5 rounded-brand-control border border-brand-closed px-3 text-xs font-semibold text-brand-closed transition hover:bg-brand-closed-bg"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                  Delete listing
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {confirming && !isDeleted && (
        <div
          role="alertdialog"
          aria-labelledby={`delete-warning-title-${brand.id}`}
          aria-describedby={`delete-warning-body-${brand.id}`}
          className="mt-3 rounded-brand-control border border-brand-closed bg-brand-closed-bg p-4"
        >
          <p
            id={`delete-warning-title-${brand.id}`}
            className="text-sm font-semibold text-brand-closed"
          >
            Delete &ldquo;{brand.name}&rdquo;?
          </p>
          <p id={`delete-warning-body-${brand.id}`} className="mt-1 text-sm text-brand-ink">
            {deleteListingWarning(brand.location_count)}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="flex min-h-[40px] items-center gap-1.5 rounded-brand-control bg-brand-closed px-3 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <TrashIcon className="h-3.5 w-3.5" />
              {deleting ? "Deleting..." : "Confirm delete"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={deleting}
              className="flex min-h-[40px] items-center justify-center rounded-brand-control border border-brand-border bg-white px-3 text-xs font-semibold text-brand-ink transition hover:bg-brand-chip disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={onToggleExpanded}
        className="mt-3 text-sm font-semibold text-brand-accent underline-offset-2 hover:underline"
      >
        {expanded ? "Hide locations" : `Show locations (${locations.length})`}
      </button>

      {expanded && (
        <div className="mt-3 flex flex-col gap-2 border-t border-brand-border pt-3">
          {locationsError && (
            <p className="rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
              {locationsError}
            </p>
          )}
          {!locationsError && locations.length === 0 && (
            <p className="text-sm text-brand-ink-subtle">This brand has no active locations.</p>
          )}
          {locations.map((location) => (
            <LocationRow
              key={location.id}
              location={location}
              brandSlug={brand.slug}
              onDeactivated={() => onLocationDeactivated(location.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LocationRow({
  location,
  brandSlug,
  onDeactivated,
}: {
  location: LocationSummary;
  brandSlug: string;
  onDeactivated: () => void;
}) {
  const pageLink = ownerLocationPageLink(brandSlug, location);
  const [confirming, setConfirming] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDeactivate() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setDeactivating(true);
    setError(null);
    const result = await deactivateLocationAction(location.id);
    setDeactivating(false);
    if (result.ok) {
      onDeactivated();
    } else {
      setError(result.error);
      setConfirming(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-brand-control bg-brand-bg p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm">
        <p className="font-medium text-brand-ink">
          {location.location_name ?? location.address_line1}
        </p>
        <p className="text-brand-ink-subtle">
          {location.address_line1}, {location.city}, {location.state} {location.postal_code}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <OpenStatusBadge isOpenNow={location.is_open_now} />
          <span
            className={
              location.is_verified
                ? "inline-flex items-center rounded-brand-pill bg-brand-success-bg px-2 py-0.5 text-xs font-semibold text-brand-success"
                : "inline-flex items-center rounded-brand-pill bg-brand-chip px-2 py-0.5 text-xs font-semibold text-brand-chip-ink"
            }
          >
            {location.is_verified ? "Verified" : "Unverified"}
          </span>
          <span
            className={
              location.is_paid
                ? "inline-flex items-center rounded-brand-pill bg-brand-accent-gold/30 px-2 py-0.5 text-xs font-semibold text-brand-chip-ink"
                : "inline-flex items-center rounded-brand-pill bg-brand-bg px-2 py-0.5 text-xs font-semibold text-brand-ink-subtle"
            }
          >
            {location.is_paid ? "Paid" : "Free"}
          </span>
        </div>
        {error && <p className="mt-1 text-xs text-brand-closed">{error}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/portal/locations/${location.id}`}
          className="flex min-h-[36px] items-center gap-1.5 rounded-brand-control border border-brand-border px-3 text-xs font-semibold text-brand-ink transition hover:bg-brand-chip"
        >
          <PencilIcon className="h-3.5 w-3.5" />
          Edit
        </Link>
        <a
          href={pageLink.href}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-[36px] items-center justify-center rounded-brand-control border border-brand-border px-3 text-xs font-semibold text-brand-ink-muted transition hover:bg-brand-chip"
        >
          {pageLink.label}
        </a>
        <button
          type="button"
          onClick={handleDeactivate}
          disabled={deactivating}
          className={
            confirming
              ? "flex min-h-[36px] items-center justify-center rounded-brand-control bg-brand-closed px-3 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              : "flex min-h-[36px] items-center justify-center rounded-brand-control border border-brand-closed px-3 text-xs font-semibold text-brand-closed transition hover:bg-brand-closed-bg disabled:cursor-not-allowed disabled:opacity-60"
          }
        >
          {deactivating ? "Deactivating..." : confirming ? "Confirm deactivate" : "Deactivate"}
        </button>
        {confirming && (
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="text-xs font-medium text-brand-ink-subtle underline"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
