// registered_user's followed restaurants as a visual card grid —
// GET /auth/me/follows (docs/API_CONTRACTS.md "Follows"). Read-only; follow/
// unfollow happens from the restaurant listing page itself, not here. Server
// Component — links into the public listing page only.
//
// `FollowedBrand` carries no cover photo (brand-level summary), so every tile
// uses the shared default coffee-cup image over the warm gradient
// (components/ui/DefaultRestaurantImage) — same treatment as an un-photographed
// RestaurantCard. Add the real photo here once the follows contract exposes one.
//
// UNIFORM, COMPACT TILE: every tile has the same height whether or not the
// brand has a deal today or is unclaimed. Text keeps a tight rhythm (name on
// one line with the full name in `title`, then "Following since"). The "Deal(s)
// available today" badge (bottom-left) and "Unclaimed" chip (bottom-right) are
// overlays on the cover (the badge is decorative + aria-hidden because the deal
// panel below carries the accessible label), and the footer panel is ALWAYS
// present at a compact fixed height: up to 2 deal titles as a link when there
// is a deal, or a muted "No deals today" strip when there isn't.
import Link from "next/link";
import TrackedTileLink from "@/components/listing/TrackedTileLink";
import DealBadge from "@/components/ui/DealBadge";
import DefaultRestaurantImage from "@/components/ui/DefaultRestaurantImage";
import { dealPanelLabel, restaurantDealsHref } from "@/lib/deals/format";
import { SearchIcon } from "@/components/ui/icons";
import { cardClass, primaryLinkClass } from "@/components/account/accountShared";
import type { FollowedBrand } from "@/types/follow";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

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
            <li
              key={follow.brand_id}
              className="group flex h-full flex-col overflow-hidden rounded-brand-card border border-brand-border bg-white shadow-brand-card transition hover:shadow-brand-card-hover"
            >
              {/* The favourites grid only ever renders for a registered user
                  (its own "Restaurants you follow" section), so every tile
                  click is tracked; the route handler/backend re-check role.
                  The tile is two sibling links (an <a> can't nest in an
                  <a>): the main one (image/name/date) and the footer panel
                  beneath it (a deal link when there is a deal today,
                  otherwise a plain "No deals today" strip). */}
              <TrackedTileLink
                href={`/restaurant/${follow.slug}`}
                track={{ brand_id: follow.brand_id, location_id: null, source: "favourites" }}
                className="flex flex-1 flex-col focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-accent"
              >
                <div className="relative h-32 w-full shrink-0 overflow-hidden bg-brand-warm-gradient">
                  <DefaultRestaurantImage />
                  {follow.has_deal_today && (
                    <span aria-hidden="true" className="absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)]">
                      <DealBadge variant="overlay" />
                    </span>
                  )}
                  {!follow.is_claimed && (
                    <span className="absolute bottom-3 right-3 rounded-brand-pill bg-brand-ink/85 px-2.5 py-1 text-xs font-semibold text-brand-bg">
                      Unclaimed
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1.5 p-4">
                  <h3
                    title={follow.name}
                    className="truncate font-display text-lg font-semibold leading-6 text-brand-ink group-hover:text-brand-accent"
                  >
                    {follow.name}
                  </h3>
                  <p className="text-xs leading-4 text-brand-ink-subtle">
                    Following since {formatDate(follow.followed_at)}
                  </p>
                </div>
              </TrackedTileLink>

              {follow.has_deal_today ? (
                // This page is registered-user-only, so deal titles (content)
                // are allowed here. Links to the restaurant's Today's deals.
                <TrackedTileLink
                  href={restaurantDealsHref(follow.slug)}
                  track={{ brand_id: follow.brand_id, location_id: null, source: "favourites" }}
                  aria-label={dealPanelLabel(follow.name, follow.deal_titles_today)}
                  className="mt-auto flex h-14 flex-col justify-center gap-0.5 border-t border-brand-border bg-brand-accent/5 px-4 transition hover:bg-brand-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-accent"
                >
                  {follow.deal_titles_today.length > 0 ? (
                    <ul className="flex flex-col gap-0.5 text-sm leading-5 text-brand-ink">
                      {follow.deal_titles_today.slice(0, 2).map((title, i) => (
                        <li key={`${i}-${title}`} className="truncate">
                          {title}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-sm font-medium leading-5 text-brand-accent">
                      See today&apos;s deals &rarr;
                    </span>
                  )}
                </TrackedTileLink>
              ) : (
                <div className="mt-auto flex h-14 items-center border-t border-brand-border px-4 text-sm text-brand-ink-subtle">
                  No deals today
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
