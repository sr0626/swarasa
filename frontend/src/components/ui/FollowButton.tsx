"use client";

// Follow/unfollow toggle icon — used as a corner overlay on restaurant tiles
// (components/listing/RestaurantCard.tsx) and inline near the restaurant
// name on the detail hero (components/restaurant/RestaurantHero.tsx). A
// small client island embedded in an otherwise server-rendered tree, same
// pattern as components/restaurant/RestaurantBackLink.tsx — the rest of
// those pages stay SSR (frontend/CLAUDE.md "NEVER make API calls
// client-side on pages that should be SSR"); only the click handling here
// is client-side, and this component itself never fetches restaurant data.
//
// Rendering rule (decided by the CALLER, not this file): root CLAUDE.md's
// permission model only allows a `registered_user` to follow
// ("Registered user: read-only + follow + deals" — no owner/manager/admin
// use case). So owner/manager/admin never get this component rendered at
// all — see lib/follow/viewerFollowState.ts and the pages that use it. This
// component itself only ever handles the two remaining cases:
//   - signed out (`isRegisteredUser=false`): a plain sign-in link, no API
//     call — reuses the same safeNextPath/withNext "sign in then come back
//     here" mechanism as ClaimCTA's claim flow (lib/auth/safeNext.ts).
//   - signed-in registered_user (`isRegisteredUser=true`): a real toggle
//     against POST/DELETE /restaurants/{id}/follow (lib/actions/follow.ts).
//
// `wrapperClassName` only ever carries POSITIONING (e.g. an absolute
// corner-overlay offset on a tile) — the heart's own circular scrim, size,
// and colors are fixed here so every follow icon in the app looks the same
// regardless of where it's placed.
//
// `currentPath` (the "come back here after sign-in" destination) is passed
// in by the SERVER-rendered caller rather than read here via
// `usePathname`/`useSearchParams` — deliberately: `useSearchParams` opts a
// Client Component out of static rendering unless wrapped in its own
// Suspense boundary (per Next.js docs), and none of this button's callers
// (RestaurantCard tiles, RestaurantHero) are wrapped that tightly. Every
// caller already knows its own path server-side (the homepage is always
// "/", the search page has `location`/`query`/`filters`/`page` in scope
// via lib/search/filters.ts's `buildSearchHref`, the detail page has its
// own slug) — passing it down avoids the extra client hook entirely.
import { useState, useTransition, type MouseEvent } from "react";
import Link from "next/link";
import { HeartFilledIcon, HeartIcon } from "@/components/ui/icons";
import { followRestaurantAction, unfollowRestaurantAction } from "@/lib/actions/follow";
import { safeNextPath, withNext } from "@/lib/auth/safeNext";

/** 44px-minimum touch target (frontend/CLAUDE.md "Mobile-First Rules"), a
 * circular scrim so the heart stays legible over any cover photo — shared
 * by both the sign-in link and the real toggle button below. */
const ICON_BUTTON_CLASSES =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/90 text-brand-ink-subtle shadow-brand-card backdrop-blur-sm transition hover:text-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:cursor-not-allowed disabled:opacity-70";

interface FollowButtonProps {
  brandId: number;
  restaurantName: string;
  /** See this file's header comment — the caller has already decided
   * whether to render this at all (never for owner/manager/admin); this
   * prop only distinguishes signed-out from signed-in registered_user. */
  isRegisteredUser: boolean;
  /** Whether the current viewer already follows this restaurant, from the
   * page's initial server-rendered data. Only meaningful when
   * `isRegisteredUser` — ignored (treated as not-followed) otherwise. */
  initialFollowed: boolean;
  /** The page this button lives on (e.g. "/search?...", "/",
   * "/restaurant/spice-garden") — used as the `next` return path for a
   * signed-out click. Validated here via `safeNextPath` before use, so
   * it's fine for the caller to pass this through un-sanitized. */
  currentPath: string;
  /** Positioning only (e.g. "absolute right-3 top-3 z-10" for a tile's
   * corner overlay). Defaults to static inline placement, for the detail
   * hero's inline use next to the restaurant name. */
  wrapperClassName?: string;
}

export default function FollowButton({
  brandId,
  restaurantName,
  isRegisteredUser,
  initialFollowed,
  currentPath,
  wrapperClassName,
}: FollowButtonProps) {
  const [followed, setFollowed] = useState(isRegisteredUser && initialFollowed);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const wrapperClasses = `relative inline-flex ${wrapperClassName ?? ""}`.trim();

  if (!isRegisteredUser) {
    const next = safeNextPath(currentPath);
    return (
      <span className={wrapperClasses}>
        <Link
          href={withNext("/login", next)}
          aria-label={`Sign in to follow ${restaurantName}`}
          title="Sign in to follow"
          // A signed-out tile's follow icon sits next to (never inside) the
          // card's own <Link> to the restaurant page — see RestaurantCard's
          // header comment on why they can't nest. stopPropagation just
          // guards against a future ancestor click handler; it never blocks
          // this Link's own navigation (no preventDefault).
          onClick={(e) => e.stopPropagation()}
          className={ICON_BUTTON_CLASSES}
        >
          <HeartIcon className="h-5 w-5" />
        </Link>
      </span>
    );
  }

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (isPending) return;

    const nextFollowed = !followed;
    // Optimistic update (task brief: "optimistic UI update is fine, but
    // handle the request failing gracefully — revert the icon state and
    // show a brief error, don't leave it stuck in the wrong state").
    setFollowed(nextFollowed);
    setError(null);

    startTransition(async () => {
      const result = nextFollowed
        ? await followRestaurantAction(brandId)
        : await unfollowRestaurantAction(brandId);
      if (!result.ok) {
        setFollowed(!nextFollowed);
        setError(result.error);
      }
    });
  }

  return (
    <span className={wrapperClasses}>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        aria-pressed={followed}
        aria-label={followed ? `Unfollow ${restaurantName}` : `Follow ${restaurantName}`}
        title={followed ? "Unfollow" : "Follow"}
        className={ICON_BUTTON_CLASSES}
      >
        {followed ? (
          <HeartFilledIcon className="h-5 w-5 text-brand-accent" />
        ) : (
          <HeartIcon className="h-5 w-5" />
        )}
      </button>
      {error && (
        <p
          role="alert"
          className="absolute right-0 top-full z-20 mt-1 w-max max-w-[14rem] rounded-brand-control bg-brand-closed-bg px-2 py-1 text-xs text-brand-closed shadow-brand-card"
        >
          {error}
        </p>
      )}
    </span>
  );
}
