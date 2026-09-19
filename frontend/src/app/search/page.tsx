// Search results page — SSR (frontend/CLAUDE.md "ALWAYS SSR ... search
// pages"). Reuses the homepage's TopBar and "Spice Market" tokens
// (tailwind.config.ts) — no literal hex/font-family strings here, same bar
// as app/page.tsx.
//
// All filter state is read from the URL — repeated `cuisine`/`dietary`/
// `type` params (lib/search/filters.ts) — so the homepage's Hero and
// shared links land here with filters pre-applied, and the single legacy
// `?cuisine=north_indian` form keeps working. The tag taxonomy that drives
// the filter panel is fetched server-side from `GET /cuisine-tags`, falling
// back to a small built-in list if that call fails.
// `location`/`q` round-trip in the UI without a backend param to map onto
// yet — see SearchFilterBar.tsx.
import type { Metadata } from "next";
import { Suspense } from "react";
import TopBar from "@/components/home/TopBar";
import SearchFilterBar from "@/components/search/SearchFilterBar";
import SearchResults from "@/components/search/SearchResults";
import SearchResultsSkeleton from "@/components/search/SearchResultsSkeleton";
import { getCuisineTags } from "@/lib/api/cuisine";
import { FALLBACK_FILTER_TAGS } from "@/lib/constants/cuisineFilters";
import { DEFAULT_CITY_LABEL } from "@/lib/constants/city";
import {
  buildFilterGroups,
  FILTER_PARAMS,
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
  const { location, filters } = parseParams(searchParams);
  // Labels come from the built-in list (no extra fetch just for a <title>);
  // unknown slugs fall back to a prettified form.
  const known = buildFilterGroups(FALLBACK_FILTER_TAGS);
  const labels = FILTER_PARAMS.flatMap((param) =>
    filters[param].map((name) => labelFor(known, param, name))
  ).slice(0, 3);
  // `location` is the one real "city the visitor chose" signal that
  // exists today (what they typed into the Hero/SearchFilterBar location
  // field) — falls back to the launch-city default when they searched
  // without one (frontend/CLAUDE.md-adjacent: no geocoding endpoint
  // exists in Phase 1 to resolve this any more precisely).
  const cityLabel = location || DEFAULT_CITY_LABEL;
  return {
    title: labels.length
      ? `${labels.join(", ")} Restaurants — Search Results`
      : "Search Results",
    description:
      `Browse verified restaurants across ${cityLabel}, filtered by regional cuisine and dietary needs.`,
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { location, query, filters, page } = parseParams(searchParams);
  const cityLabel = location || DEFAULT_CITY_LABEL;
  const groups = await loadFilterGroups();
  const resultsKey = `${JSON.stringify(filters)}-${page}`;

  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />

      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
          Search results
        </h1>
        <p className="mt-1 text-sm text-brand-ink-muted">
          Verified restaurants around {cityLabel}.
        </p>

        <div className="mt-6">
          <SearchFilterBar
            initialLocation={location}
            initialQuery={query}
            filters={filters}
            groups={groups}
          />
        </div>

        <div className="mt-8">
          <Suspense key={resultsKey} fallback={<SearchResultsSkeleton />}>
            <SearchResults filters={filters} page={page} location={location} query={query} />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
