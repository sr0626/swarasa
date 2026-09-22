// Typed client for location reopen requests — docs/API_CONTRACTS.md
// "Location reopen requests (`/locations/{id}/reopen-requests`,
// `/location-reopen-requests`)". Mirrors @/lib/api/claim.ts's shape.
import { apiFetch, toQueryString } from "./client";
import type { PaginatedResponse, PaginationParams } from "@/types/common";
import type {
  ApproveReopenRequestInput,
  CreateReopenRequestInput,
  RejectReopenRequestInput,
  ReopenRequestQueueItem,
  ReopenRequestResponse,
  ReopenRequestStatus,
} from "@/types/locationReopen";

/**
 * POST /locations/{id}/reopen-requests — auth: owner (must own the parent
 * brand), only for a location that is currently `closed_pending_reopen`
 * (409 otherwise, or if one is already pending).
 */
export async function submitReopenRequest(
  locationId: number,
  input: CreateReopenRequestInput,
  accessToken: string
): Promise<ReopenRequestResponse> {
  return apiFetch<ReopenRequestResponse>(
    `/locations/${locationId}/reopen-requests`,
    { method: "POST", body: JSON.stringify(input) },
    { accessToken }
  );
}

/**
 * GET /location-reopen-requests — auth: admin. Queue, oldest pending
 * first; `status` defaults to `pending_review` server-side.
 */
export async function listReopenRequests(
  params: PaginationParams & { status?: ReopenRequestStatus },
  accessToken: string
): Promise<PaginatedResponse<ReopenRequestQueueItem>> {
  const query = toQueryString({
    status: params.status,
    page: params.page,
    page_size: params.page_size,
  });
  return apiFetch<PaginatedResponse<ReopenRequestQueueItem>>(
    `/location-reopen-requests${query}`,
    { method: "GET" },
    { accessToken }
  );
}

/** GET /location-reopen-requests/{id} — auth: the requesting owner (own request) or admin (any). */
export async function getReopenRequestById(
  id: number,
  accessToken: string
): Promise<ReopenRequestResponse> {
  return apiFetch<ReopenRequestResponse>(
    `/location-reopen-requests/${id}`,
    { method: "GET" },
    { accessToken }
  );
}

/** POST /location-reopen-requests/{id}/approve — auth: admin. Flips the location back to active. */
export async function approveReopenRequest(
  id: number,
  input: ApproveReopenRequestInput,
  accessToken: string
): Promise<ReopenRequestResponse> {
  return apiFetch<ReopenRequestResponse>(
    `/location-reopen-requests/${id}/approve`,
    { method: "POST", body: JSON.stringify(input) },
    { accessToken }
  );
}

/** POST /location-reopen-requests/{id}/reject — auth: admin. reviewer_notes required. */
export async function rejectReopenRequest(
  id: number,
  input: RejectReopenRequestInput,
  accessToken: string
): Promise<ReopenRequestResponse> {
  return apiFetch<ReopenRequestResponse>(
    `/location-reopen-requests/${id}/reject`,
    { method: "POST", body: JSON.stringify(input) },
    { accessToken }
  );
}
