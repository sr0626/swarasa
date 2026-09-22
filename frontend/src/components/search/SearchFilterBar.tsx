"use client";

// Search results page filter bar — same visual form as the homepage
// Hero's search bar (location + cuisine/dish/restaurant text, "Spice
// Market" tokens) but wired to actually drive this page's results instead
// of just navigating to it.
//
// Fine-grained tag filters live in a "Filters" dropdown button placed
// BEFORE the inputs in the bar row (2026-09-19 user feedback: the always-
// visible grouped panel pushed results far down the page). The panel is
// a non-modal disclosure: an anchored popover (max-height + internal scroll)
// from `sm` up, a full-width sheet under the bar on mobile. Selected tags are
// echoed as compact removable chips in one wrapping row right under the bar
// so results start immediately below.
//
// Filter state lives in the URL (repeated params, see lib/search/filters.ts)
// — the `filters` prop is parsed server-side from `searchParams`, this
// component is the only place that navigates. Filters APPLY ON EACH TOGGLE
// (soft `router.push`, no Apply button): the page is SSR + URL-driven, so
// every toggle is just a new URL, results re-render server-side, the panel
// stays open (this component stays mounted) so several tags can be picked in
// a row, and the URL is always shareable. Every filter change omits `page`,
// i.e. resets pagination to page 1.
//
// `q` (the "Cuisine, dish, or restaurant" box) IS sent to the API as the
// free-text `q` param (2026-09-19): it matches restaurant names and cuisine
// tags. `location` is read from the URL by this component only as text (for
// the input box and the URL); it is never sent to the API as text -- the
// server component (SearchResults) geocodes it to lat/lng server-side
// before calling GET /search, so this component doesn't need to know
// anything about that.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { FilterIcon, LocationPinIcon, SearchIcon, XIcon } from "@/components/ui/icons";
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

const PANEL_ID = "tag-filter-panel";

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
  const [panelOpen, setPanelOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const activeCount = countFilters(filters);

  // Close on Escape (focus returns to the trigger) and on outside pointer
  // down; move focus into the panel when it opens.
  useEffect(() => {
    if (!panelOpen) return;
    panelRef.current?.focus({ preventScroll: true });

    function handlePointerDown(e: MouseEvent | TouchEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setPanelOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setPanelOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [panelOpen]);

  function closePanel() {
    setPanelOpen(false);
    triggerRef.current?.focus();
  }

  function navigate(next: SearchFilters) {
    startTransition(() => {
      // scroll:false — the bar is already at the top of the page and an
      // open panel shouldn't jump when a toggle re-renders the results.
      router.push(buildSearchHref({ location, query, filters: next }), { scroll: false });
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPanelOpen(false);
    navigate(filters);
  }

  function handleToggle(param: FilterParam, name: string) {
    navigate(toggleFilter(filters, param, name));
  }

  return (
    <div>
      <div ref={containerRef} className="relative mx-auto max-w-3xl">
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 rounded-brand-card border border-brand-border bg-white p-3 shadow-brand-card sm:flex-row sm:items-center sm:gap-2"
        >
          {groups.length > 0 && (
            <button
              ref={triggerRef}
              type="button"
              aria-expanded={panelOpen}
              aria-controls={PANEL_ID}
              onClick={() => setPanelOpen((open) => !open)}
              className="flex min-h-[44px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-brand-control border border-brand-border bg-white px-4 text-sm font-semibold text-brand-ink transition hover:bg-brand-chip"
            >
              <FilterIcon className="h-4 w-4" />
              Filters
              {activeCount > 0 && (
                <span
                  className="flex h-5 min-w-[20px] items-center justify-center rounded-brand-pill bg-brand-accent px-1.5 text-xs font-semibold text-white"
                  aria-label={`${activeCount} active`}
                >
                  {activeCount}
                </span>
              )}
            </button>
          )}

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

        {groups.length > 0 && (
          // Kept mounted (just hidden) so aria-controls always resolves and
          // "Show all" expansions survive close/reopen. Full-width bottom
          // sheet on mobile (so Done/Clear are always on-screen); popover
          // anchored under the bar from `sm` up.
          <div
            id={PANEL_ID}
            ref={panelRef}
            role="region"
            aria-label="Filter restaurants by tag"
            tabIndex={-1}
            className={`fixed inset-x-0 bottom-0 z-30 max-h-[80vh] flex-col overflow-hidden rounded-t-brand-card border border-brand-border bg-white shadow-brand-card-hover focus:outline-none sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-2 sm:max-h-[70vh] sm:w-[34rem] sm:rounded-brand-card ${
              panelOpen ? "flex" : "hidden"
            } ${isPending ? "opacity-80" : ""}`}
          >
            <div className="flex items-center justify-between border-b border-brand-border py-1 pl-4 pr-2">
              <h2 className="font-display text-base font-semibold text-brand-ink">Filters</h2>
              <button
                type="button"
                onClick={closePanel}
                aria-label="Close filters"
                className="flex h-11 w-11 items-center justify-center rounded-brand-control text-brand-ink-subtle hover:bg-brand-chip"
              >
                <XIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <TagFilterPanel groups={groups} filters={filters} onToggle={handleToggle} />
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-brand-border px-4 py-2">
              <button
                type="button"
                onClick={() => navigate(EMPTY_FILTERS)}
                disabled={activeCount === 0}
                className="min-h-[44px] px-2 text-sm font-semibold text-brand-accent underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-brand-ink-subtle disabled:no-underline"
              >
                Clear all
              </button>
              <button
                type="button"
                onClick={closePanel}
                className="min-h-[44px] rounded-brand-control bg-brand-ink px-6 text-sm font-semibold text-brand-bg transition hover:opacity-90"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>

      {activeCount > 0 && (
        <div
          className={`mx-auto mt-3 max-w-3xl transition-opacity ${isPending ? "opacity-60" : ""}`}
          aria-busy={isPending}
        >
          <ActiveFilters
            groups={groups}
            filters={filters}
            onRemove={handleToggle}
            onClearAll={() => navigate(EMPTY_FILTERS)}
          />
        </div>
      )}
    </div>
  );
}
