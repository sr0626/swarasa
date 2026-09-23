// Typed client for /restaurants (restaurant_brand) — docs/API_CONTRACTS.md
// "Restaurants (`restaurant_brand`)".
import { apiFetch, toQueryString } from "./client";
import type { PaginatedResponse, PaginationParams } from "@/types/common";
import type { FollowOut } from "@/types/follow";
import type { LocationSummary } from "@/types/location";
import type { ListingStatusFilter } from "@/lib/adminListings";
import type {
  CreateRestaurantInput,
  RestaurantBrand,
  UpdateRestaurantInput,
} from "@/types/restaurant";

/** Admin-only filters on `GET /restaurants` (docs/API_CONTRACTS.md "GET
 * /restaurants" filters, added alongside the `/admin/listings` filter
 * bar) — every field here is silently ignored server-side for a
 * non-admin (owner) caller, same as `ownerId` above. All provided
 * filters combine with AND. */
export interface AdminRestaurantListFilters {
  ownerId?: number;
  /** Case-insensitive substring match against the owner's email. */
  ownerEmail?: string;
  /** Case-insensitive substring match against the brand name. */
  name?: string;
  /** Matches a brand if ANY of its locations has this status. The
   * pseudo-value `"deleted"` instead lists ONLY soft-deleted listings
   * (every other request excludes them). */
  status?: ListingStatusFilter;
  /** Matches a brand if ANY of its locations has this is_paid value. */
  isPaid?: boolean;
  /** Case-insensitive exact match; matches a brand if ANY of its
   * locations is in this city. */
  city?: string;
  isClaimed?: boolean;
}

/** `GET /restaurants` `sort` query param — NOT admin-only, unlike
 * `AdminRestaurantListFilters` above (docs/API_CONTRACTS.md "GET
 * /restaurants"). Omitted keeps the existing default order unchanged. */
export type RestaurantSort = "followers";

/**
 * GET /restaurants — auth: owner or admin (docs/API_CONTRACTS.md, added
 * 2026-09-13 to unblock the owner portal dashboard). Owner caller: always
 * implicitly filtered to their own `owner_id` server-side — no query param
 * can widen this. Admin caller: optional `ownerId` filter, omitted returns
 * all brands. `AdminRestaurantListFilters`' other fields are likewise
 * admin-only.
 *
 * FLAGGED CONTRACT GAP (see this PR's description): there is no manager
 * path for this endpoint at all — "Auth: owner or admin" only. A manager
 * caller gets a 403, so this function cannot be used to list a manager's
 * assigned locations; the dashboard page handles that role separately.
 */
export async function getMyRestaurants(
  params: PaginationParams & AdminRestaurantListFilters & { sort?: RestaurantSort } = {},
  accessToken: string
): Promise<PaginatedResponse<RestaurantBrand>> {
  const query = toQueryString({
    owner_id: params.ownerId,
    owner_email: params.ownerEmail,
    name: params.name,
    status: params.status,
    is_paid: params.isPaid,
    city: params.city,
    is_claimed: params.isClaimed,
    sort: params.sort,
    page: params.page,
    page_size: params.page_size,
  });

  return apiFetch<PaginatedResponse<RestaurantBrand>>(
    `/restaurants${query}`,
    { method: "GET" },
    { accessToken }
  );
}

/** GET /restaurants/{id} — public. Used by the SSR listing page. */
export async function getRestaurantById(id: number): Promise<RestaurantBrand> {
  return apiFetch<RestaurantBrand>(
    `/restaurants/${id}`,
    { method: "GET" },
    { revalidateSeconds: 60 }
  );
}

/**
 * FLAGGED CONTRACT GAP (see final report): frontend/CLAUDE.md's SSR listing
 * page pattern calls `getRestaurantBySlug(params.slug)` from
 * `/restaurant/[slug]/page.tsx`, but docs/API_CONTRACTS.md only documents
 * `GET /restaurants/{id}` with a numeric id — there is no dedicated
 * slug-lookup route. This assumes the backend's `{id}` path param can
 * resolve a slug string too (a common "id_or_slug" pattern); if that's not
 * actually true server-side, Architect/Backend Dev need to add a real
 * slug route (e.g. `GET /restaurants/by-slug/{slug}`) and this function
 * should be repointed at it. Not calling this a bug — it's a documented
 * open item to confirm.
 */
export async function getRestaurantBySlug(slug: string): Promise<RestaurantBrand> {
  return apiFetch<RestaurantBrand>(
    `/restaurants/${slug}`,
    { method: "GET" },
    { revalidateSeconds: 60 }
  );
}

/** GET /restaurants/{id}/locations — public, summary shape only. */
export async function getRestaurantLocations(
  id: number,
  params: PaginationParams = {}
): Promise<PaginatedResponse<LocationSummary>> {
  const query = toQueryString({
    page: params.page,
    page_size: params.page_size,
  });

  return apiFetch<PaginatedResponse<LocationSummary>>(
    `/restaurants/${id}/locations${query}`,
    { method: "GET" },
    { revalidateSeconds: 60 }
  );
}

/** POST /restaurants — auth: owner. */
export async function createRestaurant(
  input: CreateRestaurantInput,
  accessToken: string
): Promise<RestaurantBrand> {
  return apiFetch<RestaurantBrand>(
    "/restaurants",
    { method: "POST", body: JSON.stringify(input) },
    { accessToken }
  );
}

/** PATCH /restaurants/{id} — auth: owner (must own the brand) or admin. */
export async function updateRestaurant(
  id: number,
  input: UpdateRestaurantInput,
  accessToken: string
): Promise<RestaurantBrand> {
  return apiFetch<RestaurantBrand>(
    `/restaurants/${id}`,
    { method: "PATCH", body: JSON.stringify(input) },
    { accessToken }
  );
}

/**
 * DELETE /restaurants/{id} — auth: admin only. SOFT delete: stamps
 * `deleted_at` and deactivates every active location of the brand in one
 * transaction; the row is kept and the call is idempotent. Returns 204 and
 * never 409s (docs/API_CONTRACTS.md "DELETE /restaurants/{id}").
 */
export async function deleteRestaurant(
  id: number,
  accessToken: string
): Promise<void> {
  return apiFetch<void>(
    `/restaurants/${id}`,
    { method: "DELETE" },
    { accessToken }
  );
}

/**
 * POST /restaurants/{id}/restore — auth: admin only. Clears `deleted_at`.
 * The brand's locations are NOT reactivated (they stay deactivated until
 * re-enabled through their normal status path). Idempotent.
 */
export async function restoreRestaurant(
  id: number,
  accessToken: string
): Promise<RestaurantBrand> {
  return apiFetch<RestaurantBrand>(
    `/restaurants/${id}/restore`,
    { method: "POST" },
    { accessToken }
  );
}

/**
 * POST /restaurants/{id}/follow — auth: registered_user only
 * (docs/API_CONTRACTS.md "Follows (`user_follow`)"). Idempotent server-side
 * — following a brand the caller already follows just returns the existing
 * follow, no error.
 */
export async function followRestaurant(
  id: number,
  accessToken: string
): Promise<FollowOut> {
  return apiFetch<FollowOut>(
    `/restaurants/${id}/follow`,
    { method: "POST" },
    { accessToken }
  );
}

/**
 * DELETE /restaurants/{id}/follow — auth: registered_user only. Idempotent
 * — unfollowing a brand the caller doesn't currently follow is a no-op 204,
 * not an error.
 */
export async function unfollowRestaurant(
  id: number,
  accessToken: string
): Promise<void> {
  return apiFetch<void>(
    `/restaurants/${id}/follow`,
    { method: "DELETE" },
    { accessToken }
  );
}
