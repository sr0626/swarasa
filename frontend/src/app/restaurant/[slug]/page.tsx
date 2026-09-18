// Public restaurant listing page — SSR + schema.org JSON-LD, per
// frontend/CLAUDE.md's "SSR listing page (SEO critical)" and "schema.org
// Restaurant markup (required on every listing page)" Key Patterns.
//
// The SEO plumbing (SSR, generateMetadata, JSON-LD, canonical, 404
// handling) predates this change and is untouched; this pass adds the
// real visual UI on top of it (hero, hours, gallery, unclaimed CTA) —
// see the components in `components/restaurant/`.
//
// No full-menu section here: `docs/API_CONTRACTS.md` has no menu endpoint
// in Phase 1 ("Full menu with prices is not in this response — no menu
// endpoint exists in Phase 1"), and root CLAUDE.md's DECISIONS.md-linked
// "Full menu with prices moved to free tier" note describes a *future*
// free-tier behavior, not a data model that exists yet. Building menu UI
// with nothing behind it would mean fabricating content, which the task
// brief explicitly rules out — this is deferred to whenever Phase 2's
// menu data model lands, called out again in the PR description.
//
// FLAGGED JUDGMENT CALL (see final report): frontend/CLAUDE.md's example
// schema builds address/telephone/openingHours straight off the fetched
// restaurant, but docs/API_CONTRACTS.md splits that data across
// restaurant_brand (name, description, cuisine_tags) and
// restaurant_location (address, phone, hours). This page fetches the
// brand by slug, then its first/primary location's full detail (hours,
// gallery, cover photo), and merges both into the JSON-LD — a brand with
// zero locations yet renders schema without an address rather than
// failing.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiError } from "@/lib/api/client";
import { getRestaurantBySlug, getRestaurantLocations } from "@/lib/api/restaurants";
import { getLocationById } from "@/lib/api/locations";
import RestaurantHero from "@/components/restaurant/RestaurantHero";
import RestaurantHours from "@/components/restaurant/RestaurantHours";
import RestaurantGallery from "@/components/restaurant/RestaurantGallery";
import ClaimCTA from "@/components/restaurant/ClaimCTA";
import TopBar from "@/components/home/TopBar";
import type { LocationDetail } from "@/types/location";
import type { RestaurantBrand } from "@/types/restaurant";

interface RestaurantPageProps {
  params: { slug: string };
}

interface RestaurantPageData {
  restaurant: RestaurantBrand;
  /** Full detail (hours, gallery, cover photo) for the brand's primary
   * location — null when the brand has no locations yet. */
  location: LocationDetail | null;
}

async function loadRestaurantPageData(slug: string): Promise<RestaurantPageData | null> {
  let restaurant: RestaurantBrand;
  try {
    restaurant = await getRestaurantBySlug(slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }

  const locations = await getRestaurantLocations(restaurant.id, { page: 1, page_size: 1 });
  const primaryLocationSummary = locations.results[0] ?? null;
  const location = primaryLocationSummary
    ? await getLocationById(primaryLocationSummary.id)
    : null;

  return { restaurant, location };
}

export async function generateMetadata({ params }: RestaurantPageProps): Promise<Metadata> {
  const data = await loadRestaurantPageData(params.slug);
  if (!data) {
    return { title: "Restaurant Not Found" };
  }
  const { restaurant, location } = data;

  // frontend/CLAUDE.md SEO Requirements meta title format:
  // "{Restaurant Name} — Indian Restaurant in {City}, {State}"
  const cityState = location ? ` in ${location.city}, ${location.state}` : "";

  return {
    title: `${restaurant.name} — Indian Restaurant${cityState}`,
    // "first 150 chars of restaurant `about` field" — description here is
    // the closest documented equivalent (no separate `about` field on
    // RestaurantBrand per docs/API_CONTRACTS.md). Nullable in practice
    // (found live 2026-09-18: every CSV-imported restaurant has none) --
    // falls back to a generic line rather than crashing.
    description: restaurant.description
      ? restaurant.description.slice(0, 150)
      : `${restaurant.name} — Indian Restaurant${cityState} on Swarasa.`,
    alternates: {
      canonical: `/restaurant/${restaurant.slug}`,
    },
  };
}

/** schema.org day abbreviations, indexed the same 0=Monday..6=Sunday way
 * as `restaurant_hours.day_of_week` (docs/DATA_MODEL.md). */
const SCHEMA_DAY_ABBREVIATIONS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** Builds schema.org `openingHours` strings (e.g. "Mo 11:00-22:00") from
 * the real `hours` rows — omits closed/unknown days rather than guessing,
 * matching frontend/CLAUDE.md's "schema.org Restaurant markup" pattern. */
function buildOpeningHoursSchema(location: LocationDetail): string[] {
  return location.hours
    .filter((hour) => hour.is_closed === false && hour.open_time && hour.close_time)
    .map((hour) => `${SCHEMA_DAY_ABBREVIATIONS[hour.day_of_week]} ${hour.open_time!.slice(0, 5)}-${hour.close_time!.slice(0, 5)}`);
}

function buildRestaurantSchema(restaurant: RestaurantBrand, location: LocationDetail | null) {
  return {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: restaurant.name,
    servesCuisine: restaurant.cuisine_tags.map((tag) => tag.display_name),
    ...(location
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: location.address_line1,
            addressLocality: location.city,
            addressRegion: location.state,
            postalCode: location.postal_code,
          },
          telephone: location.phone,
          openingHours: buildOpeningHoursSchema(location),
        }
      : {}),
  };
}

export default async function RestaurantPage({ params }: RestaurantPageProps) {
  const data = await loadRestaurantPageData(params.slug);
  if (!data) {
    notFound();
  }
  const { restaurant, location } = data;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(buildRestaurantSchema(restaurant, location)),
        }}
      />
      <main className="min-h-screen bg-brand-bg">
        <TopBar />

        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
          <RestaurantHero restaurant={restaurant} location={location} />

          <div className="mt-8 flex flex-col gap-8">
            {!restaurant.is_claimed && <ClaimCTA brandId={restaurant.id} />}

            {location && location.hours.length > 0 && <RestaurantHours hours={location.hours} />}

            {location && <RestaurantGallery photos={location.gallery_photos} />}

            <div className="flex flex-col items-start gap-3 rounded-brand-card border border-brand-border bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-brand-ink-muted">
                See something wrong or out of date on this listing?
              </p>
              <Link
                href={`/restaurant/${restaurant.slug}/report`}
                className="flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-brand-pill border border-brand-ink px-5 text-sm font-semibold text-brand-ink transition hover:bg-brand-chip"
              >
                Report a problem
              </Link>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
