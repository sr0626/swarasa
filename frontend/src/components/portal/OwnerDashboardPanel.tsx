// Right-hand panel of the owner console on /portal/dashboard ("My
// restaurants"): page heading with an "Add a restaurant" action, stat tiles
// (restaurants / locations / paid / free -- derived from the data the page
// already loads, no extra calls), then one BrandCard per brand (locations with
// Edit link, tier/status badges and assigned managers), or the error / empty
// states. The banner and left menu come from OwnerShell; the data fetching
// stays in app/portal/dashboard/page.tsx. Server Component.
import Link from "next/link";
import BrandCard from "@/components/portal/BrandCard";
import OwnerStatTiles from "@/components/account/OwnerStatTiles";
import { primaryLinkClass } from "@/components/account/accountShared";
import InfoPanel from "@/components/ui/InfoPanel";
import { PlusIcon } from "@/components/ui/icons";
import type { LocationWithManagers } from "@/types/location";
import type { RestaurantBrand } from "@/types/restaurant";

/** A brand plus its (already fetched) locations + managers, or why they couldn't load. */
export interface BrandWithLocations {
  brand: RestaurantBrand;
  locations: LocationWithManagers[];
  locationsError: string | null;
}

export default function OwnerDashboardPanel({
  brands,
  loadError,
}: {
  brands: BrandWithLocations[];
  loadError: string | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
            My restaurants
          </h1>
          <p className="mt-2 text-sm text-brand-ink-muted">
            Your restaurant brands and locations. Select a location to edit its details, hours,
            photos, and managers.
          </p>
        </div>
        <Link href="/portal/brands/new" className={primaryLinkClass}>
          <PlusIcon className="h-4 w-4" />
          Add a restaurant
        </Link>
      </header>

      <OwnerStatTiles
        brands={brands.map(({ locations, locationsError }) => ({
          locations: locations.map((l) => l.location),
          locationsError,
        }))}
        loadFailed={loadError !== null}
      />

      {loadError && <InfoPanel title="Couldn't load your restaurants" body={loadError} />}

      {!loadError && brands.length === 0 && (
        <div className="flex flex-col items-center gap-4">
          <InfoPanel
            title="No restaurants found"
            body="You don't have any restaurant brands yet. Claim an existing unclaimed listing from its public page, or create a new brand, to get started."
          />
          <Link href="/portal/brands/new" className={primaryLinkClass}>
            <PlusIcon className="h-4 w-4" />
            Add your first restaurant
          </Link>
        </div>
      )}

      {!loadError && brands.length > 0 && (
        <div className="flex flex-col gap-5">
          {brands.map(({ brand, locations, locationsError }) => (
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
  );
}
