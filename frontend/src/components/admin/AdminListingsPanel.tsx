"use client";

// Admin listings management UI. Renders the brands (+ their already
// SSR-loaded locations) the page passed in, and drives the two real
// moderation actions (`deleteRestaurantAction`, `deactivateLocationAction`
// in `actions.ts`) against docs/API_CONTRACTS.md's actual
// `DELETE /restaurants/{id}` and `DELETE /locations/{id}` endpoints.
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
} from "@/app/admin/listings/actions";
import OpenStatusBadge from "@/components/ui/OpenStatusBadge";
import { PencilIcon, TrashIcon } from "@/components/ui/icons";
import type { LocationSummary } from "@/types/location";
import type { RestaurantBrand } from "@/types/restaurant";

export interface BrandWithLocations {
  brand: RestaurantBrand;
  locations: LocationSummary[];
  locationsError: string | null;
}

export default function AdminListingsPanel({
  initialBrands,
}: {
  initialBrands: BrandWithLocations[];
}) {
  const [brands, setBrands] = useState<BrandWithLocations[]>(initialBrands);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

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

  if (brands.length === 0) {
    return (
      <p className="rounded-brand-card border border-dashed border-brand-border bg-white p-5 text-sm text-brand-ink-muted">
        No restaurants on this page.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {brands.map((entry) => (
        <li key={entry.brand.id}>
          <BrandRow
            entry={entry}
            expanded={expanded.has(entry.brand.id)}
            onToggleExpanded={() => toggleExpanded(entry.brand.id)}
            onDeleted={() => removeBrand(entry.brand.id)}
            onLocationDeactivated={(locationId) => removeLocation(entry.brand.id, locationId)}
          />
        </li>
      ))}
    </ul>
  );
}

function BrandRow({
  entry,
  expanded,
  onToggleExpanded,
  onDeleted,
  onLocationDeactivated,
}: {
  entry: BrandWithLocations;
  expanded: boolean;
  onToggleExpanded: () => void;
  onDeleted: () => void;
  onLocationDeactivated: (locationId: number) => void;
}) {
  const { brand, locations, locationsError } = entry;
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
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

        <div className="flex items-center gap-2">
          <a
            href={`/restaurant/${brand.slug}`}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-[40px] items-center justify-center rounded-brand-control border border-brand-border px-3 text-xs font-semibold text-brand-ink-muted transition hover:bg-brand-chip"
          >
            View live
          </a>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className={
              confirming
                ? "flex min-h-[40px] items-center gap-1.5 rounded-brand-control bg-brand-closed px-3 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                : "flex min-h-[40px] items-center gap-1.5 rounded-brand-control border border-brand-closed px-3 text-xs font-semibold text-brand-closed transition hover:bg-brand-closed-bg disabled:cursor-not-allowed disabled:opacity-60"
            }
          >
            <TrashIcon className="h-3.5 w-3.5" />
            {deleting ? "Deleting..." : confirming ? "Confirm delete" : "Delete listing"}
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
  onDeactivated,
}: {
  location: LocationSummary;
  onDeactivated: () => void;
}) {
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

      <div className="flex items-center gap-2">
        <Link
          href={`/portal/locations/${location.id}`}
          className="flex min-h-[36px] items-center gap-1.5 rounded-brand-control border border-brand-border px-3 text-xs font-semibold text-brand-ink transition hover:bg-brand-chip"
        >
          <PencilIcon className="h-3.5 w-3.5" />
          Edit
        </Link>
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
