"use client";

// Admin listings management UI. Owns the whole "find + moderate a
// listing" experience: the filter bar (GET form, URL-driven — see
// docs/API_CONTRACTS.md "GET /admin/listings" filters), the active-filter
// chip row, the brand list with EVERY location of each brand, pagination,
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
// Location-level detail: `GET /admin/listings` returns each brand's locations
// in every status, each flagged `matches_filter`. While a location filter
// (status / tier / city) is active, every brand starts expanded and the
// matching location(s) are highlighted with a "Matches filter" tag — so
// "Status: Coming soon" shows WHICH location is coming soon, not just a brand.
//
// Provenance (admin-only, from the same endpoint): each brand shows its
// owner ("Owner: <email>" / "Unclaimed") and each brand AND location shows
// "Created <date> by <who> (<role>)".
import Link from "next/link";
import { useState } from "react";
import {
  deactivateLocationAction,
  deleteRestaurantAction,
  restoreRestaurantAction,
} from "@/app/admin/listings/actions";
import {
  LOCATION_STATUS_LABELS,
  addressLine,
  creatorText,
  deleteListingWarning,
  hasLocationFilter,
  matchSummary,
  ownerLine,
  type ListingStatusFilter,
} from "@/lib/adminListings";
import LocalDateTime from "@/components/ui/LocalDateTime";
import { PencilIcon, PlusIcon, TrashIcon } from "@/components/ui/icons";
import type {
  AdminListing,
  AdminListingLocation,
  AdminListingSort,
  ListingCreator,
} from "@/types/adminListings";
import { ownerBrandPageLink, ownerLocationPageLink } from "@/lib/restaurant/urls";

/** Parsed, URL-derived filter state — see `admin/listings/page.tsx`'s
 * `searchParams` parsing. `undefined` means "no filter" for every field
 * (never an empty string), so `Object.entries` + `!== undefined` is a
 * reliable "is this filter active" check throughout this file. */
export interface AdminListingsFilters {
  /** From the Owners report link (`?owner_id=`). */
  ownerId?: number;
  /** From the Managers report links (`?brand_id=`): exactly one restaurant. */
  brandId?: number;
  ownerEmail?: string;
  name?: string;
  status?: ListingStatusFilter;
  isPaid?: boolean;
  city?: string;
  isClaimed?: boolean;
  /** Not a filter (doesn't narrow the result set), but lives alongside the
   * filters since it's driven by the same URL query string / form. Omitted
   * = `newest`, the default. Deliberately excluded from `activeFilterChips`. */
  sort?: AdminListingSort;
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

const INPUT_CLASS =
  "mt-2 min-h-[44px] w-full rounded-brand-control border border-brand-border bg-white px-3 text-sm text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none";

/** Builds `/admin/listings?...` for the given filters + page, omitting
 * every unset filter, the default sort, and `page` when it's the default
 * (1) — "no query string for the default state". */
function buildListingsHref(filters: AdminListingsFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.ownerId) params.set("owner_id", String(filters.ownerId));
  if (filters.brandId) params.set("brand_id", String(filters.brandId));
  if (filters.ownerEmail) params.set("owner_email", filters.ownerEmail);
  if (filters.name) params.set("name", filters.name);
  if (filters.status) params.set("status", filters.status);
  if (filters.isPaid !== undefined) params.set("is_paid", String(filters.isPaid));
  if (filters.city) params.set("city", filters.city);
  if (filters.isClaimed !== undefined) params.set("is_claimed", String(filters.isClaimed));
  if (filters.sort && filters.sort !== "newest") params.set("sort", filters.sort);
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
  if (filters.ownerId) chips.push({ key: "ownerId", label: `Owner #${filters.ownerId}` });
  if (filters.brandId) chips.push({ key: "brandId", label: `Restaurant #${filters.brandId}` });
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
  initialBrands: AdminListing[];
  filters: AdminListingsFilters;
  total: number;
  page: number;
  totalPages: number;
}) {
  const [brands, setBrands] = useState<AdminListing[]>(initialBrands);
  // With a location-level filter (or a single-restaurant link) every brand
  // starts open, so the matching location is visible without another click.
  const [expanded, setExpanded] = useState<Set<number>>(
    () =>
      new Set(
        hasLocationFilter(filters) || filters.brandId ? initialBrands.map((brand) => brand.id) : []
      )
  );
  const chips = activeFilterChips(filters);
  const locationFilterActive = hasLocationFilter(filters);

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
    setBrands((prev) => prev.filter((b) => b.id !== brandId));
  }

  // A deactivated location stays in the list (an admin still needs to see it)
  // but flips to `owner_deactivated`; the brand's ACTIVE count drops with it.
  function markLocationDeactivated(brandId: number, locationId: number) {
    setBrands((prev) =>
      prev.map((entry) => {
        if (entry.id !== brandId) return entry;
        const wasActive = entry.locations.some(
          (loc) => loc.id === locationId && loc.status === "active"
        );
        return {
          ...entry,
          location_count: wasActive ? Math.max(0, entry.location_count - 1) : entry.location_count,
          locations: entry.locations.map((loc) =>
            loc.id === locationId ? { ...loc, status: "owner_deactivated" as const } : loc
          ),
        };
      })
    );
  }

  return (
    <div>
      <form
        method="get"
        className="grid grid-cols-1 gap-3 rounded-brand-card border border-brand-border bg-white p-4 sm:flex sm:flex-wrap sm:items-end"
      >
        {/* Carried through the form so Apply doesn't drop a link-supplied scope. */}
        {filters.ownerId ? <input type="hidden" name="owner_id" value={filters.ownerId} /> : null}
        {filters.brandId ? <input type="hidden" name="brand_id" value={filters.brandId} /> : null}
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
            className={`${INPUT_CLASS} sm:w-48`}
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
            className={`${INPUT_CLASS} sm:w-48`}
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
            className={`${INPUT_CLASS} sm:w-36`}
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
            className={`${INPUT_CLASS} sm:w-auto`}
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
            className={`${INPUT_CLASS} sm:w-auto`}
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
            className={`${INPUT_CLASS} sm:w-auto`}
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
            defaultValue={filters.sort ?? "newest"}
            className={`${INPUT_CLASS} sm:w-auto`}
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="followers">Most followed</option>
          </select>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="flex min-h-[44px] flex-1 items-center justify-center rounded-brand-control bg-brand-ink px-5 text-sm font-semibold text-brand-bg transition hover:bg-brand-ink/90 sm:flex-none"
          >
            Apply
          </button>
          {chips.length > 0 && (
            <Link
              href="/admin/listings"
              className="flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border px-4 text-sm font-semibold text-brand-ink-muted transition hover:bg-brand-chip"
            >
              Clear all
            </Link>
          )}
        </div>
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
              className="flex min-h-[44px] max-w-full items-center gap-1.5 rounded-brand-pill border border-brand-border bg-white px-3 text-xs font-medium text-brand-ink transition hover:bg-brand-chip"
            >
              <span className="break-all">{chip.label}</span>
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
              <li key={entry.id}>
                <BrandRow
                  entry={entry}
                  highlightMatches={locationFilterActive}
                  expanded={expanded.has(entry.id)}
                  onToggleExpanded={() => toggleExpanded(entry.id)}
                  onDeleted={() => removeBrand(entry.id)}
                  onRestored={() => removeBrand(entry.id)}
                  onLocationDeactivated={(locationId) => markLocationDeactivated(entry.id, locationId)}
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
  const base =
    "flex min-h-[44px] items-center rounded-brand-control border border-brand-border px-4";
  if (disabled) {
    return <span className={`${base} text-brand-ink-subtle/40`}>{children}</span>;
  }
  return (
    <Link
      href={buildListingsHref(filters, page)}
      className={`${base} text-brand-ink-muted transition hover:bg-brand-chip`}
    >
      {children}
    </Link>
  );
}

/** "Created Sep 24, 2026 by root@example.com (admin)" — the date is the
 * viewer's local calendar date; the "by" part is dropped when the creator is
 * unknown (no audit row). */
function CreatedLine({ creator, className }: { creator: ListingCreator; className?: string }) {
  const by = creatorText(creator);
  return (
    <p className={className}>
      Created <LocalDateTime value={creator.created_at} variant="date" fallback="(date unknown)" />
      {by ? (
        <>
          {" by "}
          <span className="break-all font-medium text-brand-ink-muted">{by}</span>
        </>
      ) : null}
    </p>
  );
}

function BrandRow({
  entry,
  highlightMatches,
  expanded,
  onToggleExpanded,
  onDeleted,
  onRestored,
  onLocationDeactivated,
}: {
  entry: AdminListing;
  highlightMatches: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onDeleted: () => void;
  onRestored: () => void;
  onLocationDeactivated: (locationId: number) => void;
}) {
  const brand = entry;
  const locations = entry.locations;
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
    <div className="rounded-brand-card border border-brand-border bg-white p-4 shadow-brand-card sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="break-words font-display text-lg font-bold text-brand-ink">
              {brand.name}
            </h2>
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
            {brand.has_pending_claim && (
              <span className="inline-flex items-center rounded-brand-pill bg-brand-chip px-2.5 py-1 text-xs font-semibold text-brand-chip-ink">
                Claim pending
              </span>
            )}
          </div>
          <p className="mt-1 break-all text-sm font-medium text-brand-ink">
            {brand.owner_email ? (
              <>
                Owner:{" "}
                <Link
                  href={`/admin/owners?q=${encodeURIComponent(brand.owner_email)}`}
                  className="text-brand-accent underline-offset-2 hover:underline"
                >
                  {brand.owner_email}
                </Link>
              </>
            ) : (
              ownerLine(brand)
            )}
          </p>
          <CreatedLine creator={brand} className="mt-0.5 text-xs text-brand-ink-subtle" />
          <p className="mt-1 text-sm text-brand-ink-subtle">
            /{brand.slug} &middot; {brand.location_count} active of {locations.length} location
            {locations.length === 1 ? "" : "s"}
            {/* Admin-only stat, also the number behind the "Most followed" sort. */}
            {" "}
            &middot; {brand.follower_count} follower{brand.follower_count === 1 ? "" : "s"}
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
              className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-ink px-3 text-xs font-semibold text-brand-bg transition hover:bg-brand-ink/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {restoring ? "Restoring..." : "Restore listing"}
            </button>
          ) : (
            <>
              <Link
                href={`/portal/locations/new?brand=${brand.id}`}
                aria-label={`Add a location to ${brand.name}`}
                className="flex min-h-[44px] items-center gap-1.5 rounded-brand-control border border-brand-border px-3 text-xs font-semibold text-brand-ink-muted transition hover:bg-brand-chip"
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
                  className="flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border px-3 text-xs font-semibold text-brand-ink-muted transition hover:bg-brand-chip"
                >
                  {brandLink.label}
                </a>
              )}
              {!confirming && (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="flex min-h-[44px] items-center gap-1.5 rounded-brand-control border border-brand-closed px-3 text-xs font-semibold text-brand-closed transition hover:bg-brand-closed-bg"
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
              className="flex min-h-[44px] items-center gap-1.5 rounded-brand-control bg-brand-closed px-3 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <TrashIcon className="h-3.5 w-3.5" />
              {deleting ? "Deleting..." : "Confirm delete"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={deleting}
              className="flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border bg-white px-3 text-xs font-semibold text-brand-ink transition hover:bg-brand-chip disabled:opacity-60"
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

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          className="min-h-[44px] text-sm font-semibold text-brand-accent underline-offset-2 hover:underline"
        >
          {expanded ? "Hide locations" : `Show locations (${locations.length})`}
        </button>
        {highlightMatches && locations.length > 0 && (
          <span className="text-xs font-medium text-brand-ink-muted">{matchSummary(locations)}</span>
        )}
      </div>

      {expanded && (
        <div className="mt-1 flex flex-col gap-2 border-t border-brand-border pt-3">
          {locations.length === 0 && (
            <p className="text-sm text-brand-ink-subtle">This restaurant has no locations.</p>
          )}
          {locations.map((location) => (
            <LocationRow
              key={location.id}
              location={location}
              brandSlug={brand.slug}
              highlight={highlightMatches && location.matches_filter}
              onDeactivated={() => onLocationDeactivated(location.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const STATUS_TAG_CLASS: Record<AdminListingLocation["status"], string> = {
  active: "bg-brand-success-bg text-brand-success",
  owner_deactivated: "bg-brand-closed-bg text-brand-closed",
  coming_soon: "bg-brand-accent-gold/30 text-brand-chip-ink",
  closed_pending_reopen: "bg-brand-closed-bg text-brand-closed",
};

function LocationRow({
  location,
  brandSlug,
  highlight,
  onDeactivated,
}: {
  location: AdminListingLocation;
  brandSlug: string;
  highlight: boolean;
  onDeactivated: () => void;
}) {
  const pageLink = ownerLocationPageLink(brandSlug, location);
  const [confirming, setConfirming] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isActive = location.status === "active";

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

  const tag = "inline-flex items-center rounded-brand-pill px-2 py-0.5 text-xs font-semibold";

  return (
    <div
      data-matches-filter={highlight ? "true" : undefined}
      className={
        "flex flex-col gap-2 rounded-brand-control p-3 sm:flex-row sm:items-start sm:justify-between " +
        (highlight ? "bg-white ring-2 ring-brand-accent" : "bg-brand-bg")
      }
    >
      <div className="min-w-0 text-sm">
        <p className="break-words font-medium text-brand-ink">
          {location.location_name ?? location.address_line1}
        </p>
        <p className="break-words text-brand-ink-subtle">{addressLine(location)}</p>
        {location.phone && <p className="text-xs text-brand-ink-subtle">{location.phone}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {highlight && (
            <span className={`${tag} bg-brand-accent text-white`}>Matches filter</span>
          )}
          <span className={`${tag} ${STATUS_TAG_CLASS[location.status]}`}>
            {LOCATION_STATUS_LABELS[location.status]}
          </span>
          <span
            className={
              location.is_verified
                ? `${tag} bg-brand-success-bg text-brand-success`
                : `${tag} bg-brand-chip text-brand-chip-ink`
            }
          >
            {location.is_verified ? "Verified" : "Unverified"}
          </span>
          <span
            className={
              location.is_paid
                ? `${tag} bg-brand-accent-gold/30 text-brand-chip-ink`
                : `${tag} bg-brand-bg text-brand-ink-subtle ring-1 ring-brand-border`
            }
          >
            {location.is_paid ? "Paid" : "Free"}
          </span>
        </div>
        <CreatedLine creator={location} className="mt-1.5 text-xs text-brand-ink-subtle" />
        {error && <p className="mt-1 text-xs text-brand-closed">{error}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/portal/locations/${location.id}`}
          className="flex min-h-[44px] items-center gap-1.5 rounded-brand-control border border-brand-border px-3 text-xs font-semibold text-brand-ink transition hover:bg-brand-chip"
        >
          <PencilIcon className="h-3.5 w-3.5" />
          Edit
        </Link>
        <a
          href={pageLink.href}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border px-3 text-xs font-semibold text-brand-ink-muted transition hover:bg-brand-chip"
        >
          {pageLink.label}
        </a>
        {/* Deactivating only makes sense for a live location; the others are
            already hidden (their status tag says why). */}
        {isActive && (
          <button
            type="button"
            onClick={handleDeactivate}
            disabled={deactivating}
            className={
              confirming
                ? "flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-closed px-3 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                : "flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-closed px-3 text-xs font-semibold text-brand-closed transition hover:bg-brand-closed-bg disabled:cursor-not-allowed disabled:opacity-60"
            }
          >
            {deactivating ? "Deactivating..." : confirming ? "Confirm deactivate" : "Deactivate"}
          </button>
        )}
        {isActive && confirming && (
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="min-h-[44px] px-1 text-xs font-medium text-brand-ink-subtle underline"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
