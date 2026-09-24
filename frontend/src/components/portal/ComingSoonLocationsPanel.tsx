// "Coming soon" summary for the owner console (docs/PROJECT_PLAN.csv
// "Location status lifecycle" — "a Coming soon section/link on the owner
// console listing any coming-soon locations"). Pulls together every
// `coming_soon` location across all the owner's brands into one flat list,
// since BrandCard.tsx already shows each location's status inline per-brand
// but there was no single place to see "what am I still setting up" across
// the whole account. Renders nothing when there are none — this is a
// summary, not a required section. Server Component (no interactivity,
// just links into the location editor).
import Link from "next/link";
import { ClockIcon } from "@/components/ui/icons";
import type { BrandWithLocations } from "@/lib/owner/loadOwnerRestaurants";

export default function ComingSoonLocationsPanel({ brands }: { brands: BrandWithLocations[] }) {
  const comingSoon = brands.flatMap(({ brand, locations }) =>
    locations
      .filter(({ location }) => location.status === "coming_soon")
      .map(({ location }) => ({ brand, location }))
  );

  if (comingSoon.length === 0) return null;

  return (
    <section
      aria-labelledby="coming-soon-heading"
      className="rounded-brand-card border border-brand-border bg-brand-success-bg p-5 shadow-brand-card sm:p-6"
    >
      <h2
        id="coming-soon-heading"
        className="flex items-center gap-2 font-display text-lg font-bold text-brand-ink"
      >
        <ClockIcon className="h-5 w-5 text-brand-success" />
        Coming soon
      </h2>
      <p className="mt-1 text-sm text-brand-ink-muted">
        These locations are hidden from the public until you finish setting them up and activate them.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {comingSoon.map(({ brand, location }) => (
          <li key={location.id}>
            <Link
              href={`/portal/locations/${location.id}`}
              className="flex min-h-[44px] items-center justify-between gap-3 rounded-brand-control bg-white px-4 py-2.5 text-sm text-brand-ink shadow-sm transition hover:bg-brand-bg"
            >
              <span className="truncate">
                {brand.name}
                {location.location_name ? ` — ${location.location_name}` : ""}
                {" · "}
                {location.city}, {location.state}
              </span>
              <span className="shrink-0 text-xs font-semibold text-brand-accent">Edit</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
