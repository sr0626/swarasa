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
// Menu: the public, free-tier menu (`GET /locations/{id}/menu`, grouped with
// group descriptions, prices/sizes, optional photos) renders between "About"
// and the report box via `RestaurantMenu`, and is described in the page's
// JSON-LD as `hasMenu` (names/descriptions only — free-text prices can't be
// expressed as a schema.org Offer). A menu that fails to load, or is empty,
// simply doesn't render — it never breaks the listing page.
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
import { getLocationMenu } from "@/lib/api/menu";
import { buildMenuSchema, jsonLdString } from "@/lib/menu/jsonld";
import { getServerSession } from "@/lib/auth/session";
import { getViewerFollowState } from "@/lib/follow/viewerFollowState";
import RestaurantHero from "@/components/restaurant/RestaurantHero";
import RestaurantInfoCard from "@/components/restaurant/RestaurantInfoCard";
import ClaimCTA from "@/components/restaurant/ClaimCTA";
import RestaurantAbout from "@/components/restaurant/RestaurantAbout";
import RestaurantDeals from "@/components/restaurant/RestaurantDeals";
import RestaurantMenu from "@/components/restaurant/RestaurantMenu";
import RestaurantUpcomingDeals from "@/components/restaurant/RestaurantUpcomingDeals";
import EditListingBar from "@/components/restaurant/EditListingBar";
import RestaurantBackLink from "@/components/restaurant/RestaurantBackLink";
import TopBar from "@/components/home/TopBar";
import type { Session } from "@/types/auth";
import type { LocationDetail } from "@/types/location";
import type { MenuResponse } from "@/types/menu";
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

/**
 * `accessToken` is passed through to `getLocationById` so a signed-in
 * caller's own deal-content access (per `deal_service.
 * caller_may_view_deal_content_for_location`) is correctly reflected in
 * `location.deals_today` — omitted entirely (never even an anonymous
 * empty-string) for `generateMetadata`, which has no viewer-specific
 * content to render and shouldn't pay for a session lookup it doesn't
 * need. Passing a token here does NOT widen who can see a hidden
 * (non-`active`) location: that's a separate, role-checked gate
 * (`_caller_may_view_hidden_location`) that a random signed-in
 * registered_user's token still fails, same as before this change.
 */
async function loadRestaurantPageData(
  slug: string,
  accessToken?: string
): Promise<RestaurantPageData | null> {
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
    ? await getLocationById(primaryLocationSummary.id, accessToken)
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
  // "{Restaurant Name} — Desi Restaurant in {City}, {State}"
  const cityState = location ? ` in ${location.city}, ${location.state}` : "";

  return {
    title: `${restaurant.name} — Desi Restaurant${cityState}`,
    // "first 150 chars of restaurant `about` field" — description here is
    // the closest documented equivalent (no separate `about` field on
    // RestaurantBrand per docs/API_CONTRACTS.md). Nullable in practice
    // (found live 2026-09-18: every CSV-imported restaurant has none) --
    // falls back to a generic line rather than crashing.
    description: restaurant.description
      ? restaurant.description.slice(0, 150)
      : `${restaurant.name} — Desi Restaurant${cityState} on Swarasa.`,
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

/** The public menu, or null when it can't be loaded — a menu problem must
 * never take the listing page down. The token (when signed in) only matters
 * for the hidden-location owner-preview case, exactly like the location
 * read; anonymous reads use the 60s-cached public GET. */
async function loadMenuSafely(
  location: LocationDetail | null,
  accessToken?: string
): Promise<MenuResponse | null> {
  if (!location) return null;
  try {
    return await getLocationMenu(location.id, accessToken);
  } catch {
    return null;
  }
}

function buildRestaurantSchema(
  restaurant: RestaurantBrand,
  location: LocationDetail | null,
  menu: MenuResponse | null
) {
  const hasMenu = buildMenuSchema(menu);
  return {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: restaurant.name,
    servesCuisine: restaurant.cuisine_tags.map((tag) => tag.display_name),
    ...(hasMenu ? { hasMenu } : {}),
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
async function canEditListing(location: LocationDetail | null, session: Session | null): Promise<boolean> {
  if (!location) return false;
  if (!session || !["owner", "manager", "admin"].includes(session.role)) return false;
  try {
    await getLocationManagers(location.id, {}, session.accessToken);
    return true;
  } catch {
    return false;
  }
}

export default async function RestaurantPage({ params }: RestaurantPageProps) {
  // Fetched once, up front, and threaded through everywhere below that
  // needs viewer identity (deal content gating, edit-access probe, follow
  // state) — previously `canEditListing` re-fetched its own session
  // independently of this same call a few lines down.
  const session = await getServerSession();
  const data = await loadRestaurantPageData(params.slug, session?.accessToken);
  if (!data) {
    notFound();
  }
  const { restaurant, location } = data;
  const canEdit = await canEditListing(location, session);
  const isAdmin = session?.role === "admin";
  const followState = await getViewerFollowState(session);
  const menu = await loadMenuSafely(location, session?.accessToken);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          // `jsonLdString` (not bare JSON.stringify): owner-authored menu
          // text is in this payload, so `<` is \u-escaped and a stray
          // `</script>` in a dish name can't break out of the tag.
          __html: jsonLdString(buildRestaurantSchema(restaurant, location, menu)),
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
              <RestaurantHero
                restaurant={restaurant}
                location={location}
                showFollowButton={followState.showFollowButton}
                isRegisteredUser={followState.isRegisteredUser}
                isFollowed={followState.followedBrandIds.has(restaurant.id)}
                currentPath={`/restaurant/${restaurant.slug}`}
                ownerPreview={canEdit}
              />
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
              {/* Near the top of the main column, right under the hero —
                  task requirement (2026-09-23). Content gating already
                  happened server-side in `loadRestaurantPageData` (which
                  location.deals_today is) — see RestaurantDeals.tsx. */}
              {location && (
                <RestaurantDeals
                  hasDealToday={location.has_deal_today}
                  dealsToday={location.deals_today}
                  // Signed-out visitors only (no session) get the sign-in link.
                  signInReturnPath={session ? undefined : `/restaurant/${restaurant.slug}`}
                />
              )}

              {/* The location's OTHER active deals (other weekdays / future
                  start). Same server-side content gate as deals_today —
                  null for signed-out viewers, in which case this renders
                  nothing (no heading, no count). */}
              {location && (
                <RestaurantUpcomingDeals upcomingDeals={location.upcoming_deals} />
              )}

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

              {/* Public, free-tier menu (renders nothing when empty). */}
              <RestaurantMenu menu={menu} />

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
