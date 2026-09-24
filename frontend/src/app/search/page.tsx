// Search results page — SSR (frontend/CLAUDE.md "ALWAYS SSR ... search
// pages"). Reuses the homepage's TopBar and "Spice Market" tokens
// (tailwind.config.ts) — no literal hex/font-family strings here, same bar
// as app/page.tsx.
//
// All filter state is read from the URL — repeated `cuisine`/`dietary`/
// `type` params (lib/search/filters.ts) — so the homepage's Hero and
// shared links land here with filters pre-applied, and the single legacy
// `?cuisine=north_indian` form keeps working. The tag taxonomy that drives
// the Filters dropdown is fetched server-side from `GET /cuisine-tags`, falling
// back to a small built-in list if that call fails.
// With NO criteria (no q/location/tag filter/deals_today — `page`/`sort`
// don't count, see `hasSearchCriteria`) the page renders an empty "start a
// search" state and makes no /search call; the homepage owns "Popular near
// you". Any criterion loads results exactly as before.
// `q` round-trips straight to the backend `q` param. `location` is
// geocoded server-side in SearchResults (lib/geocode's Census/Nominatim
// chain) before the GET /search call — see SearchFilterBar.tsx for why it
// isn't sent as text.
import type { Metadata } from "next";
import { Suspense } from "react";
import TopBar from "@/components/home/TopBar";
import SearchFilterBar from "@/components/search/SearchFilterBar";
import SearchEmptyState from "@/components/search/SearchEmptyState";
import SearchResults from "@/components/search/SearchResults";
import SearchResultsSkeleton from "@/components/search/SearchResultsSkeleton";
import { getCuisineTags } from "@/lib/api/cuisine";
import { FALLBACK_FILTER_TAGS } from "@/lib/constants/cuisineFilters";
import { DEFAULT_CITY_LABEL } from "@/lib/constants/city";
import {
  buildFilterGroups,
  buildSearchHref,
  FILTER_PARAMS,
  hasSearchCriteria,
  labelFor,
  parseFilters as parseTagFilters,
  type FilterGroup,
} from "@/lib/search/filters";

interface SearchPageProps {
  searchParams: { [key: string]: string | string[] | undefined };
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parsePage(value: string | string[] | undefined): number {
  const raw = firstValue(value);
  const parsed = raw ? parseInt(raw, 10) : 1;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function parseParams(searchParams: SearchPageProps["searchParams"]) {
  return {
    location: firstValue(searchParams.location) ?? "",
    query: firstValue(searchParams.q) ?? "",
    filters: parseTagFilters(searchParams),
    page: parsePage(searchParams.page),
  };
}

/** Live taxonomy from `GET /cuisine-tags`; on any failure (or an empty
 * list) falls back to the built-in subset so the filter panel never
 * vanishes because one call failed. */
async function loadFilterGroups(): Promise<FilterGroup[]> {
  try {
    const groups = buildFilterGroups(await getCuisineTags());
    if (groups.length > 0) return groups;
  } catch {
    // fall through to the fallback list
  }
  return buildFilterGroups(FALLBACK_FILTER_TAGS);
}

export function generateMetadata({ searchParams }: SearchPageProps): Metadata {
  const { location, query, filters, page } = parseParams(searchParams);
  // Empty /search (no criteria) is a thin "start a search" prompt with no
  // listing content of its own — canonical to the bare path, but noindex
  // (follow stays on so its quick-start links are still crawled). Searches
  // with criteria keep today's title/description and are indexable, each
  // canonical to its own normalised URL (param order/junk params dropped).
  if (!hasSearchCriteria({ location, query, filters })) {
    return {
      title: "Find Restaurants",
      description: `Search verified Indian restaurants in ${DEFAULT_CITY_LABEL} by name, cuisine, dietary need or city.`,
      alternates: { canonical: "/search" },
      robots: { index: false, follow: true },
    };
  }
  // Labels come from the built-in list (no extra fetch just for a <title>);
  // unknown slugs fall back to a prettified form.
  const known = buildFilterGroups(FALLBACK_FILTER_TAGS);
  const labels = FILTER_PARAMS.flatMap((param) =>
    filters[param].map((name) => labelFor(known, param, name))
  ).slice(0, 3);
  // `location` is the one real "city the visitor chose" signal that
  // exists today (what they typed into the Hero/SearchFilterBar location
  // field) — falls back to the launch-city default when they searched
  // without one. This is the typed text as-is, not the geocoded result:
  // a <title>/description doesn't need resolved coordinates, and
  // metadata generation shouldn't make its own geocoding call (SearchResults
  // does that once, for the actual query).
  const cityLabel = location || DEFAULT_CITY_LABEL;
  return {
    title: labels.length
      ? `${labels.join(", ")} Restaurants — Search Results`
      : "Search Results",
    description:
      `Browse verified restaurants across ${cityLabel}, filtered by regional cuisine and dietary needs.`,
    alternates: { canonical: buildSearchHref({ location, query, filters, page }) },
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { location, query, filters, page } = parseParams(searchParams);
  const cityLabel = location || DEFAULT_CITY_LABEL;
  const hasCriteria = hasSearchCriteria({ location, query, filters });
  const groups = await loadFilterGroups();
  const resultsKey = `${JSON.stringify(filters)}-${page}`;

  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />

      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
          {hasCriteria ? "Search results" : "Find restaurants"}
        </h1>
        <p className="mt-1 text-sm text-brand-ink-muted">
          {hasCriteria
            ? `Verified restaurants around ${cityLabel}.`
            : "Search by restaurant, cuisine or city."}
        </p>

        <div className="mt-6">
          <SearchFilterBar
            initialLocation={location}
            initialQuery={query}
            filters={filters}
            groups={groups}
          />
        </div>

        <div className="mt-5">
          {hasCriteria ? (
            <Suspense key={resultsKey} fallback={<SearchResultsSkeleton />}>
              <SearchResults filters={filters} page={page} location={location} query={query} />
            </Suspense>
          ) : (
            // No criteria: no backend call, no skeleton — just the prompt.
            <SearchEmptyState />
          )}
        </div>
      </section>
    </main>
  );
}
