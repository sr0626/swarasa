// One brand's card on the owner's business page (/account) — brand header (from
// `GET /restaurants`, owner-scoped) plus its locations (fetched separately
// per brand via the existing public `GET /restaurants/{id}/locations`,
// since the owner-scoped list only returns a `location_count`, not the
// location rows themselves — see docs/API_CONTRACTS.md "GET /restaurants").
// Each location row also shows tier/billing status, active/inactive state,
// and assigned managers (docs/PROJECT_PLAN.csv "Owner dashboard: richer
// restaurant table") — see `lib/owner/loadOwnerRestaurants.ts` for where that data
// is loaded and `LocationTierBadge`/`LocationStatusBadge`/
// `LocationManagersSummary` for the flagged contract gaps on tier/status.
// Server Component — no interactivity here, just links into the location
// editor (`/portal/locations/{id}`) and the brand's public page.
import Link from "next/link";
import { EyeIcon, HeartIcon, LocationPinIcon, PencilIcon, StoreIcon, TagIcon } from "@/components/ui/icons";
import { secondaryLinkClass } from "@/components/account/accountShared";
import LocationStatusChip from "@/components/console/LocationStatusChip";
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
            <h3 className="font-display text-lg font-bold text-brand-ink">{brand.name}</h3>
            {brand.description && (
              <p className="mt-0.5 max-w-lg text-sm text-brand-ink-muted">{brand.description}</p>
            )}
            {/* Dashboard-only stat (backend RestaurantOut.follower_count) —
                never shown on the public /restaurant/[slug] page or search
                tiles, only here on the owner's own /account business page. */}
            {brand.follower_count !== null && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-brand-ink-subtle">
                <HeartIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {brand.follower_count} follower{brand.follower_count === 1 ? "" : "s"}
              </p>
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
        <div className="flex flex-wrap items-center gap-2">
          {!brand.is_claimed && (
            <span className="rounded-brand-pill bg-brand-bg px-2.5 py-1 text-xs font-semibold text-brand-ink-subtle">
              Unclaimed
            </span>
          )}
          <Link
            href={`/restaurant/${brand.slug}`}
            aria-label={`View public page for ${brand.name}`}
            className={secondaryLinkClass}
          >
            <EyeIcon className="h-4 w-4" />
            View public page
          </Link>
        </div>
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
            {locations.map(({ location, managers, managersError, todayStatus }) => (
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
                    <LocationStatusChip status={todayStatus} />
                    <PencilIcon className="h-4 w-4 text-brand-ink-subtle" />
                  </span>
                </Link>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-brand-border px-4 py-2.5">
                  <LocationTierBadge isPaid={location.is_paid} paidUntil={location.paid_until} />
                  <LocationStatusBadge status={location.status} />
                  <LocationManagersSummary managers={managers} error={managersError} />
                  {/* Deals are the thing owners/managers update most often — a
                      one-tap shortcut to the editor's "Deals & specials"
                      section (/deals redirects to it). */}
                  <Link
                    href={`/portal/locations/${location.id}/deals`}
                    aria-label={`Deals for ${location.location_name ?? location.address_line1}`}
                    className={`ml-auto ${secondaryLinkClass}`}
                  >
                    <TagIcon className="h-4 w-4" />
                    Deals
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
