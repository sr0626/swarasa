// Server component for the city index grid: fetches every city and renders a
// crawlable link per city (with its restaurant count), plus the ItemList
// JSON-LD. Wrapped in <Suspense> by app/indian-restaurants/page.tsx so a slow
// API shows <CityListSkeleton> instead of a blank screen.
import Link from "next/link";
import InfoPanel from "@/components/ui/InfoPanel";
import { getAllCities } from "@/lib/api/cities";
import { buildCityIndexSchema } from "@/lib/city/jsonld";
import { cityPath } from "@/lib/city/paths";
import { jsonLdString } from "@/lib/menu/jsonld";
import { SITE_URL } from "@/lib/site";
import type { CitySummary } from "@/types/city";

export async function loadCities(): Promise<CitySummary[] | null> {
  try {
    return await getAllCities();
  } catch {
    return null;
  }
}

export default async function CityList() {
  const cities = await loadCities();

  if (cities === null) {
    return (
      <InfoPanel
        title="We can't load cities right now"
        body="Our restaurant service is still coming online. Please check back shortly."
      />
    );
  }
  if (cities.length === 0) {
    return <InfoPanel title="No cities listed yet" body="Restaurants are being added. Check back soon." />;
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdString(buildCityIndexSchema({ siteUrl: SITE_URL, cities })),
        }}
      />
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cities.map((city) => (
          <li key={city.slug}>
            <Link
              href={cityPath(city.slug)}
              className="flex min-h-[44px] items-center justify-between gap-3 rounded-brand-card border border-brand-border bg-white px-4 py-3 shadow-brand-card transition hover:shadow-brand-card-hover"
            >
              <span className="min-w-0 truncate font-display text-base font-semibold text-brand-ink">
                {city.city}
                {city.state && `, ${city.state}`}
              </span>
              <span className="shrink-0 text-sm text-brand-ink-muted">
                {city.location_count} restaurant{city.location_count === 1 ? "" : "s"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
