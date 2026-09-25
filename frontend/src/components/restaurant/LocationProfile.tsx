// The public LOCATION profile: everything one restaurant location shows —
// photo hero + name + Deals/Menu/Hours jump links, today's deals + "More deals
// & specials", about, menu, the Details card (status, address + Get
// directions / View menu, phone, website, weekly hours), claim CTA, edit bar,
// follow heart, report link. Shared by the two routes that render a location:
// `/restaurant/[brandSlug]` (a single-location brand, at the short brand URL)
// and `/restaurant/[brandSlug]/[locationSlug]`. A Server Component — the
// pages own data loading, metadata and JSON-LD; this only lays out what they
// hand it.
//
// Layout (owner feedback): a two-column page -- photo-carousel hero + main
// content on the left, one compact sticky info card on the right; single
// column on mobile. `location` is null for a brand with no active location
// (brand-only page: name, description, claim CTA, website).
import Link from "next/link";
import ClaimCTA from "@/components/restaurant/ClaimCTA";
import EditListingBar from "@/components/restaurant/EditListingBar";
import RestaurantAbout from "@/components/restaurant/RestaurantAbout";
import RestaurantBackLink from "@/components/restaurant/RestaurantBackLink";
import RestaurantDeals from "@/components/restaurant/RestaurantDeals";
import RestaurantHero from "@/components/restaurant/RestaurantHero";
import RestaurantInfoCard from "@/components/restaurant/RestaurantInfoCard";
import RestaurantMenu from "@/components/restaurant/RestaurantMenu";
import RestaurantUpcomingDeals from "@/components/restaurant/RestaurantUpcomingDeals";
import TopBar from "@/components/home/TopBar";
import { isMenuEmpty } from "@/lib/menu/format";
import {
  buildJumpLinks,
  hasDealsSection,
  hasKnownHours,
} from "@/lib/restaurant/jumpLinks";
import { brandHref, reportHref } from "@/lib/restaurant/urls";
import type { ViewerFollowState } from "@/lib/follow/viewerFollowState";
import type { Session } from "@/types/auth";
import type { LocationDetail } from "@/types/location";
import type { MenuResponse } from "@/types/menu";
import type { RestaurantBrand } from "@/types/restaurant";

interface LocationProfileProps {
  restaurant: RestaurantBrand;
  /** Full detail of the location being shown; null = the brand has no active location. */
  location: LocationDetail | null;
  menu: MenuResponse | null;
  session: Session | null;
  /** Owner of the brand / assigned manager / admin (`canEditListing`). */
  canEdit: boolean;
  followState: ViewerFollowState;
  /** The path being rendered (short brand URL or long location URL) — the sign-in return path. */
  currentPath: string;
  /** Multi-location brands only: names the branch under the brand name and adds an
   * "All locations" link back to the brand landing page. */
  branchLabel?: string | null;
  showAllLocationsLink?: boolean;
}

export default function LocationProfile({
  restaurant,
  location,
  menu,
  session,
  canEdit,
  followState,
  currentPath,
  branchLabel = null,
  showAllLocationsLink = false,
}: LocationProfileProps) {
  const isAdmin = session?.role === "admin";
  const hasMenu = menu !== null && !isMenuEmpty(menu);
  const jumpLinks = location
    ? buildJumpLinks({
        deals: hasDealsSection(location),
        menu: hasMenu,
        hours: hasKnownHours(location.hours),
      })
    : [];

  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-2 flex flex-wrap items-center gap-x-4">
          <RestaurantBackLink />
          {showAllLocationsLink && (
            <Link
              href={brandHref(restaurant.slug)}
              className="inline-flex min-h-[44px] items-center rounded-brand-pill px-2 text-sm font-semibold text-brand-accent hover:text-brand-accent-hover"
            >
              All {restaurant.name} locations
            </Link>
          )}
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
              // Follows are BRAND-level: the heart on a location page follows the brand.
              isFollowed={followState.followedBrandIds.has(restaurant.id)}
              currentPath={currentPath}
              ownerPreview={canEdit}
              subtitle={branchLabel}
              jumpLinks={jumpLinks}
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
            <RestaurantInfoCard
              location={location}
              website={restaurant.website}
              hasMenu={hasMenu}
            />
          </aside>

          <div className="flex min-w-0 flex-col gap-8 lg:col-start-1 lg:row-start-2">
            {/* Near the top of the main column, right under the hero. Content
                gating already happened server-side (`location.deals_today`) —
                see RestaurantDeals.tsx. */}
            {location && (
              <RestaurantDeals
                hasDealToday={location.has_deal_today}
                dealsToday={location.deals_today}
                // Any signed-in session gets full cards; only signed-out
                // visitors get the sign-in banner (2026-09-25).
                signedIn={session !== null}
                signInReturnPath={currentPath}
              />
            )}

            {/* The location's OTHER active deals (other weekdays / future
                start). Same server-side content gate as deals_today — null for
                signed-out viewers only (renders nothing). When
                there is no "Today's deals" section it owns the #deals anchor. */}
            {location && (
              <RestaurantUpcomingDeals
                upcomingDeals={location.upcoming_deals}
                anchorId={location.has_deal_today ? undefined : "deals"}
              />
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
                (location.about / location.specialties). Renders nothing when
                both are empty. */}
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
                href={reportHref(restaurant.slug, location?.id)}
                className="flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-brand-pill border border-brand-ink px-5 text-sm font-semibold text-brand-ink transition hover:bg-brand-chip"
              >
                Report a problem
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
