"use server";

// Server Actions backing FollowButton.tsx (components/restaurant/).
// Same shape as app/claim/actions.ts / app/restaurant/[slug]/report/
// actions.ts: re-reads the session from the httpOnly cookie server-side
// (lib/auth/session.ts) rather than handing `session.accessToken` to
// client-side JS as a prop (root CLAUDE.md "NEVER store auth tokens in
// localStorage" — the same spirit applies to not passing them to the
// client at all when a Server Action can avoid it).
//
// Auth: any authenticated role can follow/unfollow as of 2026-09-22 (root
// CLAUDE.md "Permission model") — this action doesn't itself check
// `session.role`, it just requires *some* signed-in session and lets the
// backend be the actual authority.
import { ApiError } from "@/lib/api/client";
import { followRestaurant, unfollowRestaurant } from "@/lib/api/restaurants";
import { getServerSession } from "@/lib/auth/session";

export type FollowActionResult = { ok: true } | { ok: false; error: string };

const SIGN_IN_ERROR = "Please sign in to follow restaurants.";
const GENERIC_ERROR = "Something went wrong. Please try again.";

export async function followRestaurantAction(brandId: number): Promise<FollowActionResult> {
  const session = await getServerSession();
  if (!session) {
    return { ok: false, error: SIGN_IN_ERROR };
  }
  try {
    await followRestaurant(brandId, session.accessToken);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof ApiError ? error.message : GENERIC_ERROR };
  }
}

export async function unfollowRestaurantAction(brandId: number): Promise<FollowActionResult> {
  const session = await getServerSession();
  if (!session) {
    return { ok: false, error: SIGN_IN_ERROR };
  }
  try {
    await unfollowRestaurant(brandId, session.accessToken);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof ApiError ? error.message : GENERIC_ERROR };
  }
}
