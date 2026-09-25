// Types for `restaurant_brand`, matching docs/API_CONTRACTS.md
// "Restaurants (`restaurant_brand`)".
import type { CuisineTag } from "./cuisine";
import type { LocationDetail } from "./location";
import type { SearchNearestLocation } from "./search";

/** Response shape for GET /restaurants/{id}, POST /restaurants, PATCH /restaurants/{id}. */
export interface RestaurantBrand {
  id: number;
  name: string;
  slug: string;
  // Was wrongly typed as non-nullable `string` -- the backend column
  // (restaurant_brand.description) has always allowed NULL, and every
  // CSV-imported restaurant has one (no description column in that
  // import). Found live 2026-09-18: crashed generateMetadata on
  // /restaurant/[brandSlug] with "Cannot read properties of null (reading
  // 'slice')" for every such restaurant.
  description: string | null;
  /** Restaurant's own site (brand-level, nullable) — already returned by GET /restaurants/{id}. */
  website: string | null;
  is_claimed: boolean;
  /** A claim for this listing is awaiting admin review. */
  has_pending_claim: boolean;
  /** null for unclaimed listings — frontend renders a "Claim this listing" CTA. */
  owner_id: number | null;
  /**
   * DERIVED summary — tags are per LOCATION (docs/DECISIONS.md "Cuisine/dietary tags
   * are per location"); a brand has none of its own. This is the union of its locations'
   * tags (public: active locations only; owner/admin lists: all). For a specific branch
   * use that location's own `cuisine_tags`.
   */
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
  // (No `cuisine_tag_ids`: tags are per location — send them on POST /locations or
  // PUT /locations/{id}/cuisine-tags.)
}

/** Body for PATCH /restaurants/{id}. Any subset of the create fields. */
export type UpdateRestaurantInput = Partial<CreateRestaurantInput>;

/**
 * One ACTIVE location of a brand as a landing-page card
 * (`GET /restaurants/by-slug/{brand_slug}` -> `locations[]`; backend
 * `BrandLocationCardOut`). It is a `SearchNearestLocation` (slug, address,
 * today's hours inputs, `is_open_now`, `has_deal_today`; `distance_mi` always
 * null) plus the location's optional label and cover photo.
 */
export interface BrandLocationCard extends SearchNearestLocation {
  location_name: string | null;
  cover_photo_url: string | null;
  cover_photo_thumbnail_url: string | null;
  /** THIS location's own cuisine/dietary tags (each branch shows its own). */
  cuisine_tags: CuisineTag[];
}

/** Response of `GET /restaurants/by-slug/{brand_slug}`: the brand + its ACTIVE locations
 * (city, then id order). `location_count` equals `locations.length`. */
export interface RestaurantPublic extends RestaurantBrand {
  locations: BrandLocationCard[];
}

/** Response of `GET /restaurants/by-slug/{brand_slug}/locations/{location_slug}`:
 * the brand (its `location_count` = ACTIVE locations, which decides the canonical URL)
 * and the location's full detail — the same payload as `GET /locations/{id}`. */
export interface LocationPage {
  restaurant: RestaurantBrand;
  location: LocationDetail;
}

/** One row of `GET /sitemap/locations`. */
export interface PublicLocationIndexItem {
  brand_slug: string;
  location_slug: string;
  /** ACTIVE locations of the brand: 1 -> canonical is the short brand URL. */
  active_location_count: number;
  updated_at: string;
}
