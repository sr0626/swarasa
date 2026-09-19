// "My restaurants" panel on the owner's /account page: one card per brand
// with its locations, each location carrying a free/paid badge and a quick
// Edit action, and each brand a "View public page" link. Deliberately NOT a
// duplicate of /portal/dashboard (which adds managers, active/inactive
// status and the per-brand detail) — this is the at-a-glance version with a
// link through to the real dashboard. Read-only; server component.
//
// Data: `GET /restaurants` (brands) plus the public
// `GET /restaurants/{id}/locations` per brand, same as the dashboard — see
// app/account/page.tsx `loadOwnerBrands`.
import Link from "next/link";
import LocationTierBadge from "@/components/portal/LocationTierBadge";
import {
  cardClass,
  primaryLinkClass,
  secondaryLinkClass,
} from "@/components/account/accountShared";
import { EyeIcon, LocationPinIcon, PencilIcon, PlusIcon, StoreIcon } from "@/components/ui/icons";
import type { LocationSummary } from "@/types/location";
import type { RestaurantBrand } from "@/types/restaurant";

/** A brand plus its (already fetched) locations, or why they couldn't load. */
export interface OwnerBrandSummary {
  brand: RestaurantBrand;
  locations: LocationSummary[];
  locationsError: string | null;
}

export default function OwnerRestaurantsPanel({
  brands,
  loadError,
}: {
  brands: OwnerBrandSummary[];
  loadError: string | null;
}) {
  return (
    <section aria-labelledby="owner-restaurants-heading" className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="owner-restaurants-heading"
          className="font-display text-xl font-bold text-brand-ink"
        >
          My restaurants
        </h2>
        <Link
          href="/portal/dashboard"
          className="text-sm font-semibold text-brand-accent hover:text-brand-accent-hover"
        >
          Open full dashboard →
        </Link>
      </div>

      {loadError && (
        <p
          role="alert"
          className="mt-4 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed"
        >
          {loadError}
        </p>
      )}

      {!loadError && brands.length === 0 && (
        <div className="mt-4 flex flex-col items-center gap-4 rounded-brand-card border border-dashed border-brand-border px-6 py-10 text-center">
          <p className="font-display text-base font-semibold text-brand-ink">
            You don&apos;t have any restaurants yet
          </p>
          <p className="max-w-md text-sm text-brand-ink-muted">
            Add your restaurant, or claim an existing listing from its public page, to start
            managing it here.
          </p>
          <Link href="/portal/brands/new" className={primaryLinkClass}>
            <PlusIcon className="h-4 w-4" />
            Add your restaurant
          </Link>
        </div>
      )}

      {!loadError && brands.length > 0 && (
        <ul className="mt-4 flex flex-col gap-4">
          {brands.map(({ brand, locations, locationsError }) => (
            <li
              key={brand.id}
              className="overflow-hidden rounded-brand-control border border-brand-border"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 bg-brand-bg px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-brand-control bg-brand-chip text-brand-chip-ink">
                    <StoreIcon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="break-words font-display text-base font-bold text-brand-ink">
                      {brand.name}
                    </h3>
                    <p className="text-xs text-brand-ink-subtle">
                      {brand.location_count} location{brand.location_count === 1 ? "" : "s"}
                      {!brand.is_claimed && " · Unclaimed"}
                    </p>
                  </div>
                </div>
                <Link href={`/restaurant/${brand.slug}`} className={secondaryLinkClass}>
                  <EyeIcon className="h-4 w-4" />
                  View public page
                </Link>
              </div>

              {locationsError && (
                <p className="px-4 py-3 text-sm text-brand-closed">{locationsError}</p>
              )}

              {!locationsError && locations.length === 0 && (
                <p className="px-4 py-3 text-sm text-brand-ink-subtle">
                  No locations yet for this restaurant.
                </p>
              )}

              {locations.length > 0 && (
                <ul className="divide-y divide-brand-border">
                  {locations.map((location) => (
                    <li
                      key={location.id}
                      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="flex items-start gap-2 text-sm text-brand-ink">
                          <LocationPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-ink-subtle" />
                          <span className="break-words">
                            {location.location_name ? `${location.location_name} — ` : ""}
                            {location.address_line1}, {location.city}, {location.state}
                          </span>
                        </p>
                        <div className="mt-1.5 pl-6">
                          <LocationTierBadge
                            isPaid={location.is_paid}
                            paidUntil={location.paid_until}
                          />
                        </div>
                      </div>
                      <Link
                        href={`/portal/locations/${location.id}`}
                        aria-label={`Edit ${location.location_name ?? location.address_line1}`}
                        className={`${secondaryLinkClass} self-start sm:self-center`}
                      >
                        <PencilIcon className="h-4 w-4" />
                        Edit
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
