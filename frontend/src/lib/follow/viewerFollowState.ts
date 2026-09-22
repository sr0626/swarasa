// Resolves what the follow icon (components/ui/FollowButton.tsx) should
// render for the CURRENT viewer on a page that lists restaurant tiles
// (home "Popular near you", /search results) or shows the restaurant detail
// hero — added for the "follow a restaurant" gap: the backend
// (`POST`/`DELETE /restaurants/{id}/follow`, `GET /auth/me/follows`,
// registered_user-only per root CLAUDE.md "Permission model") has existed
// since PR #66, but nothing in the UI called it or knew the viewer's
// current follow state.
//
// DECISION (flagged in final report): `SearchResultItem`/`RestaurantBrand`
// (docs/API_CONTRACTS.md "GET /search" / "Restaurants") carry no
// `is_followed` boolean, and adding one would mean a backend change to
// every list-shaped response plus a per-row subquery against `user_follow`
// on every search hit. Instead this calls the read-only
// `GET /auth/me/follows` ONCE per page render (not per tile) and matches
// brand ids locally — no backend change, one extra request per page load,
// good enough for Phase 1. It does NOT loosen the follow/unfollow write
// auth (still registered_user-only, enforced server-side regardless of
// this file).
//
// KNOWN LIMITATION: `GET /auth/me/follows` has "no follow cap for
// registered users" (docs/DECISIONS.md) and is genuinely paginated, most-
// recently-followed first. This fetches a single page at
// `FOLLOW_STATE_PAGE_SIZE` (the documented max page_size) rather than
// paging through everything, so a viewer following more than that many
// restaurants may see an already-followed tile render as "not followed" on
// initial load for their oldest follows. Clicking the icon still works
// correctly either way (the backend, not this cache, is authoritative), and
// the common case — most viewers following far fewer than 100 restaurants —
// is unaffected. Not silently wrong for the typical case; a real gap only
// at the long tail, worth revisiting if it turns out to matter.
import { getMyFollows } from "@/lib/api/auth";
import type { Session } from "@/types/auth";

/** Matches `GET /auth/me/follows`'s documented max `page_size`. */
const FOLLOW_STATE_PAGE_SIZE = 100;

export interface ViewerFollowState {
  /**
   * Whether the follow icon should render AT ALL for this viewer. `false`
   * only when signed in as owner/manager/admin — root CLAUDE.md's
   * permission model has no follow use case for those roles ("Registered
   * user: read-only + follow + deals"), so the task brief is explicit:
   * "do NOT show the icon at all" for them, not just disable it. `true` for
   * a signed-out visitor (the icon still renders, as a sign-in link) and
   * for a signed-in registered_user (the icon renders as a real toggle) —
   * `isRegisteredUser` below is what tells FollowButton which of those two
   * it is.
   */
  showFollowButton: boolean;
  /**
   * True only for a signed-in `registered_user`. When `showFollowButton` is
   * true and this is false, the viewer is signed out (FollowButton renders
   * a sign-in link instead of a toggle). Always false when
   * `showFollowButton` is false.
   */
  isRegisteredUser: boolean;
  /** Brand ids the viewer already follows, for each tile/hero's initial
   * icon state. Always empty unless `isRegisteredUser`. */
  followedBrandIds: Set<number>;
}

const SIGNED_OUT_STATE: ViewerFollowState = {
  showFollowButton: true,
  isRegisteredUser: false,
  followedBrandIds: new Set(),
};

const OTHER_ROLE_STATE: ViewerFollowState = {
  showFollowButton: false,
  isRegisteredUser: false,
  followedBrandIds: new Set(),
};

/**
 * Pass the already-resolved session (most pages that need this already call
 * `getServerSession()` for another reason — e.g. the restaurant detail page
 * for `canEditListing`) so this never fetches it a second time. Pages that
 * don't yet have a session call it themselves first.
 */
export async function getViewerFollowState(
  session: Session | null
): Promise<ViewerFollowState> {
  if (!session) return SIGNED_OUT_STATE;
  if (session.role !== "registered_user") return OTHER_ROLE_STATE;

  try {
    const page = await getMyFollows(
      { page: 1, page_size: FOLLOW_STATE_PAGE_SIZE },
      session.accessToken
    );
    return {
      showFollowButton: true,
      isRegisteredUser: true,
      followedBrandIds: new Set(page.results.map((follow) => follow.brand_id)),
    };
  } catch {
    // A registered_user whose follows list failed to load still gets a
    // working, interactive follow icon — it just can't know the initial
    // state, so every tile starts as "not followed" rather than the page
    // breaking. Clicking still calls the real API and reflects the true
    // result.
    return { showFollowButton: true, isRegisteredUser: true, followedBrandIds: new Set() };
  }
}
