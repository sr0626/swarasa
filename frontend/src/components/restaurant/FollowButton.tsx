"use client";

// Follow/unfollow toggle for the public restaurant listing page — the
// control root CLAUDE.md's task brief asked for when widening
// `POST`/`DELETE /restaurants/{id}/follow` to any authenticated role
// (owner, manager, admin, registered_user), not just registered_user.
// No such control existed anywhere in the frontend before this: the
// backend follow API (PR #66) and the read-only "restaurants you follow"
// list (components/account/FollowedRestaurantsGrid.tsx) both shipped with
// no way to actually follow a restaurant from its page — confirmed via a
// full-repo search for "follow" before adding this.
//
// Rendered only for a signed-in caller (`RestaurantPage` in
// app/restaurant/[slug]/page.tsx decides that server-side); a signed-out
// visitor sees nothing here, same posture as EditListingBar.
//
// Optimistic toggle, reverting on failure. Mutations go through the
// Server Actions in the sibling `follow-actions.ts` (never a direct
// client-side fetch with the access token — frontend/CLAUDE.md "NEVER
// fetch() inline in a component" / "NEVER store auth tokens in
// localStorage").
import { useState, useTransition } from "react";
import { CheckIcon } from "@/components/ui/icons";
import { followRestaurantAction, unfollowRestaurantAction } from "@/app/restaurant/[slug]/follow-actions";

export default function FollowButton({
  brandId,
  initialIsFollowing,
}: {
  brandId: number;
  initialIsFollowing: boolean;
}) {
  const [isFollowing, setIsFollowing] = useState(initialIsFollowing);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    const next = !isFollowing;
    setIsFollowing(next); // optimistic

    startTransition(async () => {
      const result = next
        ? await followRestaurantAction(brandId)
        : await unfollowRestaurantAction(brandId);

      if (!result.ok) {
        setIsFollowing(!next); // revert
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        aria-pressed={isFollowing}
        className={
          isFollowing
            ? "flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-brand-pill border border-brand-border bg-brand-chip px-5 text-sm font-semibold text-brand-chip-ink transition hover:bg-brand-chip/80 disabled:cursor-not-allowed disabled:opacity-60"
            : "flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-brand-pill border border-brand-ink px-5 text-sm font-semibold text-brand-ink transition hover:bg-brand-chip disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        {isFollowing && <CheckIcon className="h-4 w-4" />}
        {isFollowing ? "Following" : "Follow"}
      </button>
      {error && (
        <p role="alert" className="text-xs text-brand-closed">
          {error}
        </p>
      )}
    </div>
  );
}
