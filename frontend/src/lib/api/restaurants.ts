// Typed client for /restaurants (restaurant_brand) — docs/API_CONTRACTS.md
// "Restaurants (`restaurant_brand`)".
import { apiFetch, toQueryString } from "./client";
import type { PaginatedResponse, PaginationParams } from "@/types/common";
import type { FollowOut } from "@/types/follow";
import type { LocationSummary } from "@/types/location";
import type {
  CreateRestaurantInput,
  RestaurantBrand,
  UpdateRestaurantInput,
} from "@/types/restaurant";

/**
 * GET /restaurants — auth: owner or admin (docs/API_CONTRACTS.md, added
 * 2026-09-13 to unblock the owner portal dashboard). Owner caller: always
 * implicitly filtered to their own `owner_id` server-side — no query param
 * can widen this. Admin caller: optional `ownerId` filter, omitted returns
 * all brands.
 *
 * FLAGGED CONTRACT GAP (see this PR's description): there is no manager
 * path for this endpoint at all — "Auth: owner or admin" only. A manager
 * caller gets a 403, so this function cannot be used to list a manager's
 * assigned locations; the dashboard page handles that role separately.
 */
export async function getMyRestaurants(
  params: PaginationParams & { ownerId?: number } = {},
  accessToken: string
): Promise<PaginatedResponse<RestaurantBrand>> {
  const query = toQueryString({
    owner_id: params.ownerId,
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
 * DELETE /restaurants/{id} — auth: admin only. Returns 204; the DB
 * ON DELETE RESTRICT means this can 409 while locations still reference
 * the brand (docs/API_CONTRACTS.md).
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
 * POST /restaurants/{id}/follow — auth: any authenticated role (owner,
 * manager, admin, registered_user; docs/API_CONTRACTS.md "Follows", auth
 * widened 2026-09-22). Idempotent — following an already-followed brand
 * returns the existing follow rather than erroring.
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
 * DELETE /restaurants/{id}/follow — auth: any authenticated role. Returns
 * 204; idempotent — unfollowing a brand not currently followed is a no-op
 * success, not a 404.
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
