"use client";

// Search results page filter bar — same visual form as the homepage
// Hero's search bar (location + cuisine/dish/restaurant text, "Spice
// Market" tokens) but wired to actually drive this page's results instead
// of just navigating to it, plus the fine-grained multi-select tag filter
// (TagFilterPanel) below it.
//
// Filter state lives in the URL (repeated params, see lib/search/filters.ts)
// — the `filters` prop is parsed server-side from `searchParams`, this
// component is the only place that navigates. Every filter change pushes
// a new URL WITHOUT `page`, i.e. resets pagination to page 1.
//
// `q` (the "Cuisine, dish, or restaurant" box) IS sent to the API as the
// free-text `q` param (2026-09-19): it matches restaurant names and cuisine
// tags. `location` is still read from the URL and kept visible but NOT sent
// -- there is no "resolve this city/ZIP to lat/lng" endpoint in Phase 1, so
// there is nothing real to send it as.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LocationPinIcon, SearchIcon } from "@/components/ui/icons";
import { ActiveFilters, TagFilterPanel } from "@/components/search/TagFilterPanel";
import {
  buildSearchHref,
  countFilters,
  EMPTY_FILTERS,
  toggleFilter,
  type FilterGroup,
  type FilterParam,
  type SearchFilters,
} from "@/lib/search/filters";

interface SearchFilterBarProps {
  initialLocation: string;
  initialQuery: string;
  /** Parsed from the URL server-side — the source of truth for chip state. */
  filters: SearchFilters;
  groups: FilterGroup[];
}

export default function SearchFilterBar({
  initialLocation,
  initialQuery,
  filters,
  groups,
}: SearchFilterBarProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [location, setLocation] = useState(initialLocation);
  const [query, setQuery] = useState(initialQuery);
  // Mobile-only disclosure; the panel is always visible from `md` up.
  const [panelOpen, setPanelOpen] = useState(false);

  const activeCount = countFilters(filters);

  function navigate(next: SearchFilters) {
    startTransition(() => {
      router.push(buildSearchHref({ location, query, filters: next }));
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    navigate(filters);
  }

  function handleToggle(param: FilterParam, name: string) {
    navigate(toggleFilter(filters, param, name));
  }

  return (
    <div>
      <form
        onSubmit={handleSubmit}
        className="mx-auto flex max-w-3xl flex-col gap-3 rounded-brand-card border border-brand-border bg-white p-3 shadow-brand-card sm:flex-row sm:items-center sm:gap-2"
      >
        <label className="flex flex-1 items-center gap-2 rounded-brand-control px-3 py-2.5 sm:border-r sm:border-brand-border">
          <LocationPinIcon className="h-5 w-5 shrink-0 text-brand-ink-subtle" />
          <span className="sr-only">Location</span>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="City, ZIP, or neighborhood"
            className="w-full min-w-0 border-0 bg-transparent text-sm text-brand-ink placeholder:text-brand-placeholder focus:outline-none"
          />
        </label>

        <label className="flex flex-1 items-center gap-2 rounded-brand-control px-3 py-2.5">
          <SearchIcon className="h-5 w-5 shrink-0 text-brand-ink-subtle" />
          <span className="sr-only">Cuisine, dish, or restaurant</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cuisine, dish, or restaurant"
            className="w-full min-w-0 border-0 bg-transparent text-sm text-brand-ink placeholder:text-brand-placeholder focus:outline-none"
          />
        </label>

        <button
          type="submit"
          className="flex min-h-[44px] items-center justify-center gap-2 whitespace-nowrap rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover"
        >
          <SearchIcon className="h-4 w-4" />
          Search
        </button>
      </form>

      <div
        className={`mx-auto mt-4 max-w-3xl space-y-3 transition-opacity ${
          isPending ? "opacity-60" : ""
        }`}
        aria-busy={isPending}
      >
        {groups.length > 0 && (
          <button
            type="button"
            aria-expanded={panelOpen}
            aria-controls="tag-filter-panel"
            onClick={() => setPanelOpen((open) => !open)}
            className="flex min-h-[44px] w-full items-center justify-between rounded-brand-control border border-brand-border bg-white px-4 text-sm font-semibold text-brand-ink md:hidden"
          >
            <span>Filters{activeCount > 0 ? ` (${activeCount})` : ""}</span>
            <span aria-hidden="true" className="text-brand-ink-subtle">
              {panelOpen ? "−" : "+"}
            </span>
          </button>
        )}

        <ActiveFilters
          groups={groups}
          filters={filters}
          onRemove={handleToggle}
          onClearAll={() => navigate(EMPTY_FILTERS)}
        />

        {groups.length > 0 && (
          <div id="tag-filter-panel" className={panelOpen ? "block" : "hidden md:block"}>
            <TagFilterPanel groups={groups} filters={filters} onToggle={handleToggle} />
          </div>
        )}
      </div>
    </div>
  );
}
