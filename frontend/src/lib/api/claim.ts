// Typed client for /claim — docs/API_CONTRACTS.md "Claim flow (`/claim`)".
import { apiFetch, toQueryString } from "./client";
import type { PaginatedResponse, PaginationParams } from "@/types/common";
import type {
  ApproveClaimInput,
  ClaimQueueItem,
  ClaimResponse,
  ClaimStatus,
  CreateClaimInput,
  RejectClaimInput,
} from "@/types/claim";

/** POST /claim — auth: any authenticated Cognito user (the claimant). */
export async function submitClaim(
  input: CreateClaimInput,
  accessToken: string
): Promise<ClaimResponse> {
  return apiFetch<ClaimResponse>(
    "/claim",
    { method: "POST", body: JSON.stringify(input) },
    { accessToken }
  );
}

/**
 * GET /claim — auth: admin. Claims queue, newest first; `status` defaults
 * to `pending_review` server-side.
 */
export async function listClaims(
  params: PaginationParams & { status?: ClaimStatus },
  accessToken: string
): Promise<PaginatedResponse<ClaimQueueItem>> {
  const query = toQueryString({
    status: params.status,
    page: params.page,
    page_size: params.page_size,
  });
  return apiFetch<PaginatedResponse<ClaimQueueItem>>(
    `/claim${query}`,
    { method: "GET" },
    { accessToken }
  );
}

/** GET /claim/{id} — auth: the claimant (own claim) or admin (any claim). */
export async function getClaimById(
  id: number,
  accessToken: string
): Promise<ClaimResponse> {
  return apiFetch<ClaimResponse>(
    `/claim/${id}`,
    { method: "GET" },
    { accessToken }
  );
}

/** POST /claim/{id}/approve — auth: admin. */
export async function approveClaim(
  id: number,
  input: ApproveClaimInput,
  accessToken: string
): Promise<ClaimResponse> {
  return apiFetch<ClaimResponse>(
    `/claim/${id}/approve`,
    { method: "POST", body: JSON.stringify(input) },
    { accessToken }
  );
}

/** POST /claim/{id}/reject — auth: admin. */
export async function rejectClaim(
  id: number,
  input: RejectClaimInput,
  accessToken: string
): Promise<ClaimResponse> {
  return apiFetch<ClaimResponse>(
    `/claim/${id}/reject`,
    { method: "POST", body: JSON.stringify(input) },
    { accessToken }
  );
}
