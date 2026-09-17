// One brand's card on the owner portal dashboard — brand header (from
// `GET /restaurants`, owner-scoped) plus its locations (fetched separately
// per brand via the existing public `GET /restaurants/{id}/locations`,
// since the owner-scoped list only returns a `location_count`, not the
// location rows themselves — see docs/API_CONTRACTS.md "GET /restaurants").
// Each location row also shows tier/billing status, active/inactive state,
// and assigned managers (docs/PROJECT_PLAN.csv "Owner dashboard: richer
// restaurant table") — see `portal/dashboard/page.tsx` for where that data
// is loaded and `LocationTierBadge`/`LocationStatusBadge`/
// `LocationManagersSummary` for the flagged contract gaps on tier/status.
// Server Component — no interactivity here, just links into the location
// editor (`/portal/locations/{id}`).
import Link from "next/link";
import { LocationPinIcon, PencilIcon, StoreIcon } from "@/components/ui/icons";
import OpenStatusBadge from "@/components/ui/OpenStatusBadge";
import LocationTierBadge from "@/components/portal/LocationTierBadge";
import LocationStatusBadge from "@/components/portal/LocationStatusBadge";
import LocationManagersSummary from "@/components/portal/LocationManagersSummary";
import type { LocationWithManagers } from "@/types/location";
import type { RestaurantBrand } from "@/types/restaurant";

export default function BrandCard({
  brand,
  locations,
  locationsError,
}: {
  brand: RestaurantBrand;
  locations: LocationWithManagers[];
  locationsError: string | null;
}) {
  return (
    <div className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-brand-control bg-brand-chip text-brand-chip-ink">
            <StoreIcon className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display text-lg font-bold text-brand-ink">{brand.name}</h2>
            {brand.description && (
              <p className="mt-0.5 max-w-lg text-sm text-brand-ink-muted">{brand.description}</p>
            )}
            {brand.cuisine_tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {brand.cuisine_tags.map((tag) => (
                  <span
                    key={tag.name}
                    className="rounded-brand-pill bg-brand-chip px-2 py-0.5 text-xs font-medium text-brand-chip-ink"
                  >
                    {tag.display_name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        {!brand.is_claimed && (
          <span className="rounded-brand-pill bg-brand-bg px-2.5 py-1 text-xs font-semibold text-brand-ink-subtle">
            Unclaimed
          </span>
        )}
      </div>

      <div className="mt-4 border-t border-brand-border pt-4">
        {locationsError && (
          <p className="rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
            {locationsError}
          </p>
        )}

        {!locationsError && locations.length === 0 && (
          <p className="text-sm text-brand-ink-subtle">No locations yet for this brand.</p>
        )}

        {!locationsError && locations.length > 0 && (
          <ul className="flex flex-col gap-2">
            {locations.map(({ location, managers, managersError }) => (
              <li
                key={location.id}
                className="rounded-brand-control border border-brand-border bg-white"
              >
                <Link
                  href={`/portal/locations/${location.id}`}
                  className="flex min-h-[44px] items-center justify-between gap-3 px-4 py-2.5 transition hover:bg-brand-bg"
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm text-brand-ink">
                    <LocationPinIcon className="h-4 w-4 shrink-0 text-brand-ink-subtle" />
                    <span className="truncate">
                      {location.location_name ? `${location.location_name} — ` : ""}
                      {location.address_line1}, {location.city}, {location.state}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <OpenStatusBadge isOpenNow={location.is_open_now} />
                    <PencilIcon className="h-4 w-4 text-brand-ink-subtle" />
                  </span>
                </Link>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-brand-border px-4 py-2.5">
                  <LocationTierBadge isPaid={location.is_paid} paidUntil={location.paid_until} />
                  <LocationStatusBadge isActive={location.is_active} />
                  <LocationManagersSummary managers={managers} error={managersError} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
