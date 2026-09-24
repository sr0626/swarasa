// Landing page of a brand with SEVERAL active locations (`/restaurant/{brandSlug}`):
// brand name, description and cuisines, the brand-level follow heart, and one
// card per location in a stable order (city, then id). Each card is the SAME
// shared tile the search results use (components/listing/RestaurantCard.tsx):
// address with a Google Maps link, today's hours pill, deal badge, cover photo
// -- and links to that location's own page (`/restaurant/{brand}/{location}`).
// Server Component.
//
// Follow stays BRAND-level (one heart here, none on the tiles, so the same
// brand is never followed from several places on one screen); follower counts
// stay per brand.
import Link from "next/link";
import ClaimCTA from "@/components/restaurant/ClaimCTA";
import RestaurantBackLink from "@/components/restaurant/RestaurantBackLink";
import RestaurantCard from "@/components/listing/RestaurantCard";
import TopBar from "@/components/home/TopBar";
import FollowButton from "@/components/ui/FollowButton";
import { cardItemForLocation } from "@/lib/restaurant/landing";
import type { ViewerFollowState } from "@/lib/follow/viewerFollowState";
import type { Session } from "@/types/auth";
import type { BrandLocationCard, RestaurantPublic } from "@/types/restaurant";

interface BrandLandingProps {
  restaurant: RestaurantPublic;
  /** Already in landing order (`decideBrandPage`). */
  locations: BrandLocationCard[];
  session: Session | null;
  followState: ViewerFollowState;
  /** `/restaurant/{brandSlug}` — the sign-in return path for a signed-out follow click. */
  currentPath: string;
}

export default function BrandLanding({
  restaurant,
  locations,
  session,
  followState,
  currentPath,
}: BrandLandingProps) {
  const isAdmin = session?.role === "admin";
  const cuisineLine = restaurant.cuisine_tags.map((tag) => tag.display_name).join(" · ");

  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-2">
          <RestaurantBackLink />
        </div>

        <header className="mt-2 flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
              {restaurant.name}
            </h1>
            {followState.showFollowButton && (
              <FollowButton
                brandId={restaurant.id}
                restaurantName={restaurant.name}
                isRegisteredUser={followState.isRegisteredUser}
                initialFollowed={followState.followedBrandIds.has(restaurant.id)}
                currentPath={currentPath}
                wrapperClassName="mt-1 shrink-0"
              />
            )}
          </div>
          <p className="text-base text-brand-ink-muted">
            {locations.length} locations
            {cuisineLine && ` · ${cuisineLine}`}
          </p>
          {restaurant.description && (
            <p className="max-w-2xl whitespace-pre-line text-sm leading-relaxed text-brand-ink-muted sm:text-base">
              {restaurant.description}
            </p>
          )}
          {!restaurant.is_claimed && !restaurant.has_pending_claim && (
            <div className="max-w-md">
              <ClaimCTA brandId={restaurant.id} />
            </div>
          )}
          {!restaurant.is_claimed && restaurant.has_pending_claim && isAdmin && (
            <Link
              href="/admin/claims"
              className="inline-flex items-center self-start rounded-brand-pill bg-brand-chip px-3 py-1.5 text-xs font-semibold text-brand-ink"
            >
              Claim pending review
            </Link>
          )}
        </header>

        <section aria-labelledby="locations-heading" className="mt-8">
          <h2 id="locations-heading" className="font-display text-xl font-bold text-brand-ink">
            Choose a location
          </h2>
          <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {locations.map((card) => (
              <li key={card.location_id}>
                {/* No heart on the tiles (`showFollowButton` defaults to false):
                    follow is brand-level and shown once, in the header above. */}
                <RestaurantCard item={cardItemForLocation(restaurant, card)} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
