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
