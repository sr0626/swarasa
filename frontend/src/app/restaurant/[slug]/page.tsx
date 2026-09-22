// Public restaurant listing page — SSR + schema.org JSON-LD, per
// frontend/CLAUDE.md's "SSR listing page (SEO critical)" and "schema.org
// Restaurant markup (required on every listing page)" Key Patterns.
//
// The SEO plumbing (SSR, generateMetadata, JSON-LD, canonical, 404
// handling) predates this change and is untouched. Layout (redesigned per
// owner feedback): a two-column page -- photo-carousel hero + About on the
// left, one compact sticky info card (status, address/directions, phone,
// website, weekly hours) plus the unclaimed-listing claim CTA on the right;
// single column on mobile. See the components in `components/restaurant/`.
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
import { getLocationById, getLocationManagers } from "@/lib/api/locations";
import { getServerSession } from "@/lib/auth/session";
import RestaurantHero from "@/components/restaurant/RestaurantHero";
import RestaurantInfoCard from "@/components/restaurant/RestaurantInfoCard";
import ClaimCTA from "@/components/restaurant/ClaimCTA";
import RestaurantAbout from "@/components/restaurant/RestaurantAbout";
import EditListingBar from "@/components/restaurant/EditListingBar";
import RestaurantBackLink from "@/components/restaurant/RestaurantBackLink";
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

/**
 * Can the signed-in visitor edit this listing? Uses the same access probe
 * the location editor itself uses as its gate (`GET /locations/{id}/managers`
 * -- owner of the parent brand, admin, or an actively assigned manager;
 * docs/API_CONTRACTS.md "Location Managers"), so this page never decides
 * permissions on its own: whatever the editor would allow, and only that,
 * shows the link. Any failure (403, network) is "no" -- the link is a
 * convenience, never a security boundary; the backend re-validates every
 * write regardless.
 */
async function canEditListing(location: LocationDetail | null): Promise<boolean> {
  if (!location) return false;
  const session = await getServerSession();
  if (!session || !["owner", "manager", "admin"].includes(session.role)) return false;
  try {
    await getLocationManagers(location.id, {}, session.accessToken);
    return true;
  } catch {
    return false;
  }
}

export default async function RestaurantPage({ params }: RestaurantPageProps) {
  const data = await loadRestaurantPageData(params.slug);
  if (!data) {
    notFound();
  }
  const { restaurant, location } = data;
  const canEdit = await canEditListing(location);
  const session = await getServerSession();
  const isAdmin = session?.role === "admin";

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

        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <div className="mb-2">
            <RestaurantBackLink />
          </div>

          {canEdit && location && <EditListingBar locationId={location.id} />}

          {/* Two columns from lg up; a single column below that. DOM order is
              the mobile order: hero -> sidebar (claim + info card) -> main
              content. On lg the sidebar sits in the right column, spanning
              both rows and sticky, while hero + main content stack in the
              left column. */}
          <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_1fr] lg:gap-x-10">
            <div className="lg:col-start-1 lg:row-start-1">
              <RestaurantHero restaurant={restaurant} location={location} />
            </div>

            <aside
              aria-label="Restaurant information"
              className="flex flex-col gap-5 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:sticky lg:top-6 lg:self-start"
            >
              {!restaurant.is_claimed && !restaurant.has_pending_claim && (
                <ClaimCTA brandId={restaurant.id} />
              )}
              {!restaurant.is_claimed && restaurant.has_pending_claim && isAdmin && (
                <Link
                  href="/admin/claims"
                  className="inline-flex items-center self-start rounded-brand-pill bg-brand-chip px-3 py-1.5 text-xs font-semibold text-brand-ink"
                >
                  Claim pending review
                </Link>
              )}
              <RestaurantInfoCard location={location} website={restaurant.website} />
            </aside>

            <div className="flex min-w-0 flex-col gap-8 lg:col-start-1 lg:row-start-2">
              {restaurant.description && (
                <section aria-labelledby="about-heading">
                  <h2 id="about-heading" className="font-display text-xl font-bold text-brand-ink">
                    About
                  </h2>
                  <p className="mt-2 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-brand-ink-muted sm:text-base">
                    {restaurant.description}
                  </p>
                </section>
              )}

              {/* Owner/manager-authored "we specialize in ..." content
                  (location.about / location.specialties, editable in the
                  portal). Renders nothing when both are empty. */}
              {location && (
                <RestaurantAbout about={location.about} specialties={location.specialties} />
              )}

              {/* INSERTION POINT (unused): future Deals section (Phase 2).
                  Do not add placeholder or fake deals; render nothing when
                  the location has none. */}

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
        </div>
      </main>
    </>
  );
}
