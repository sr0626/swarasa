// Types for `restaurant_brand`, matching docs/API_CONTRACTS.md
// "Restaurants (`restaurant_brand`)".
import type { CuisineTag } from "./cuisine";

/** Response shape for GET /restaurants/{id}, POST /restaurants, PATCH /restaurants/{id}. */
export interface RestaurantBrand {
  id: number;
  name: string;
  slug: string;
  // Was wrongly typed as non-nullable `string` -- the backend column
  // (restaurant_brand.description) has always allowed NULL, and every
  // CSV-imported restaurant has one (no description column in that
  // import). Found live 2026-09-18: crashed generateMetadata on
  // /restaurant/[slug] with "Cannot read properties of null (reading
  // 'slice')" for every such restaurant.
  description: string | null;
  /** Restaurant's own site (brand-level, nullable) — already returned by GET /restaurants/{id}. */
  website: string | null;
  is_claimed: boolean;
  /** A claim for this listing is awaiting admin review. */
  has_pending_claim: boolean;
  /** null for unclaimed listings — frontend renders a "Claim this listing" CTA. */
  owner_id: number | null;
  cuisine_tags: CuisineTag[];
  location_count: number;
  /**
   * Dashboard-only stat, never public (backend/app/schemas/restaurant.py
   * RestaurantOut.follower_count). `null` on the public
   * `GET /restaurants/{id}` response (used by `getRestaurantById`/
   * `getRestaurantBySlug` below) — only populated (a real count, 0
   * included) on the owner/admin-scoped `GET /restaurants` list
   * (`getMyRestaurants`). Components rendering this on a public page
   * must not surface it even if present; it's kept on the shared type
   * rather than split into two response shapes since every other field
   * already is shared (see `RestaurantOut`'s own comment on why).
   */
  follower_count: number | null;
  /**
   * Soft-delete timestamp (`restaurant_brand.deleted_at`). `null`/absent for
   * a live listing. Only ever non-null in the admin listings view behind
   * the `status=deleted` filter — deleted listings are 404 everywhere else.
   */
  deleted_at?: string | null;
}

/** Body for POST /restaurants. Creates a new brand owned by the caller. */
export interface CreateRestaurantInput {
  name: string;
  description: string;
  website?: string | null;
  cuisine_tag_ids: number[];
}

/** Body for PATCH /restaurants/{id}. Any subset of the create fields. */
export type UpdateRestaurantInput = Partial<CreateRestaurantInput>;
