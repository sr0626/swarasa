// Default state of /search when the URL carries no search criteria at all
// (lib/search/filters.ts `hasSearchCriteria`). The homepage already shows
// "Popular near you", so /search starts empty: a prompt plus a few quick
// starts that are plain <Link>s to real, crawlable, SSR'd result URLs (no
// client JS, no backend call). Server component.
import Link from "next/link";
import { CUISINE_FILTER_CHIPS } from "@/lib/constants/cuisineFilters";
import {
  buildSearchHref,
  DEALS_TODAY_PARAM,
  EMPTY_FILTERS,
  paramForCategory,
  toggleFilter,
} from "@/lib/search/filters";

const CHIP_CLASS =
  "flex min-h-[44px] items-center rounded-brand-pill bg-brand-chip px-4 text-sm font-medium text-brand-chip-ink transition hover:bg-brand-chip/80 sm:min-h-[36px]";

export default function SearchEmptyState() {
  // Skips the synthetic "All Cuisines" chip (no tag to filter on).
  const cuisineChips = CUISINE_FILTER_CHIPS.flatMap((chip) =>
    chip.name !== null && chip.category !== null
      ? [{ name: chip.name, label: chip.display_name, param: paramForCategory(chip.category) }]
      : []
  );
  return (
    <div className="rounded-brand-card border border-dashed border-brand-border bg-white px-6 py-12 text-center">
      <p className="font-display text-base font-semibold text-brand-ink">
        Search by restaurant, cuisine or city
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm text-brand-ink-muted">
        Type a name or dish above, pick a location, or open Filters. Or start with one of these:
      </p>

      <div
        role="group"
        aria-label="Quick searches"
        className="mx-auto mt-5 flex max-w-xl flex-wrap justify-center gap-2"
      >
        {cuisineChips.map((chip) => (
          <Link
            key={chip.name}
            href={buildSearchHref({ filters: toggleFilter(EMPTY_FILTERS, chip.param, chip.name) })}
            className={CHIP_CLASS}
          >
            {chip.label}
          </Link>
        ))}
        <Link href={`/search?${DEALS_TODAY_PARAM}=true`} className={CHIP_CLASS}>
          Deals today
        </Link>
      </div>

      <p className="mt-6 text-sm text-brand-ink-muted">
        Just browsing?{" "}
        <Link href="/" className="font-semibold text-brand-accent underline-offset-2 hover:underline">
          See popular near you
        </Link>
      </p>
    </div>
  );
}
