// Lightweight restaurant list on the owner's own /account page — per
// direct user instruction 2026-09-17 ("all these details should be in
// owner profile page, along with the list of his restaurants").
//
// Deliberately NOT a duplicate of /portal/dashboard (which already has the
// full editable table: tier/status badges, managers, location editor
// links — frontend/src/app/portal/dashboard/page.tsx). This is a compact
// read-only summary (brand name, slug, location count) with a link to the
// real dashboard for anything more than a glance.
import Link from "next/link";
import type { RestaurantBrand } from "@/types/restaurant";

export default function OwnerRestaurantsList({
  brands,
  loadError,
}: {
  brands: RestaurantBrand[];
  loadError: string | null;
}) {
  return (
    <section
      aria-labelledby="owner-restaurants-heading"
      className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="owner-restaurants-heading" className="font-display text-xl font-bold text-brand-ink">
          Your restaurants
        </h2>
        <Link
          href="/portal/dashboard"
          className="text-sm font-semibold text-brand-accent hover:text-brand-accent-hover"
        >
          Manage all →
        </Link>
      </div>

      {loadError && (
        <p className="mt-3 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
          {loadError}
        </p>
      )}

      {!loadError && brands.length === 0 && (
        <p className="mt-3 text-sm text-brand-ink-muted">
          You don&apos;t have any restaurants yet.{" "}
          <Link href="/login" className="font-semibold text-brand-accent hover:text-brand-accent-hover">
            Add your restaurant
          </Link>
          .
        </p>
      )}

      {!loadError && brands.length > 0 && (
        <ul className="mt-3 flex flex-col divide-y divide-brand-border">
          {brands.map((brand) => (
            <li key={brand.id} className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="text-sm font-semibold text-brand-ink">{brand.name}</p>
                <p className="text-xs text-brand-ink-subtle">
                  {brand.location_count} location{brand.location_count === 1 ? "" : "s"}
                </p>
              </div>
              <Link
                href="/portal/dashboard"
                className="min-h-[44px] shrink-0 rounded-brand-control border border-brand-border px-3 py-2 text-sm font-medium text-brand-ink-muted transition hover:border-brand-ink-subtle hover:text-brand-ink"
              >
                View
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
