// registered_user's followed restaurants — GET /auth/me/follows
// (docs/API_CONTRACTS.md "Follows"). Read-only; follow/unfollow happens
// from the restaurant listing page itself, not here. Server Component —
// no interactivity, just links into the public listing page.
import Link from "next/link";
import InfoPanel from "@/components/ui/InfoPanel";
import { StarIcon } from "@/components/ui/icons";
import type { FollowedBrand } from "@/types/follow";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function FollowedRestaurantsList({
  follows,
  loadError,
}: {
  follows: FollowedBrand[];
  loadError: string | null;
}) {
  return (
    <section
      aria-labelledby="follows-heading"
      className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
    >
      <h2 id="follows-heading" className="font-display text-xl font-bold text-brand-ink">
        Followed restaurants
      </h2>

      <div className="mt-4">
        {loadError && <InfoPanel title="Couldn't load your follows" body={loadError} />}

        {!loadError && follows.length === 0 && (
          <InfoPanel
            title="You aren't following any restaurants yet"
            body="Follow a restaurant from its listing page to see updates here."
          />
        )}

        {!loadError && follows.length > 0 && (
          <ul className="flex flex-col gap-2">
            {follows.map((follow) => (
              <li key={follow.brand_id}>
                <Link
                  href={`/restaurant/${follow.slug}`}
                  className="flex min-h-[44px] items-center justify-between gap-3 rounded-brand-control border border-brand-border bg-white px-4 py-2.5 transition hover:border-brand-ink-subtle"
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm text-brand-ink">
                    <StarIcon className="h-4 w-4 shrink-0 text-brand-accent-gold" />
                    <span className="truncate">{follow.name}</span>
                    {!follow.is_claimed && (
                      <span className="shrink-0 rounded-brand-pill bg-brand-bg px-2 py-0.5 text-xs font-semibold text-brand-ink-subtle">
                        Unclaimed
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-brand-ink-subtle">
                    Since {formatDate(follow.followed_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
