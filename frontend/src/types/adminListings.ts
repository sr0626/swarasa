// Types for GET /admin/listings, matching docs/API_CONTRACTS.md
// "GET /admin/listings" -- the admin Listings page's data source: each brand
// with EVERY location (any status), the owner's email, and who created the
// brand / each location. Admin-only; none of these fields exist on any
// public, owner or manager payload.
import type { CuisineTag } from "./cuisine";
import type { LocationStatus } from "./location";

export type ListingCreatorRole = "owner" | "manager" | "admin" | "system";

/** Provenance of one brand/location (from its `audit_log` "create" row). */
export interface ListingCreator {
  /** ISO timestamp (UTC): the create audit row, else the record's own created_at. */
  created_at: string | null;
  /** null = creator unknown (no audit row). */
  created_by_role: ListingCreatorRole | null;
  created_by_email: string | null;
  /** Ready-to-render actor: the email, else "import"/"seed"/script name, else the sub's first 8 chars. */
  created_by_label: string | null;
}

export interface AdminListingLocation extends ListingCreator {
  id: number;
  slug: string;
  location_name: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  phone: string | null;
  status: LocationStatus;
  is_verified: boolean;
  is_paid: boolean;
  paid_until: string | null;
  cuisine_tags: CuisineTag[];
  /** True when this location satisfies every location-level filter in effect (always true with none). */
  matches_filter: boolean;
}

export interface AdminListing extends ListingCreator {
  id: number;
  name: string;
  slug: string;
  is_claimed: boolean;
  has_pending_claim: boolean;
  owner_id: number | null;
  /** null for an unclaimed brand or a CCPA-deleted owner (see `owner_deleted`). */
  owner_email: string | null;
  owner_deleted: boolean;
  /** ACTIVE-location count (same meaning as `RestaurantBrand.location_count`). */
  location_count: number;
  follower_count: number;
  /** Soft-delete timestamp; only non-null in the `status=deleted` view. */
  deleted_at: string | null;
  cuisine_tags: CuisineTag[];
  /** Every location of the brand, any status, oldest first. */
  locations: AdminListingLocation[];
}

export interface AdminListingsResponse {
  results: AdminListing[];
  page: number;
  page_size: number;
  total: number;
}

export type AdminListingSort = "newest" | "oldest" | "followers";
