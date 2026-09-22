"use server";

// Server Actions backing the follow/unfollow toggle (components/ui/
// FollowButton.tsx), shown on restaurant tiles (components/listing/
// RestaurantCard.tsx) and the restaurant detail hero
// (components/restaurant/RestaurantHero.tsx). Same "keep the Cognito access
// token server-side" rationale as app/claim/actions.ts and
// app/portal/locations/[id]/actions.ts: FollowButton is a Client Component
// (it needs local optimistic state and a click handler), so it never
// receives `session.accessToken` as a prop — these actions re-derive the
// session from the httpOnly cookie themselves.
//
// Auth: registered_user only (root CLAUDE.md "Permission model" —
// "Registered user: read-only + follow + deals"; docs/API_CONTRACTS.md
// "Follows (`user_follow`)"). FollowButton is only ever rendered for a
// signed-out visitor (redirect-to-login, no action call) or a registered_user
// (this toggle) — RestaurantCard/RestaurantHero's callers never render it for
// owner/manager/admin. That UI gating is a convenience, not the security
// boundary: a Server Action is a real network endpoint Next.js exposes on
// its own, directly callable regardless of what rendered client-side, so the
// role check below is real, and the backend's own `require_registered_user`
// dependency (backend/app/dependencies/auth.py) is the final authority
// either way. This file does not touch that backend restriction.
import { revalidatePath } from "next/cache";
import { ApiError } from "@/lib/api/client";
import { followRestaurant, unfollowRestaurant } from "@/lib/api/restaurants";
import { getServerSession } from "@/lib/auth/session";

type FollowActionResult = { ok: true } | { ok: false; error: string };

async function requireRegisteredUserSession(): Promise<
  { ok: true; accessToken: string } | { ok: false; error: string }
> {
  const session = await getServerSession();
  if (!session) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }
  if (session.role !== "registered_user") {
    return { ok: false, error: "Only registered users can follow restaurants." };
  }
  return { ok: true, accessToken: session.accessToken };
}

function messageFor(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  return fallback;
}

/** POST /restaurants/{id}/follow. */
export async function followRestaurantAction(brandId: number): Promise<FollowActionResult> {
  const auth = await requireRegisteredUserSession();
  if (!auth.ok) return auth;

  try {
    await followRestaurant(brandId, auth.accessToken);
    // Same staleness fix as PR #157's hours-freshness bug: the underlying
    // GET /auth/me/follows call is already fetched fresh on every render
    // (PR #141's cache: "no-store" for authenticated calls), but Next's
    // client-side Router Cache can still serve a stale /account snapshot on
    // navigation without this — found live 2026-09-22 ("My favorites needs
    // a hard refresh to see the update").
    revalidatePath("/account");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not follow this restaurant. Please try again.") };
  }
}

/** DELETE /restaurants/{id}/follow. */
export async function unfollowRestaurantAction(brandId: number): Promise<FollowActionResult> {
  const auth = await requireRegisteredUserSession();
  if (!auth.ok) return auth;

  try {
    await unfollowRestaurant(brandId, auth.accessToken);
    revalidatePath("/account");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not unfollow this restaurant. Please try again.") };
  }
}
