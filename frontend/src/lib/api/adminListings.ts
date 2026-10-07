// Typed client for GET /admin/listings -- docs/API_CONTRACTS.md
// "GET /admin/listings". Local-DB only (the Cognito email lookup for
// creators is best-effort server-side), so no 502 failure mode.
import { apiFetch, toQueryString } from "./client";
import type { AdminListingSort, AdminListingsResponse } from "@/types/adminListings";
import type { PaginationParams } from "@/types/common";
import type { ListingStatusFilter } from "@/lib/adminListings";

export interface AdminListingsQuery extends PaginationParams {
  ownerId?: number;
  /** Exactly one restaurant (Managers report links). */
  brandId?: number;
  /** Case-insensitive substring match against the owner's email. */
  ownerEmail?: string;
  /** Case-insensitive substring match against the brand name. */
  name?: string;
  /** A location status, or `"deleted"` for soft-deleted listings only. */
  status?: ListingStatusFilter;
  isPaid?: boolean;
  /** Case-insensitive exact city match. */
  city?: string;
  isClaimed?: boolean;
  sort?: AdminListingSort;
}

/** GET /admin/listings -- auth: admin. Live call, no caching. */
export async function getAdminListings(
  params: AdminListingsQuery = {},
  accessToken: string
): Promise<AdminListingsResponse> {
  const query = toQueryString({
    owner_id: params.ownerId,
    brand_id: params.brandId,
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

  return apiFetch<AdminListingsResponse>(
    `/admin/listings${query}`,
    { method: "GET", cache: "no-store" },
    { accessToken }
  );
}
