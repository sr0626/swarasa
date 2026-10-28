// `/indian-restaurants` — city index: every city with its restaurant count,
// each a real crawlable link to /indian-restaurants/{city-slug}. SSR +
// canonical + JSON-LD `ItemList` (emitted by <CityList>). Anonymous (no
// session, no token). The grid streams behind a skeleton; this page has no
// 404 path, so streaming is safe here (unlike [citySlug]/page.tsx).
import type { Metadata } from "next";
import { Suspense } from "react";
import TopBar from "@/components/home/TopBar";
import CityList, { loadCities } from "@/components/city/CityList";
import CityListSkeleton from "@/components/city/CityListSkeleton";
import { CITY_INDEX_PATH } from "@/lib/city/paths";
import { buildCityIndexDescription, CITY_INDEX_TITLE } from "@/lib/city/seo";

export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const cities = await loadCities();
  const locations = (cities ?? []).reduce((sum, c) => sum + c.location_count, 0);
  return {
    title: CITY_INDEX_TITLE,
    description: buildCityIndexDescription(cities?.length ?? 0, locations),
    alternates: { canonical: CITY_INDEX_PATH },
    // An API failure must not get a thin page indexed.
    ...(cities === null ? { robots: { index: false, follow: true } } : {}),
  };
}

export default function CityIndexPage() {
  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />
      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
          Indian Restaurants by City
        </h1>
        <p className="mt-1 text-sm text-brand-ink-muted">
          Pick a city to browse every verified Indian restaurant listed there.
        </p>
        <div className="mt-6">
          <Suspense fallback={<CityListSkeleton />}>
            <CityList />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
