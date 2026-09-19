// registered_user's followed restaurants as a visual card grid —
// GET /auth/me/follows (docs/API_CONTRACTS.md "Follows"). Read-only; follow/
// unfollow happens from the restaurant listing page itself, not here. Server
// Component — links into the public listing page only.
//
// `FollowedBrand` carries no cover photo (brand-level summary), so every tile
// uses the shared default coffee-cup image over the warm gradient
// (components/ui/DefaultRestaurantImage) — same treatment as an un-photographed
// RestaurantCard. Add the real photo here once the follows contract exposes one.
import Link from "next/link";
import DefaultRestaurantImage from "@/components/ui/DefaultRestaurantImage";
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
            <li key={follow.brand_id}>
              <Link
                href={`/restaurant/${follow.slug}`}
                className="group flex h-full flex-col overflow-hidden rounded-brand-card border border-brand-border bg-white shadow-brand-card transition hover:shadow-brand-card-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
              >
                <div className="relative h-32 w-full shrink-0 overflow-hidden bg-brand-warm-gradient">
                  <DefaultRestaurantImage />
                </div>
                <div className="flex flex-1 flex-col gap-1.5 p-4">
                  <h3 className="font-display text-lg font-semibold text-brand-ink group-hover:text-brand-accent">
                    {follow.name}
                  </h3>
                  <p className="text-xs text-brand-ink-subtle">
                    Following since {formatDate(follow.followed_at)}
                  </p>
                  {!follow.is_claimed && (
                    <span className="mt-1 inline-flex w-fit rounded-brand-pill bg-brand-bg px-2 py-0.5 text-xs font-semibold text-brand-ink-subtle">
                      Unclaimed
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
