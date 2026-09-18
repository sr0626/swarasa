// Search results page — SSR (frontend/CLAUDE.md "ALWAYS SSR ... search
// pages"). Reuses the homepage's TopBar and "Spice Market" tokens
// (tailwind.config.ts) — no literal hex/font-family strings here, same bar
// as app/page.tsx.
//
// Filter state is read from the URL so the homepage's Hero search bar and
// cuisine chips can link straight in with pre-applied filters (e.g.
// `?cuisine=north_indian`) — see SearchFilterBar.tsx for the exact
// contract this completes and the one param (`cuisine`) that's real vs.
// the two (`location`, `q`) that round-trip in the UI without a backend
// param to map onto yet.
import type { Metadata } from "next";
import { Suspense } from "react";
import TopBar from "@/components/home/TopBar";
import SearchFilterBar from "@/components/search/SearchFilterBar";
import SearchResults from "@/components/search/SearchResults";
import SearchResultsSkeleton from "@/components/search/SearchResultsSkeleton";
import { CUISINE_FILTER_CHIPS } from "@/lib/constants/cuisineFilters";
import { DEFAULT_CITY_LABEL } from "@/lib/constants/city";

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

function parseFilters(searchParams: SearchPageProps["searchParams"]) {
  return {
    location: firstValue(searchParams.location) ?? "",
    query: firstValue(searchParams.q) ?? "",
    cuisine: firstValue(searchParams.cuisine) ?? null,
    page: parsePage(searchParams.page),
  };
}

export function generateMetadata({ searchParams }: SearchPageProps): Metadata {
  const { location, cuisine } = parseFilters(searchParams);
  const chip = cuisine ? CUISINE_FILTER_CHIPS.find((c) => c.name === cuisine) : null;
  // `location` is the one real "city the visitor chose" signal that
  // exists today (what they typed into the Hero/SearchFilterBar location
  // field) — falls back to the launch-city default when they searched
  // without one (frontend/CLAUDE.md-adjacent: no geocoding endpoint
  // exists in Phase 1 to resolve this any more precisely).
  const cityLabel = location || DEFAULT_CITY_LABEL;
  return {
    title: chip ? `${chip.display_name} Restaurants — Search Results` : "Search Results",
    description:
      `Browse verified restaurants across ${cityLabel}, filtered by regional cuisine and dietary needs.`,
  };
}

export default function SearchPage({ searchParams }: SearchPageProps) {
  const { location, query, cuisine, page } = parseFilters(searchParams);
  const cityLabel = location || DEFAULT_CITY_LABEL;

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
            initialCuisine={cuisine}
          />
        </div>

        <div className="mt-8">
          <Suspense key={`${cuisine ?? ""}-${page}`} fallback={<SearchResultsSkeleton />}>
            <SearchResults cuisine={cuisine} page={page} location={location} query={query} />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
