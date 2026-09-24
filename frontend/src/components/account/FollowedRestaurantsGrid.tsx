// registered_user's followed restaurants — GET /auth/me/follows
// (docs/API_CONTRACTS.md "Follows"). Renders the SAME tile as the search
// results and the homepage (components/listing/RestaurantCard.tsx) — not a
// separate favourites tile — so address (Google Maps link), hours, cuisines,
// cover photo, deal badge and "N locations" behave identically. This file only
// owns the section wrapper (heading, "Find more" link, empty and error states)
// and the grid. Server Component.
//
// Each follow item carries ONE chosen location (the first location with a deal
// today, else the first active location — see FollowedBrand), so the tile's
// address/hours/badge belong to the location that runs the deal. The "Following
// since" date is not shown: it would break the tile's uniform height, and
// `followed_at` stays available on the item.
import Link from "next/link";
import RestaurantCard from "@/components/listing/RestaurantCard";
import { SearchIcon } from "@/components/ui/icons";
import { cardClass, primaryLinkClass } from "@/components/account/accountShared";
import type { FollowedBrand } from "@/types/follow";

export default function FollowedRestaurantsGrid({
  follows,
  loadError,
}: {
  follows: FollowedBrand[];
  loadError: string | null;
}) {
  return (
    <section aria-labelledby="follows-heading" className={cardClass}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="follows-heading" className="font-display text-xl font-bold text-brand-ink">
          Restaurants you follow
        </h2>
        {!loadError && follows.length > 0 && (
          <Link
            href="/search"
            className="text-sm font-semibold text-brand-accent hover:text-brand-accent-hover"
          >
            Find more →
          </Link>
        )}
      </div>

      {loadError && (
        <p
          role="alert"
          className="mt-4 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed"
        >
          {loadError}
        </p>
      )}

      {!loadError && follows.length === 0 && (
        <div className="mt-4 flex flex-col items-center gap-4 rounded-brand-card border border-dashed border-brand-border px-6 py-10 text-center">
          <p className="font-display text-base font-semibold text-brand-ink">
            You aren&apos;t following any restaurants yet
          </p>
          <p className="max-w-md text-sm text-brand-ink-muted">
            Follow a restaurant from its page and it will show up here, so it&apos;s always one tap
            away.
          </p>
          <Link href="/search" className={primaryLinkClass}>
            <SearchIcon className="h-4 w-4" />
            Find restaurants near you
          </Link>
        </div>
      )}

      {!loadError && follows.length > 0 && (
        <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {follows.map((follow) => (
            <li key={follow.brand_id}>
              {/* The favourites grid only ever renders for a registered user
                  (its own "Restaurants you follow" section), so the heart is
                  the real unfollow toggle (initially filled) and every tile
                  click is tracked as "favourites"; the route handler/backend
                  re-check role. Unfollowing revalidates /account (lib/actions/
                  follow.ts), so the tile drops out of the list. */}
              <RestaurantCard
                item={follow}
                showFollowButton
                isRegisteredUser
                isFollowed
                currentPath="/account"
                clickSource="favourites"
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
