// `/indian-restaurants/{city-slug}` — SEO city landing page. SSR + canonical +
// schema.org `ItemList` JSON-LD (frontend/CLAUDE.md "SEO Requirements"), listing
// EVERY publicly visible location in the city (GET /cities/{slug}/restaurants),
// 24 per page with real `?page=N` links.
//
// Anonymous by design: the page never reads the viewer's session or sends a
// token, so what it renders (and what the data cache stores) is identical for
// everyone — signed-out visitors see only the content-free "Deal(s) available
// today" badge, and tiles carry no follow button (follow lives on the
// restaurant page). Tiles link to the location's own page
// (/restaurant/{brand}/{location}); the URL design is unchanged.
//
// 404s are real: an unknown city slug, a junk `?page=` or a page past the end
// call `notFound()` (a true 404 status, not a soft 200). There is deliberately
// NO route-level loading.tsx here — Next streams a loading boundary with a 200
// status before the page can decide to 404, which would turn those into soft
// 200s; the other public SSR pages work the same way.
//
// Caching: `revalidate` plus the API client's 5-minute data-cache window.
// (TopBar reads the session cookie, so the HTML itself renders per request;
// the expensive part, the API response, is what's cached.)
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import TopBar from "@/components/home/TopBar";
import CityPagination from "@/components/city/CityPagination";
import RestaurantCard from "@/components/listing/RestaurantCard";
import InfoPanel from "@/components/ui/InfoPanel";
import { ApiError } from "@/lib/api/client";
import { getCityRestaurants } from "@/lib/api/cities";
import { buildCityItemListSchema } from "@/lib/city/jsonld";
import { CITY_INDEX_PATH, CITY_PAGE_SIZE, cityPagePath, parsePageParam } from "@/lib/city/paths";
import { buildCityDescription, buildCityHeading, buildCityTitle } from "@/lib/city/seo";
import { jsonLdString } from "@/lib/menu/jsonld";
import { SITE_URL } from "@/lib/site";
import type { CityRestaurantsResponse } from "@/types/city";

export const revalidate = 300;

interface CityPageProps {
  params: { citySlug: string };
  searchParams: { [key: string]: string | string[] | undefined };
}

type Loaded =
  | { kind: "ok"; data: CityRestaurantsResponse }
  | { kind: "not_found" }
  | { kind: "error" };

async function load(citySlug: string, page: number): Promise<Loaded> {
  try {
    return {
      kind: "ok",
      data: await getCityRestaurants(citySlug, { page, page_size: CITY_PAGE_SIZE }),
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { kind: "not_found" };
    return { kind: "error" };
  }
}

export async function generateMetadata({ params, searchParams }: CityPageProps): Promise<Metadata> {
  const page = parsePageParam(searchParams.page);
  if (page === null) return { title: "Page Not Found" };
  const loaded = await load(params.citySlug, page);
  if (loaded.kind === "not_found") return { title: "City Not Found" };
  if (loaded.kind === "error") {
    return { title: "Indian Restaurants", robots: { index: false, follow: true } };
  }
  const { city, total } = loaded.data;
  return {
    title: buildCityTitle(city, page),
    description: buildCityDescription({ ...city, count: total }, page),
    // Each page canonicalises to itself (page 1 = the bare city path).
    alternates: { canonical: cityPagePath(city.slug, page) },
  };
}

export default async function CityPage({ params, searchParams }: CityPageProps) {
  const page = parsePageParam(searchParams.page);
  if (page === null) notFound();
  const loaded = await load(params.citySlug, page);
  if (loaded.kind === "not_found") notFound();

  if (loaded.kind === "error") {
    return (
      <main className="min-h-screen bg-brand-bg">
        <TopBar />
        <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <InfoPanel
            title="We can't load these restaurants right now"
            body="Our restaurant service is still coming online. Please check back shortly."
          />
        </section>
      </main>
    );
  }

  const { data } = loaded;
  // A real city, but a page past the end: 404, not an empty 200.
  if (data.results.length === 0 && page > 1) notFound();

  const heading = buildCityHeading(data.city);

  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdString(
            buildCityItemListSchema({
              heading,
              siteUrl: SITE_URL,
              results: data.results,
              page: data.page,
              pageSize: data.page_size,
              total: data.total,
            })
          ),
        }}
      />

      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <nav aria-label="Breadcrumb" className="text-sm text-brand-ink-muted">
          <Link href={CITY_INDEX_PATH} className="inline-flex min-h-[44px] items-center hover:text-brand-ink hover:underline">
            All cities
          </Link>
        </nav>

        <h1 className="mt-1 font-display text-2xl font-bold text-brand-ink sm:text-3xl">{heading}</h1>
        <p className="mt-1 text-sm text-brand-ink-muted">
          {data.total} verified restaurant{data.total === 1 ? "" : "s"} listed in{" "}
          {data.city.city}
          {data.page_size < data.total && ` · page ${data.page}`}
        </p>

        {data.results.length === 0 ? (
          <div className="mt-6">
            <InfoPanel
              title="No restaurants listed here yet"
              body="Check back soon, or browse another city."
            />
          </div>
        ) : (
          <ul className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {data.results.map((item) => (
              <li key={`${item.brand_id}-${item.nearest_location.location_id}`} className="min-w-0">
                <RestaurantCard item={item} />
              </li>
            ))}
          </ul>
        )}

        <CityPagination
          citySlug={data.city.slug}
          page={data.page}
          pageSize={data.page_size}
          total={data.total}
        />
      </section>
    </main>
  );
}
