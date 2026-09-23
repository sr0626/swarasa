// Typed client for the deal CRUD sub-resource of `/locations/{id}` —
// docs/API_CONTRACTS.md "Deals (`deal`)" (PR #185's backend). Owner/
// assigned-manager/admin management view only — always full content,
// including inactive deals. Public read of deal content is NOT here; it's
// folded into `getLocationById` (`LocationDetail.deals_today`) and
// `searchRestaurants` (`SearchNearestLocation.has_deal_today`), same as the
// backend's own split (backend/app/routers/deals.py module docstring).
import { apiFetch } from "./client";
import type { CreateDealInput, Deal, DealListResponse, UpdateDealInput } from "@/types/deal";

/** GET /locations/{id}/deals — auth: owner/assigned-manager/admin. Every
 * deal for this location, active or not (used by the deal editor list). */
export async function getLocationDeals(
  locationId: number,
  accessToken: string
): Promise<DealListResponse> {
  return apiFetch<DealListResponse>(
    `/locations/${locationId}/deals`,
    { method: "GET" },
    { accessToken }
  );
}

/** POST /locations/{id}/deals — auth: owner/assigned-manager/admin. Deals
 * are a free-tier feature (root CLAUDE.md's `is_paid` tier model doesn't
 * gate deal creation — see backend/app/models/deal.py's own judgment-call
 * note) — no paid check here or anywhere else in this file. */
export async function createLocationDeal(
  locationId: number,
  input: CreateDealInput,
  accessToken: string
): Promise<Deal> {
  return apiFetch<Deal>(
    `/locations/${locationId}/deals`,
    { method: "POST", body: JSON.stringify(input) },
    { accessToken }
  );
}

/** PATCH /locations/{id}/deals/{deal_id} — auth: owner/assigned-manager/admin. */
export async function updateLocationDeal(
  locationId: number,
  dealId: number,
  input: UpdateDealInput,
  accessToken: string
): Promise<Deal> {
  return apiFetch<Deal>(
    `/locations/${locationId}/deals/${dealId}`,
    { method: "PATCH", body: JSON.stringify(input) },
    { accessToken }
  );
}

/** DELETE /locations/{id}/deals/{deal_id} — auth: owner/assigned-manager/
 * admin. Real, hard row delete (no soft-delete/is_active-only path) — see
 * backend/app/models/deal.py "no created_by/updated_by columns" and
 * `deal_service.delete_deal`'s own docstring. */
export async function deleteLocationDeal(
  locationId: number,
  dealId: number,
  accessToken: string
): Promise<void> {
  return apiFetch<void>(
    `/locations/${locationId}/deals/${dealId}`,
    { method: "DELETE" },
    { accessToken }
  );
}
