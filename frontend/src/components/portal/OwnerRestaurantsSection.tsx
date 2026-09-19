// "My restaurants" section of the owner's single business page (/account,
// components/account/OwnerAccountView.tsx): section heading with an "Add a
// restaurant" action, then one BrandCard per brand (locations with Edit / View
// public page links, tier/status badges and assigned managers), or the error /
// empty states. Data fetching lives in lib/owner/loadOwnerRestaurants.ts.
// Server Component.
import Link from "next/link";
import BrandCard from "@/components/portal/BrandCard";
import { primaryLinkClass } from "@/components/account/accountShared";
import InfoPanel from "@/components/ui/InfoPanel";
import { PlusIcon } from "@/components/ui/icons";
import type { BrandWithLocations } from "@/lib/owner/loadOwnerRestaurants";

export default function OwnerRestaurantsSection({
  brands,
  loadError,
}: {
  brands: BrandWithLocations[];
  loadError: string | null;
}) {
  return (
    <section
      id="restaurants"
      aria-labelledby="restaurants-heading"
      className="flex scroll-mt-24 flex-col gap-5"
    >
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2
            id="restaurants-heading"
            className="font-display text-2xl font-bold text-brand-ink sm:text-3xl"
          >
            My restaurants
          </h2>
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
    </section>
  );
}
