// Server component that fetches the real search results grid via the
// typed GET /search client, same graceful-degradation posture as the
// homepage's `PopularNearYou` (frontend/CLAUDE.md "ALWAYS handle API
// errors gracefully" / no fabricated restaurant data ever).
//
// The `location` text box (city/ZIP/neighborhood) is geocoded here,
// server-side, before calling GET /search — never client-side, and never
// persisted beyond this request (lib/geocode's Census-then-Nominatim
// chain, same one PR #144 built for owner address entry, reused as-is via
// `geocodeSearchLocation`). A non-empty location that fails to geocode is
// NOT silently dropped: that would fall back to the backend's Dallas-area
// default and show unrelated results for a typo or a place with no
// restaurants, so it renders a "no results for that place" empty state
// instead. An empty location is unchanged — no lat/lng sent, backend
// default area applies.
import { searchRestaurants } from "@/lib/api/search";
import RestaurantCard from "@/components/listing/RestaurantCard";
import InfoPanel from "@/components/ui/InfoPanel";
import Pagination from "@/components/search/Pagination";
import { buildSearchHref, countFilters, type SearchFilters } from "@/lib/search/filters";
import { geocodeSearchLocation } from "@/lib/geocode";
import { getServerSession } from "@/lib/auth/session";
import { getViewerFollowState } from "@/lib/follow/viewerFollowState";

/** Matches docs/API_CONTRACTS.md "GET /search" default page_size. */
export const SEARCH_PAGE_SIZE = 20;

interface SearchResultsProps {
  filters: SearchFilters;
  page: number;
  /** Geocoded below (when non-empty) and also carried through to
   * pagination links as the raw text. */
  location: string;
  query: string;
}

export default async function SearchResults({ filters, page, location, query }: SearchResultsProps) {
  const trimmedLocation = location.trim();
  let lat: number | undefined;
  let lng: number | undefined;

  if (trimmedLocation) {
    const geocoded = await geocodeSearchLocation(trimmedLocation);
    if (!geocoded) {
      return (
        <InfoPanel
          title={`We couldn't find "${trimmedLocation}"`}
          body="Check the spelling, try a nearby city or ZIP code, or clear the location box to browse everything nearby."
        />
      );
    }
    lat = geocoded.latitude;
    lng = geocoded.longitude;
  }

  // Session is resolved first so a signed-in registered_user's token can ride
  // along on the search itself: the backend records that search in their
  // activity history (docs/API_CONTRACTS.md "Activity tracking"). Everyone
  // else calls it anonymously, exactly as before.
  const session = await getServerSession();
  const trackedToken = session?.role === "registered_user" ? session.accessToken : undefined;

  // Resolved once per results render, not per tile — see
  // lib/follow/viewerFollowState.ts for the client-side-match approach and
  // its documented limitation.
  const [data, followState] = await Promise.all([
    searchRestaurants({
      lat,
      lng,
      // Empty facets are omitted entirely (never sent as `cuisine[]=`).
      cuisine: filters.cuisine.length ? filters.cuisine : undefined,
      dietary: filters.dietary.length ? filters.dietary : undefined,
      type: filters.type.length ? filters.type : undefined,
      // Free-text box: matches restaurant name or cuisine tag (backend `q`).
      q: query.trim() || undefined,
      has_deals_today: filters.dealsToday || undefined,
      // Typed location text, for the viewer's search history only — sent
      // only when tracking (keeps anonymous requests on the shared cache key).
      loc: trackedToken ? trimmedLocation || undefined : undefined,
      page,
      page_size: SEARCH_PAGE_SIZE,
    }, trackedToken).catch(() => null),
    getViewerFollowState(session),
  ]);

  if (!data) {
    return (
      <InfoPanel
        title="We can't load restaurants right now"
        body="Our search service is still coming online. Check back shortly, or try again in a bit."
      />
    );
  }

  if (data.results.length === 0) {
    return (
      <InfoPanel
        title="No restaurants match your search"
        body={
          countFilters(filters) > 0
            ? "No restaurants have all of these tags yet. Try removing a filter, or use Clear all to see everything nearby."
            : "No restaurants are listed here yet. Check back soon."
        }
      />
    );
  }

  // Exact current results URL (same helper Pagination.tsx uses to build
  // page links) — the "come back here" destination for a signed-out
  // follow click, filters/page/location/query and all.
  const currentPath = buildSearchHref({ location, query, filters, page });

  return (
    <div>
      <p className="mb-4 text-sm text-brand-ink-muted">
        {data.total} restaurant{data.total === 1 ? "" : "s"} found
      </p>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {data.results.map((item) => (
          <RestaurantCard
            key={item.brand_id}
            item={item}
            showFollowButton={followState.showFollowButton}
            isRegisteredUser={followState.isRegisteredUser}
            isFollowed={followState.followedBrandIds.has(item.brand_id)}
            currentPath={currentPath}
            clickSource="search_results"
          />
        ))}
      </div>

      <Pagination
        page={data.page}
        pageSize={data.page_size}
        total={data.total}
        location={location}
        query={query}
        filters={filters}
      />
    </div>
  );
}
