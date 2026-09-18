"use client";

// Homepage hero: badge, headline, subheading, search bar, cuisine chips.
//
// Client component because the search bar and chip selection are
// interactive (frontend/CLAUDE.md's SSR rule targets the *listing/search
// results* pages, not this bar itself — the search results page stays SSR;
// this only builds the query string and navigates there, it never fetches).
//
// The badge deliberately carries no restaurant count — there's no cheap way
// to get a real live number on the homepage without an extra fetch, and the
// task is explicit: never show a fabricated number as if it were real.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CUISINE_FILTER_CHIPS } from "@/lib/constants/cuisineFilters";
import { LocationPinIcon, SearchIcon } from "@/components/ui/icons";

export default function Hero() {
  const router = useRouter();
  const [location, setLocation] = useState("");
  const [query, setQuery] = useState("");
  const [selectedCuisine, setSelectedCuisine] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (location.trim()) params.set("location", location.trim());
    if (query.trim()) params.set("q", query.trim());
    if (selectedCuisine) params.set("cuisine", selectedCuisine);
    const qs = params.toString();
    router.push(qs ? `/search?${qs}` : "/search");
  }

  return (
    <section className="bg-brand-bg">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="font-display text-3xl font-bold leading-tight text-brand-ink sm:text-4xl md:text-5xl">
            Discover your taste.
          </h1>

          <p className="mt-4 text-base text-brand-ink-muted sm:text-lg">
            Satisfy every craving — discover restaurants near you, filtered
            by region, diet, and what&apos;s open right now.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="mx-auto mt-8 flex max-w-3xl flex-col gap-3 rounded-brand-card border border-brand-border bg-white p-3 shadow-brand-card sm:flex-row sm:items-center sm:gap-2"
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
          role="group"
          aria-label="Filter by cuisine"
          className="mx-auto mt-5 flex max-w-3xl flex-wrap justify-center gap-2"
        >
          {CUISINE_FILTER_CHIPS.map((chip) => {
            const isSelected =
              chip.name === selectedCuisine ||
              (chip.name === null && selectedCuisine === null);
            return (
              <button
                key={chip.display_name}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelectedCuisine(chip.name)}
                className={
                  isSelected
                    ? "min-h-[36px] rounded-brand-pill bg-brand-ink px-4 text-sm font-medium text-brand-bg transition"
                    : "min-h-[36px] rounded-brand-pill bg-brand-chip px-4 text-sm font-medium text-brand-chip-ink transition hover:bg-brand-chip/80"
                }
              >
                {chip.display_name}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
